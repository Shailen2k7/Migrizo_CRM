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
    .select('workspace_id, media_path, media_mime, media_name')
    .eq('id', id)
    .maybeSingle();

  // Same 404 whether the message is missing or simply not theirs — a different
  // answer would confirm the existence of other workspaces' data.
  if (!msg || msg.workspace_id !== member.workspace_id || !msg.media_path) {
    return new NextResponse('Not found', { status: 404 });
  }

  const { data: file, error } = await admin.storage
    .from('whatsapp-media').download(msg.media_path);
  if (error || !file) return new NextResponse('Not found', { status: 404 });

  const download = req.nextUrl.searchParams.get('download') === '1';
  const name = (msg.media_name || 'file').replace(/"/g, '');

  return new NextResponse(file, {
    headers: {
      'Content-Type': msg.media_mime || 'application/octet-stream',
      'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${name}"`,
      // Private: the browser may reuse it, shared caches and CDNs may not.
      'Cache-Control': 'private, max-age=3600',
    },
  });
}
