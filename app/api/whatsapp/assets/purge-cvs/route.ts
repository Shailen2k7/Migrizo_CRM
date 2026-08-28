// =============================================================================
// PURGE STORED CVs — POST /api/whatsapp/assets/purge-cvs
// -----------------------------------------------------------------------------
// The v2 pipeline KEEPS every CV a lead sends. Storage clean-up is therefore
// a deliberate human act: this route, behind the "Delete all stored CVs"
// button in WhatsApp Settings, removes the FILES of inbound documents and
// images while keeping every message, every extracted profile, and every
// verdict. The uploaded process PDF (the asset T5 attaches) is untouched.
//
// Admin-only. Batched so a big backlog never times out — the button reports
// remaining and is pressed again.
// =============================================================================
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdmin } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const BATCH = 200;

export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, reason: 'unauthenticated' }, { status: 401 });
  const { data: member } = await supabase.from('workspace_members')
    .select('workspace_id').eq('user_id', user.id).limit(1).maybeSingle();
  if (!member) return NextResponse.json({ ok: false, reason: 'no_workspace' }, { status: 403 });
  const { data: allowed } = await supabase.rpc('is_campaign_admin', { p_workspace_id: member.workspace_id });
  if (!allowed) return NextResponse.json({ ok: false, reason: 'not_campaign_admin' }, { status: 403 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ ok: false, reason: 'not_configured' }, { status: 500 });
  const admin = createAdmin(url, key, { auth: { persistSession: false } });
  const wsId = member.workspace_id as string;

  // Inbound files only — outbound assets and the process PDF live under
  // {ws}/assets/ and are never matched by this query.
  const { data: rows, error } = await admin
    .from('whatsapp_messages')
    .select('id, media_path')
    .eq('workspace_id', wsId)
    .eq('direction', 'in')
    .in('media_type', ['document', 'image'])
    .not('media_path', 'is', null)
    .limit(BATCH + 1);
  if (error) return NextResponse.json({ ok: false, reason: error.message }, { status: 500 });

  const page = (rows ?? []).slice(0, BATCH);
  const paths = page.map((r) => r.media_path as string);
  if (paths.length) {
    // Only null the pointers when the bytes actually went — a transient
    // storage failure must not orphan files the button can no longer reach.
    const { error: rmErr } = await admin.storage.from('whatsapp-media').remove(paths);
    if (rmErr) return NextResponse.json({ ok: false, reason: `storage: ${rmErr.message}` }, { status: 500 });
    await admin.from('whatsapp_messages')
      .update({ media_path: null, media_source_url: null, updated_at: new Date().toISOString() })
      .in('id', page.map((r) => r.id));
  }

  return NextResponse.json({
    ok: true,
    deleted: paths.length,
    remaining: (rows?.length ?? 0) > BATCH ? 'more' : 0,
  });
}
