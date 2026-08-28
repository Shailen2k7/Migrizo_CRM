// =============================================================================
// MEDIA PROXY — GET /api/whatsapp/media/<message_id>
// -----------------------------------------------------------------------------
// The ONLY way a browser reaches an attachment. The bucket is private, so every
// image tag and download link in the inbox points here, and every request is
// checked: valid session → member of a workspace → that message belongs to it.
//
// This is what keeps a lead's CV from being one shared URL away from the public
// internet. It costs one round trip through our server; that is the right price.
//
// ?download=1 forces a save dialog instead of inline rendering.
// =============================================================================
import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdmin } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

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

  // ── SECOND-CHANCE CAPTURE ─────────────────────────────────────────────────
  // media_path can be empty for two reasons: the original fetch from Interakt
  // failed at webhook time, or the file predates file-keeping (v2) and was
  // removed after its verdict. If Interakt's source link is still alive, pull
  // the bytes NOW, store them properly, and serve — the file heals itself the
  // first time someone opens it. If the link has expired too, say so in plain
  // words instead of a bare "Not found".
  if (!msg.media_path && msg.media_source_url) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 15_000);
      let res: Response;
      try { res = await fetch(msg.media_source_url, { signal: ctrl.signal }); }
      finally { clearTimeout(timer); }
      if (res.ok) {
        const buf = new Uint8Array(await res.arrayBuffer());
        if (buf.byteLength > 0 && buf.byteLength <= 100 * 1024 * 1024) {
          const mime = res.headers.get('content-type')?.split(';')[0]
            || msg.media_mime || 'application/octet-stream';
          const safeName = (msg.media_name || 'file').replace(/[^\w.\- ]+/g, '_').slice(0, 120);
          const path = `${msg.workspace_id}/in/${Math.random().toString(36).slice(2, 12)}-${safeName}`;
          const { error: upErr } = await admin.storage.from('whatsapp-media')
            .upload(path, buf, { contentType: mime, upsert: false });
          if (!upErr) {
            await admin.from('whatsapp_messages')
              .update({ media_path: path, media_mime: mime, media_size: buf.byteLength, updated_at: new Date().toISOString() })
              .eq('id', id);
            msg.media_path = path;
            msg.media_mime = mime;
          }
        }
      }
    } catch { /* fall through to the honest message below */ }
  }

  if (!msg.media_path) {
    return new NextResponse(
      'This file is no longer available. It was received before file-keeping was enabled ' +
      '(older files were removed after the AI read them) and the sender’s WhatsApp link has expired. ' +
      'The extracted profile is still on the lead — open the lead and press “View profile”. ' +
      'If you need the original document, ask the lead to resend it; new files are kept permanently.',
      { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
    );
  }

  const { data: file, error } = await admin.storage
    .from('whatsapp-media').download(msg.media_path);
  if (error || !file) return new NextResponse('Not found', { status: 404 });

  const download = req.nextUrl.searchParams.get('download') === '1';
  // The filename MUST carry an extension, or the OS saves an unopenable blob.
  // Derive it from the name, the storage path, or the mime — in that order.
  const MIME_EXT: Record<string, string> = {
    'application/pdf': 'pdf',
    'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
    'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'video/mp4': 'mp4',
  };
  let name = (msg.media_name || 'file').replace(/["\\]/g, '').trim() || 'file';
  if (!/\.\w{2,5}$/.test(name)) {
    const ext = (msg.media_path.split('.').pop() || '').toLowerCase();
    const goodExt = /^\w{2,5}$/.test(ext) && ext !== 'bin'
      ? ext
      : (MIME_EXT[(msg.media_mime || '').split(';')[0]] || 'pdf');
    name = `${name}.${goodExt}`;
  }

  return new NextResponse(file, {
    headers: {
      'Content-Type': msg.media_mime || 'application/octet-stream',
      'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${name}"`,
      // Private: the browser may reuse it, shared caches and CDNs may not.
      'Cache-Control': 'private, max-age=3600',
    },
  });
}
