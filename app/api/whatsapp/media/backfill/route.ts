// =============================================================================
// MEDIA BACKFILL — POST /api/whatsapp/media/backfill
// -----------------------------------------------------------------------------
// Recovers attachments that were received but never stored: the rows the inbox
// renders as "file not available" (media_type set, media_path null).
//
// This is possible at all because Interakt's blob URLs are long-lived — the SAS
// tokens on them run to 2031, and re-fetching failed captures returns the full
// file. The URL is found in one of two places, in this order:
//
//   1. whatsapp_messages.media_source_url — stored by whatsapp_record_inbound.
//   2. whatsapp_webhook_log.payload — the raw body, exactly as Interakt sent
//      it. This is the reliable one: an older build of captureMedia dropped
//      the source URL on its failure paths, so the message row can be empty
//      while the webhook log still has it.
//
// Batched and self-advancing: each run takes a fixed number of the oldest
// unrecovered attachments, so pressing the button repeatedly walks forward
// through the backlog. A file that cannot be recovered has the reason written
// to media_error and is skipped next time rather than retried forever.
//
// Admin-only. Recovering a lead's CV is not something every team member should
// be able to trigger.
// =============================================================================
import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdmin, type SupabaseClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const BATCH = 5;

type Row = {
  id: string;
  workspace_id: string;
  provider_msg_id: string | null;
  media_type: string | null;
  media_name: string | null;
  media_source_url: string | null;
};

/** The raw payload is the fallback source of truth for a media URL. */
async function urlFromWebhookLog(
  admin: SupabaseClient,
  providerId: string | null
): Promise<string | null> {
  if (!providerId) return null;
  const { data } = await admin
    .from('whatsapp_webhook_log')
    .select('payload')
    .eq('provider_id', providerId)
    .order('received_at', { ascending: false })
    .limit(1);

  const msg = (data?.[0]?.payload as { data?: { message?: Record<string, unknown> } } | undefined)
    ?.data?.message;
  if (!msg) return null;
  const u = msg.media_url ?? msg.mediaUrl ?? msg.url;
  return typeof u === 'string' && u.length > 0 ? u : null;
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, reason: 'unauthenticated' }, { status: 401 });

  const { data: member } = await supabase
    .from('workspace_members').select('workspace_id').eq('user_id', user.id).maybeSingle();
  if (!member) return NextResponse.json({ ok: false, reason: 'no_workspace' }, { status: 403 });
  const wsId = member.workspace_id as string;

  const { data: allowed } = await supabase.rpc('is_campaign_admin', { p_workspace_id: wsId });
  if (!allowed) return NextResponse.json({ ok: false, reason: 'not_campaign_admin' }, { status: 403 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ ok: false, reason: 'not_configured' }, { status: 500 });
  const admin = createAdmin(url, key, { auth: { persistSession: false } });

  // Oldest first, and only those not already marked unrecoverable — that is
  // what makes repeated presses walk forward instead of grinding on the same
  // hopeless rows.
  const { data: rows, error: qErr } = await admin
    .from('whatsapp_messages')
    .select('id, workspace_id, provider_msg_id, media_type, media_name, media_source_url')
    .eq('workspace_id', wsId)
    .not('media_type', 'is', null)
    .is('media_path', null)
    .is('media_error', null)
    .order('created_at', { ascending: true })
    .limit(BATCH);

  if (qErr) return NextResponse.json({ ok: false, reason: qErr.message }, { status: 500 });

  const { count: remaining } = await admin
    .from('whatsapp_messages')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', wsId)
    .not('media_type', 'is', null)
    .is('media_path', null)
    .is('media_error', null);

  const results: Array<{ id: string; ok: boolean; detail: string }> = [];

  for (const row of (rows ?? []) as Row[]) {
    const src = row.media_source_url || (await urlFromWebhookLog(admin, row.provider_msg_id));
    if (!src) {
      await admin.from('whatsapp_messages')
        .update({ media_error: 'no source URL on the message or in the webhook log' })
        .eq('id', row.id);
      results.push({ id: row.id, ok: false, detail: 'no source url' });
      continue;
    }

    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 20_000);
      let res: Response;
      try { res = await fetch(src, { signal: ctrl.signal }); }
      finally { clearTimeout(timer); }

      if (!res.ok) {
        await admin.from('whatsapp_messages')
          .update({ media_error: `download HTTP ${res.status}` }).eq('id', row.id);
        results.push({ id: row.id, ok: false, detail: `HTTP ${res.status}` });
        continue;
      }

      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.byteLength === 0) {
        await admin.from('whatsapp_messages')
          .update({ media_error: 'source returned 0 bytes' }).eq('id', row.id);
        results.push({ id: row.id, ok: false, detail: 'empty' });
        continue;
      }

      const mime = res.headers.get('content-type')?.split(';')[0] || 'application/octet-stream';
      // Same map as the webhook: mime.split('/')[1] turns a Word document
      // into ".vndopenx", which will not open on a double-click.
      const EXT: Record<string,string> = {
        'application/pdf':'pdf','application/msword':'doc',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document':'docx',
        'image/jpeg':'jpg','image/png':'png','image/webp':'webp',
      };
      const ext = EXT[mime.toLowerCase()] ?? mime.split('/')[1]?.replace(/[^\w]/g, '').slice(0, 8) ?? 'bin';
      const name = row.media_name || `${row.media_type ?? 'file'}.${ext}`;
      // ASCII-safe key: storage 400s on non-ASCII, and a failed upload paired
      // with a written row is how a message ends up pointing at nothing.
      const path = `${wsId}/in/${Math.random().toString(36).slice(2, 12)}-`
        + (name.normalize('NFKD').replace(/[^\w.\-]+/g, '_').replace(/_+/g, '_').slice(0, 80) || 'file');

      const { error: upErr } = await admin.storage
        .from('whatsapp-media').upload(path, buf, { contentType: mime, upsert: false });
      if (upErr) {
        await admin.from('whatsapp_messages')
          .update({ media_error: `storage upload: ${upErr.message}` }).eq('id', row.id);
        results.push({ id: row.id, ok: false, detail: upErr.message });
        continue;
      }

      await admin.from('whatsapp_messages').update({
        media_path: path,
        media_mime: mime,
        media_size: buf.byteLength,
        media_source_url: src,
        media_error: null,
        updated_at: new Date().toISOString(),
      }).eq('id', row.id);

      results.push({ id: row.id, ok: true, detail: `${Math.round(buf.byteLength / 1024)} KB` });
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      await admin.from('whatsapp_messages')
        .update({ media_error: `fetch threw: ${detail}` }).eq('id', row.id);
      results.push({ id: row.id, ok: false, detail });
    }
  }

  const recovered = results.filter((r) => r.ok).length;
  return NextResponse.json({
    ok: true,
    scanned: results.length,
    recovered,
    failed: results.length - recovered,
    remaining: Math.max((remaining ?? 0) - results.length, 0),
    results,
  });
}
