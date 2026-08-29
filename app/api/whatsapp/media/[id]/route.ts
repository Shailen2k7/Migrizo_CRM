// =============================================================================
// MEDIA PROXY — GET /api/whatsapp/media/<message_id>
// -----------------------------------------------------------------------------
// The ONLY way a browser reaches an attachment. The bucket is private, so every
// image tag and download link in the inbox points here, and every request is
// checked: valid session → member of a workspace → that message belongs to it.
//
// THE 0-BYTE BUG (fixed here). Downloads were arriving empty. Two independent
// causes, both now handled:
//
//   1. `new NextResponse(blob)` — a stream body that Netlify's Next adapter did
//      not always drain. Every response now goes out as a Buffer with an
//      explicit Content-Length (lib/whatsapp/serve-bytes.ts).
//   2. A row whose media_path points at an object that is genuinely 0 bytes,
//      because the original webhook capture half-failed. We no longer serve it:
//      we re-pull the bytes from Interakt's link and OVERWRITE the object, then
//      serve the real file. The record heals itself on the first click.
//
// ?download=1 forces a save dialog instead of inline rendering.
// =============================================================================
import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdmin, type SupabaseClient } from '@supabase/supabase-js';
import { toBuffer, safeFilename, mimeFor, fileResponse } from '@/lib/whatsapp/serve-bytes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Pulls the file from the provider's link and stores it. Used both when we never
 * captured it and when what we captured turned out to be empty.
 * Returns the bytes on success so the caller can serve them without a re-read.
 */
async function captureFromSource(
  admin: SupabaseClient,
  msg: { workspace_id: string; media_name: string | null; media_mime: string | null; media_source_url: string },
  msgId: string,
  overwritePath: string | null
): Promise<{ buf: Buffer; path: string; mime: string } | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15_000);
    let res: Response;
    try { res = await fetch(msg.media_source_url, { signal: ctrl.signal }); }
    finally { clearTimeout(timer); }
    if (!res.ok) return null;

    const buf = await toBuffer(new Uint8Array(await res.arrayBuffer()));
    if (buf.byteLength === 0 || buf.byteLength > 100 * 1024 * 1024) return null;

    const mime = res.headers.get('content-type')?.split(';')[0]
      || msg.media_mime || 'application/octet-stream';
    const { filename } = safeFilename({ name: msg.media_name, mime, buf });
    const safe = filename.replace(/[^\w.\- ]+/g, '_').slice(0, 120);
    const path = overwritePath
      || `${msg.workspace_id}/in/${Math.random().toString(36).slice(2, 12)}-${safe}`;

    const { error: upErr } = await admin.storage.from('whatsapp-media')
      .upload(path, buf, { contentType: mime, upsert: true });
    if (upErr) return null;

    await admin.from('whatsapp_messages')
      .update({
        media_path: path, media_mime: mime,
        media_size: buf.byteLength, updated_at: new Date().toISOString(),
      })
      .eq('id', msgId);

    return { buf, path, mime };
  } catch {
    return null;
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const download = req.nextUrl.searchParams.get('download') === '1';

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new NextResponse('Unauthorized', { status: 401 });

  const { data: member } = await supabase
    .from('workspace_members').select('workspace_id').eq('user_id', user.id).maybeSingle();
  if (!member) return new NextResponse('Forbidden', { status: 403 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return new NextResponse('Not configured', { status: 500 });
  const admin = createAdmin(url, key, { auth: { persistSession: false } });

  const { data: msg } = await admin
    .from('whatsapp_messages')
    .select('workspace_id, media_path, media_mime, media_name, media_type, media_source_url')
    .eq('id', id)
    .maybeSingle();

  // Same 404 whether the message is missing or simply not theirs — a different
  // answer would confirm the existence of other workspaces' data.
  if (!msg || msg.workspace_id !== member.workspace_id) {
    return new NextResponse('Not found', { status: 404 });
  }

  let buf: Buffer | null = null;
  let path = msg.media_path as string | null;
  let mime = msg.media_mime as string | null;

  // ── 1. read what we stored ────────────────────────────────────────────────
  if (path) {
    const { data: file, error } = await admin.storage.from('whatsapp-media').download(path);
    if (!error && file) {
      const b = await toBuffer(file);
      if (b.byteLength > 0) buf = b;   // 0 bytes is a miss, not a hit — fall through
    }
  }

  // ── 2. never captured, or captured empty → pull it from the provider now ──
  if (!buf && msg.media_source_url) {
    const got = await captureFromSource(
      admin,
      { workspace_id: msg.workspace_id, media_name: msg.media_name, media_mime: msg.media_mime, media_source_url: msg.media_source_url },
      id,
      path,           // overwrite the empty object in place if there is one
    );
    if (got) { buf = got.buf; path = got.path; mime = got.mime; }
  }

  // ── 3. honestly nothing ───────────────────────────────────────────────────
  if (!buf) {
    return new NextResponse(
      'This file could not be retrieved. It was received before file-keeping was enabled ' +
      '(older files were removed after the AI read them) and the sender’s WhatsApp link has expired. ' +
      'The extracted profile is still on the lead — open the lead and press “Open CV”. ' +
      'If you need the original document, ask the lead to resend it; new files are kept permanently.',
      { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
    );
  }

  // The customer's own filename, kept as sent, guaranteed to carry a real
  // extension — derived from the actual bytes when the name has none.
  const { filename, ext } = safeFilename({
    name: msg.media_name, path, mime, buf,
    fallback: msg.media_type === 'image' ? 'photo' : 'file',
  });
  return fileResponse(buf, filename, mimeFor(ext, mime), download);
}
