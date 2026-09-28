// =============================================================================
// CASE PHOTO — /api/case/photo/<caseId>
// -----------------------------------------------------------------------------
//   GET     the client's photo, streamed (the header's <img src>)
//   POST    multipart `file` → stored, path returned (the page then records it
//           on the case, so the photo is part of the case like everything else)
//   DELETE  removes the stored file
//
// A client's photo is personal data, so it lives in a PRIVATE bucket and is
// only ever served through this route. Every call checks two things with the
// caller's own session: that they are signed in, and that row-level security
// lets them read this case. Someone who cannot see the case cannot see, add
// or remove its photo.
//
// The bucket creates itself on first upload, so there is no setup step.
// =============================================================================
import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdmin, type SupabaseClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BUCKET = 'case-photos';
const MAX_BYTES = 5 * 1024 * 1024;
const TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

type CaseRow = { id: string; workspace_id: string; journey: { details?: { photo_path?: string | null } } | null };

/** The case, read AS THE CALLER — RLS decides whether they may touch it. */
async function authorise(caseId: string): Promise<{ row: CaseRow } | { error: NextResponse }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: new NextResponse('Unauthorized', { status: 401 }) };
  const { data } = await supabase.from('cases').select('id, workspace_id, journey').eq('id', caseId).maybeSingle();
  if (!data) return { error: new NextResponse('Not found', { status: 404 }) };
  return { row: data as CaseRow };
}

function adminClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createAdmin(url, key, { auth: { persistSession: false } });
}

async function ensureBucket(admin: SupabaseClient) {
  const { data } = await admin.storage.getBucket(BUCKET);
  if (data) return;
  await admin.storage.createBucket(BUCKET, {
    public: false,
    fileSizeLimit: MAX_BYTES,
    allowedMimeTypes: Object.keys(TYPES),
  });
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  const auth = await authorise(caseId);
  if ('error' in auth) return auth.error;
  const path = auth.row.journey?.details?.photo_path;
  if (!path) return new NextResponse('No photo', { status: 404 });
  const admin = adminClient();
  if (!admin) return new NextResponse('Not configured', { status: 500 });
  const { data: file, error } = await admin.storage.from(BUCKET).download(path);
  if (error || !file) return new NextResponse('Not found', { status: 404 });
  const buf = Buffer.from(await file.arrayBuffer());
  return new NextResponse(buf, {
    headers: {
      'Content-Type': file.type || 'image/jpeg',
      'Content-Length': String(buf.byteLength),
      // Private: cached by this browser only. The path changes on every new
      // upload, so a replaced photo is never shown stale.
      'Cache-Control': 'private, max-age=86400',
    },
  });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  const auth = await authorise(caseId);
  if ('error' in auth) return auth.error;

  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof Blob)) return NextResponse.json({ ok: false, reason: 'No file received' }, { status: 400 });
  const ext = TYPES[file.type];
  if (!ext) return NextResponse.json({ ok: false, reason: 'Use a JPG, PNG or WebP image' }, { status: 415 });
  if (file.size > MAX_BYTES) return NextResponse.json({ ok: false, reason: 'Image is larger than 5 MB' }, { status: 413 });

  const admin = adminClient();
  if (!admin) return NextResponse.json({ ok: false, reason: 'Not configured' }, { status: 500 });
  await ensureBucket(admin);

  const path = `${auth.row.workspace_id}/${caseId}/${Date.now()}.${ext}`;
  const buf = Buffer.from(await file.arrayBuffer());
  const { error } = await admin.storage.from(BUCKET).upload(path, buf, { contentType: file.type, upsert: false });
  if (error) return NextResponse.json({ ok: false, reason: error.message }, { status: 500 });

  // The previous photo is no longer referenced once the page records the new
  // path; remove it so replaced photos do not pile up.
  const old = auth.row.journey?.details?.photo_path;
  if (old && old !== path) void admin.storage.from(BUCKET).remove([old]);

  return NextResponse.json({ ok: true, path });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  const auth = await authorise(caseId);
  if ('error' in auth) return auth.error;
  const path = auth.row.journey?.details?.photo_path;
  const admin = adminClient();
  if (path && admin) await admin.storage.from(BUCKET).remove([path]);
  return NextResponse.json({ ok: true });
}
