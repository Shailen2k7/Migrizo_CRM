// =============================================================================
// MEDIA UPLOAD — POST /api/whatsapp/media/upload   (multipart/form-data)
// -----------------------------------------------------------------------------
// Takes a file from the composer, puts it in the private whatsapp-media bucket,
// and hands back the storage PATH. Nothing is sent to WhatsApp here — the send
// route does that, so an upload that the user then cancels costs nothing and
// reaches nobody.
//
// The path is namespaced by workspace and given a random prefix, so even a
// leaked service-role listing cannot be walked predictably.
// =============================================================================
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdmin } from '@supabase/supabase-js';
import { mediaTypeFromMime } from '@/lib/whatsapp/interakt';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// WhatsApp's own ceilings: 5MB images, 16MB video/audio, 100MB documents.
// We cap documents at 64MB — anything larger belongs in email, and Interakt
// times out fetching it anyway.
const MAX: Record<string, number> = {
  image: 5 * 1024 * 1024,
  video: 16 * 1024 * 1024,
  audio: 16 * 1024 * 1024,
  document: 64 * 1024 * 1024,
};

// Executables have no business travelling to a client's phone from our number.
const BLOCKED = /\.(exe|bat|cmd|com|scr|msi|dll|sh|jar|apk|vbs|ps1)$/i;

function safeName(name: string): string {
  return name.replace(/[^\w.\- ]+/g, '_').slice(0, 120) || 'file';
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, reason: 'unauthenticated' }, { status: 401 });

  const { data: member } = await supabase
    .from('workspace_members').select('workspace_id').eq('user_id', user.id).maybeSingle();
  if (!member) return NextResponse.json({ ok: false, reason: 'no_workspace' }, { status: 403 });
  const wsId = member.workspace_id as string;

  let form: FormData;
  try { form = await req.formData(); } catch {
    return NextResponse.json({ ok: false, reason: 'bad_form' }, { status: 400 });
  }
  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, reason: 'no_file' }, { status: 400 });
  }

  const name = safeName(file.name);
  if (BLOCKED.test(name)) {
    return NextResponse.json({ ok: false, reason: 'blocked_type',
      detail: 'Executable files cannot be sent over WhatsApp.' }, { status: 400 });
  }

  const mime = file.type || 'application/octet-stream';
  const mediaType = mediaTypeFromMime(mime);
  const limit = MAX[mediaType] ?? MAX.document;
  if (file.size > limit) {
    return NextResponse.json({
      ok: false, reason: 'too_large',
      detail: `${mediaType} files are limited to ${Math.round(limit / 1024 / 1024)}MB. This one is ${(file.size / 1024 / 1024).toFixed(1)}MB.`,
    }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ ok: false, reason: 'empty_file' }, { status: 400 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ ok: false, reason: 'not_configured' }, { status: 500 });
  const admin = createAdmin(url, key, { auth: { persistSession: false } });

  const rand = Math.random().toString(36).slice(2, 12);
  const path = `${wsId}/out/${rand}-${name}`;

  const { error } = await admin.storage.from('whatsapp-media').upload(
    path,
    new Uint8Array(await file.arrayBuffer()),
    { contentType: mime, upsert: false }
  );
  if (error) {
    // The bucket is created by migration 048; say so rather than a bare 500.
    const missing = /bucket|not found/i.test(error.message);
    return NextResponse.json({
      ok: false,
      reason: missing ? 'bucket_missing' : 'upload_failed',
      detail: missing ? 'Run migration 048 — the whatsapp-media bucket does not exist yet.' : error.message,
    }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    path,
    mediaType,
    name,
    mime,
    size: file.size,
  });
}
