// =============================================================================
// POST /api/cv/save — write reviewed profiles onto their leads.
// -----------------------------------------------------------------------------
// Takes what the review table approved: { items: [{ leadId, text, filename }] }.
// Writes leads.profile_text (the text), profile_received ('cv', unless the
// lead already says 'both'), and an activity row so the drawer can explain
// where the profile came from and what it replaced.
//
// Replaces, never appends. A newer CV is the truth; the old text is kept in
// the activity row's meta so nothing is truly lost.
// =============================================================================
import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { PROFILE_CAP_BYTES } from '@/lib/cv/extract';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Item { leadId: string; text: string; filename?: string }

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Not signed in.' }, { status: 401 });

  let body: { items?: Item[] };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: 'Bad request.' }, { status: 400 }); }
  const items = (body.items || []).filter((i) => i && i.leadId && typeof i.text === 'string' && i.text.trim());
  if (!items.length) return NextResponse.json({ ok: false, error: 'Nothing to save.' }, { status: 400 });

  const saved: string[] = [];
  const failed: { leadId: string; error: string }[] = [];

  for (const it of items.slice(0, 100)) {
    // The cap is enforced here as well as at parse time, because the text
    // could have been edited in the review table.
    let text = it.text.trim();
    if (Buffer.byteLength(text, 'utf8') > PROFILE_CAP_BYTES) {
      const note = '\n\n[condensed to fit the 10KB profile cap]';
      text = Buffer.from(text, 'utf8').subarray(0, PROFILE_CAP_BYTES - Buffer.byteLength(note)).toString('utf8') + note;
    }

    const { data: lead, error: readErr } = await supabase
      .from('leads').select('id, workspace_id, full_name, profile_text, profile_received')
      .eq('id', it.leadId).maybeSingle();
    if (readErr || !lead) { failed.push({ leadId: it.leadId, error: 'Lead not found.' }); continue; }

    const profile_received = lead.profile_received === 'both' ? 'both' : 'cv';
    const { error: upErr } = await supabase.from('leads').update({
      profile_text: text,
      profile_received,
      profile_received_at: new Date().toISOString(),
      cv_name: it.filename || null,
    }).eq('id', lead.id);
    if (upErr) { failed.push({ leadId: it.leadId, error: upErr.message }); continue; }

    try {
      await supabase.from('activity').insert({
        workspace_id: lead.workspace_id, user_id: user.id, lead_id: lead.id,
        action: 'cv_profile_saved',
        meta: {
          source: 'cv_import',
          filename: it.filename || null,
          bytes: Buffer.byteLength(text, 'utf8'),
          replaced: !!lead.profile_text,
          previous_text: lead.profile_text || null,
        },
      });
    } catch { /* best-effort */ }
    saved.push(lead.id);
  }

  return NextResponse.json({ ok: true, saved: saved.length, failed });
}
