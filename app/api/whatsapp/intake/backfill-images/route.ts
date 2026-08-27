// =============================================================================
// IMAGE-CV BACKFILL — POST /api/whatsapp/intake/backfill-images
// -----------------------------------------------------------------------------
// One-shot sweep for CVs that arrived as PHOTOS before the vision pipeline
// existed. Triggered by the button in WhatsApp → Settings (admin session) or
// by cron secret. Each call processes a small batch of conversations and
// reports what it did; press again until "remaining: 0".
//
// Selection: inbound image messages that still have their file, on
// conversations linked to a lead whose profile has never been received and
// whose verdict is not human-made. The vision model's is_cv gate does the
// rest — selfies and screenshots are left exactly where they are.
//
// Verdict actions (T5/T6 or T7) run ONLY when the lead's 24h window is still
// open. An old photo from someone who last wrote four days ago must not
// trigger a free-form send that Meta will reject — those leads get the
// verdict stamped + the conversation flagged for a human instead.
// =============================================================================
import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdmin, type SupabaseClient } from '@supabase/supabase-js';
import { processCvImages } from '@/lib/whatsapp/profile';
import { applyVerdictActions } from '@/lib/whatsapp/intake';
import { getWaSettings, firstName } from '@/lib/whatsapp/outbound';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const BATCH = 5; // conversations per call — vision calls are slow; stay well inside the time box

export async function POST(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ ok: false, reason: 'not_configured' }, { status: 500 });
  const admin: SupabaseClient = createAdmin(url, key, { auth: { persistSession: false } });

  // cron secret, or a logged-in campaign admin
  const cronSecret = process.env.CRON_SECRET;
  let wsId: string | null = null;
  if (cronSecret && req.headers.get('x-cron-secret') === cronSecret) {
    const { data: rows } = await admin.from('whatsapp_settings')
      .select('workspace_id, connected').order('connected', { ascending: false }).limit(1);
    wsId = rows?.[0]?.workspace_id ?? null;
  } else {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ ok: false, reason: 'unauthenticated' }, { status: 401 });
    const { data: member } = await supabase.from('workspace_members')
      .select('workspace_id').eq('user_id', user.id).limit(1).maybeSingle();
    if (!member) return NextResponse.json({ ok: false, reason: 'no_workspace' }, { status: 403 });
    const { data: allowed } = await supabase.rpc('is_campaign_admin', { p_workspace_id: member.workspace_id });
    if (!allowed) return NextResponse.json({ ok: false, reason: 'not_campaign_admin' }, { status: 403 });
    wsId = member.workspace_id as string;
  }
  if (!wsId) return NextResponse.json({ ok: true, processed: 0, note: 'no_workspace_configured' });

  const settings = await getWaSettings(admin);
  if (!settings) return NextResponse.json({ ok: true, processed: 0, note: 'no_settings' });

  // Candidate images: inbound, file still present, conversation → lead with
  // no profile yet and no manual verdict.
  const { data: candidates } = await admin
    .from('whatsapp_messages')
    .select(`
      id, media_path, media_mime, created_at, conversation_id,
      conversation:whatsapp_conversations!inner(id, phone_e164, lead_id, last_inbound_at,
        lead:leads(id, full_name, profile_received, eligibility_source))
    `)
    .eq('workspace_id', wsId)
    .eq('direction', 'in')
    .eq('media_type', 'image')
    .not('media_path', 'is', null)
    .not('hidden', 'is', true)
    // Marked on every scan outcome below — this is what makes repeated
    // presses walk FORWARD through the backlog instead of re-paying vision
    // calls on the same five selfies forever.
    .is('error_code', null)
    .not('conversation.lead_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(200);

  // Group by conversation; keep only leads that still need a profile.
  type Cand = {
    convId: string; phone: string; leadId: string; leadName: string | null;
    lastInboundAt: string | null; images: Array<{ path: string; mime: string | null }>;
  };
  const byConv = new Map<string, Cand>();
  for (const m of candidates ?? []) {
    const conv = Array.isArray(m.conversation) ? m.conversation[0] : m.conversation;
    if (!conv) continue;
    const lead = Array.isArray(conv.lead) ? conv.lead[0] : conv.lead;
    if (!lead) continue;
    if (lead.profile_received === 'cv' || lead.profile_received === 'both') continue;
    if (lead.eligibility_source === 'manual') continue;
    const entry: Cand = byConv.get(conv.id) ?? {
      convId: conv.id, phone: conv.phone_e164, leadId: lead.id,
      leadName: lead.full_name, lastInboundAt: conv.last_inbound_at, images: [],
    };
    if (entry.images.length < 4) entry.images.push({ path: m.media_path as string, mime: m.media_mime as string | null });
    byConv.set(conv.id, entry);
  }

  const queue = Array.from(byConv.values());
  const results: Array<Record<string, unknown>> = [];
  let processed = 0;

  for (const c of queue.slice(0, BATCH)) {
    // Oldest page first — they were selected newest-first above.
    c.images.reverse();
    const verdict = await processCvImages(admin, wsId, {
      leadId: c.leadId, leadName: c.leadName || 'the candidate',
      conversationId: c.convId, images: c.images,
    });
    processed++;

    if (!verdict.ok) {
      // Stamp the scanned images so the next press moves PAST this chat.
      // Inbound rows never display error_code (only status='failed' does),
      // so this is invisible bookkeeping, not a red bubble.
      await admin.from('whatsapp_messages')
        .update({ error_code: 'cv_scan_skipped', error_detail: verdict.skipped ?? 'skipped', updated_at: new Date().toISOString() })
        .eq('workspace_id', wsId)
        .in('media_path', c.images.map((i) => i.path));
      results.push({ who: c.leadName, outcome: verdict.skipped });
      continue;
    }

    const windowOpen = !!c.lastInboundAt &&
      Date.now() - new Date(c.lastInboundAt).getTime() < 23 * 3600 * 1000;

    if (windowOpen) {
      const actions = await applyVerdictActions(admin, wsId, settings, {
        leadId: c.leadId, phone: c.phone, first: firstName(c.leadName),
        conversationId: c.convId,
        eligible: verdict.eligible === true, route: verdict.route,
      });
      results.push({ who: c.leadName, outcome: verdict.eligible ? 'eligible' : 'not_eligible', ...actions });
    } else {
      // Window shut: verdict stored, human takes the reply. Free-form here
      // would just bounce off Meta.
      await admin.from('whatsapp_conversations')
        .update({ needs_attention: true, updated_at: new Date().toISOString() })
        .eq('id', c.convId);
      results.push({
        who: c.leadName,
        outcome: `${verdict.eligible ? 'eligible' : 'not_eligible'} — window closed, flagged for human reply`,
      });
    }
  }

  return NextResponse.json({
    ok: true, processed,
    remaining: Math.max(0, queue.length - BATCH),
    results,
  });
}

export async function GET() {
  return NextResponse.json({ ok: true, endpoint: 'image-CV backfill', method: 'POST only' });
}
