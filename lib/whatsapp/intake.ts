// =============================================================================
// INTAKE ORCHESTRATOR — what happens the moment a lead's message arrives.
//
// Called by the webhook AFTER whatsapp_record_inbound has stored the message
// (and after the DB trigger has already cancelled any chase the reply should
// cancel). Three jobs, in order:
//
//   1. T1 — if this lead has a chase waiting at step 1, answer their opening
//      message with the CV ask RIGHT NOW, free-form, while they are looking
//      at their phone. If Make's ingest hasn't created the chase row yet
//      (message beat the webhook race), create it for a fresh cold lead.
//
//   2. CV — a PDF/DOCX attachment goes through the profile pipeline: extract,
//      judge, store the text, DELETE the file, then act on the verdict:
//      eligible → T5 now + process document + T6 queued a few minutes behind;
//      not eligible → T7 now. All free-form: they just messaged us, the
//      window is open by definition.
//
//   3. LinkedIn — a bare LinkedIn URL is recorded on the lead and flagged for
//      a human. We cannot read LinkedIn pages, and pretending otherwise would
//      manufacture verdicts out of nothing.
//
// EVERYTHING here is best-effort: a failure logs, flags the conversation, and
// never breaks the webhook's 200 to Interakt.
// =============================================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  getWaSettings, resolveSavedReply, fillPlaceholders, valuesFor, firstName,
  sendSessionText, sendProcessDocument,
} from './outbound';
import { processCvMessage, recordLinkedInOnly } from './profile';

const LINKEDIN_RE = /https?:\/\/(?:[\w.]*\.)?linkedin\.com\/in\/[\w\-%.]+/i;

export interface InboundContext {
  conversationId: string;
  phone: string;
  text: string;
  providerMsgId: string | null;
  media: { path: string | null; type: string | null; name: string | null; mime: string | null };
}

export async function handleInboundForIntake(
  admin: SupabaseClient,
  wsId: string,
  ctx: InboundContext
): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};

  const { data: conv } = await admin
    .from('whatsapp_conversations')
    .select('id, lead_id, phone_e164, last_outbound_at')
    .eq('id', ctx.conversationId)
    .maybeSingle();
  if (!conv?.lead_id) return { skipped: 'no_lead_on_conversation' };

  const { data: lead } = await admin
    .from('leads')
    .select('id, full_name, stage, created_at, profile_received, eligibility_source')
    .eq('id', conv.lead_id)
    .maybeSingle();
  if (!lead) return { skipped: 'lead_gone' };

  const settings = await getWaSettings(admin);
  if (!settings) return { skipped: 'no_settings' };
  const dryRun = settings.dry_run !== false;
  const first = firstName(lead.full_name);
  const paused = settings.sending_paused === true;

  const isDocument =
    ctx.media.path && ctx.media.type === 'document' &&
    (/(pdf|word|officedocument)/i.test(ctx.media.mime || '') ||
     /\.(pdf|docx?)$/i.test(ctx.media.name || ''));
  const hasLinkedIn = !isDocument && LINKEDIN_RE.test(ctx.text);

  const flagAttention = async () => {
    await admin.from('whatsapp_conversations')
      .update({ needs_attention: true, updated_at: new Date().toISOString() })
      .eq('id', conv.id);
  };

  // ── 1. T1, inline ─────────────────────────────────────────────────────────
  // Skipped entirely when the message IS the profile (CV or LinkedIn) —
  // answering a CV with "please send your CV" is the fastest way to look like
  // a robot. The verdict flow below is the answer to those messages.
  if (!isDocument && !hasLinkedIn) {
    try {
      // Atomic claim (076): whoever wins this update sends T1; a second
      // webhook invocation seconds later, or a drain that leased the row,
      // loses and sends nothing. This is what makes double-T1 impossible.
      let { data: claimedId } = await admin.rpc('wa_intake_claim_one', {
        p_workspace_id: wsId, p_phone: conv.phone_e164, p_track: 'chase', p_step: 1,
      });

      // The message can beat Make's ingest POST. Create the chase ourselves
      // for a genuinely fresh lead: cold stage, created in the last 48h,
      // never yet messaged by us. Anything older is a returning contact.
      if (!claimedId) {
        const freshLead =
          lead.stage === 'cold' &&
          Date.now() - new Date(lead.created_at).getTime() < 48 * 3600 * 1000 &&
          !conv.last_outbound_at;
        if (freshLead) {
          await admin.rpc('wa_intake_enqueue', {
            p_workspace_id: wsId, p_lead_id: lead.id, p_phone: conv.phone_e164,
            p_track: 'chase', p_first_step: 1, p_delay_minutes: 0,
          });
          ({ data: claimedId } = await admin.rpc('wa_intake_claim_one', {
            p_workspace_id: wsId, p_phone: conv.phone_e164, p_track: 'chase', p_step: 1,
          }));
        }
      }

      // Claimed but paused: leave the row leased — the drain sends T1 when
      // sending resumes. Never drop it on the floor.
      if (claimedId && !paused) {
        const reply = await resolveSavedReply(admin, wsId, 't1');
        if (!reply) {
          await admin.rpc('wa_intake_advance', {
            p_intake_id: claimedId, p_ok: false, p_branch: 'session',
            p_error: 'Quick reply T1 not found — add it in WhatsApp → Quick replies', p_retry_hours: 1,
          });
          out.t1 = 'quick_reply_missing';
        } else {
          const filled = fillPlaceholders(reply.body, valuesFor(1, {
            first, video: settings.video_url, booking: settings.booking_url, pdf: settings.pdf_url,
          }));
          if (filled.missing.length) {
            await admin.rpc('wa_intake_advance', {
              p_intake_id: claimedId, p_ok: false, p_branch: 'session',
              p_error: `T1 has unfilled placeholder(s): ${filled.missing.join(', ')}`, p_retry_hours: 1,
            });
            out.t1 = 'missing_placeholders';
          } else {
            const res = await sendSessionText(admin, wsId, {
              phone: conv.phone_e164, leadId: lead.id, body: filled.text,
              step: 'intake:T1', dryRun,
            });
            await admin.rpc('wa_intake_advance', {
              p_intake_id: claimedId, p_ok: res.ok, p_branch: 'session',
              p_error: res.ok ? null : `${res.code}: ${res.detail ?? ''}`.slice(0, 300),
            });
            out.t1 = res.ok ? (dryRun ? 'sent_dry_run' : 'sent') : `failed:${res.code}`;
          }
        }
      }
    } catch (e) {
      console.error('[intake] T1 step threw', e);
      out.t1 = 'error';
    }
  }

  // ── 2. CV attachment ──────────────────────────────────────────────────────

  if (isDocument) {
    try {
      const verdict = await processCvMessage(admin, wsId, {
        leadId: lead.id, leadName: lead.full_name || 'the candidate',
        conversationId: conv.id, mediaPath: ctx.media.path as string,
        mediaName: ctx.media.name, mediaMime: ctx.media.mime,
        providerMsgId: ctx.providerMsgId,
      });
      out.cv = verdict.ok ? (verdict.eligible ? 'eligible' : 'not_eligible') : verdict.skipped;

      if (verdict.ok) {
        // The profile arrived — the ask-for-CV chase is over, whatever step it
        // was on. This is the review's F2: without it, a CV sent as the very
        // FIRST message left the chase alive and T2 nudged for a CV already
        // judged.
        await admin.from('wa_intake')
          .update({ status: 'replied', replied_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq('workspace_id', wsId).eq('phone_e164', conv.phone_e164)
          .eq('track', 'chase').eq('status', 'waiting');

        if (paused) {
          // Sending is paused (quality brake). The verdict is stamped, the
          // file is gone — QUEUE the outcome so it fires when sending
          // resumes, and flag a human so nobody waits on a silent robot.
          await admin.rpc('wa_intake_enqueue', {
            p_workspace_id: wsId, p_lead_id: lead.id, p_phone: conv.phone_e164,
            p_track: 'verdict', p_first_step: verdict.eligible ? 5 : 7, p_delay_minutes: 0,
          });
          await flagAttention();
          out.verdict_queue = 'queued_paused';
        } else if (verdict.eligible) {
          // T5 now…
          const t5 = await resolveSavedReply(admin, wsId, 't5');
          let t5Sent = false;
          if (t5) {
            const filled = fillPlaceholders(t5.body, valuesFor(5, {
              first, route: verdict.route, video: settings.video_url,
              booking: settings.booking_url, pdf: settings.pdf_url,
            }));
            if (!filled.missing.length) {
              const res = await sendSessionText(admin, wsId, {
                phone: conv.phone_e164, leadId: lead.id, body: filled.text,
                step: 'intake:T5', dryRun,
              });
              t5Sent = res.ok;
              out.t5 = res.ok ? 'sent' : `failed:${res.code}`;
              // …the process document rides along…
              if (res.ok && settings.pdf_url) {
                await sendProcessDocument(admin, wsId, {
                  phone: conv.phone_e164, leadId: lead.id,
                  pdfUrl: settings.pdf_url, step: 'intake:T5-doc', dryRun,
                });
              }
            } else {
              out.t5 = `missing_placeholders:${filled.missing.join(',')}`;
            }
          } else {
            out.t5 = 'quick_reply_missing';
          }
          // T6 rides 4 minutes behind a DELIVERED T5. If T5 failed, queue the
          // pair from step 5 instead — the drain retries T5 first, then T6;
          // the lead never gets a bare booking link with no verdict before it.
          await admin.rpc('wa_intake_enqueue', {
            p_workspace_id: wsId, p_lead_id: lead.id, p_phone: conv.phone_e164,
            p_track: 'verdict', p_first_step: t5Sent ? 6 : 5,
            p_delay_minutes: t5Sent ? 4 : 15,
          });
          if (!t5Sent) await flagAttention();
        } else {
          // Honest no, plus the IFV door left open — T7, right now.
          const t7 = await resolveSavedReply(admin, wsId, 't7');
          let t7Sent = false;
          if (t7) {
            const filled = fillPlaceholders(t7.body, valuesFor(7, { first }));
            if (!filled.missing.length) {
              const res = await sendSessionText(admin, wsId, {
                phone: conv.phone_e164, leadId: lead.id, body: filled.text,
                step: 'intake:T7', dryRun,
              });
              t7Sent = res.ok;
              out.t7 = res.ok ? 'sent' : `failed:${res.code}`;
            } else {
              out.t7 = `missing_placeholders:${filled.missing.join(',')}`;
            }
          } else {
            out.t7 = 'quick_reply_missing';
          }
          if (!t7Sent) {
            await admin.rpc('wa_intake_enqueue', {
              p_workspace_id: wsId, p_lead_id: lead.id, p_phone: conv.phone_e164,
              p_track: 'verdict', p_first_step: 7, p_delay_minutes: 15,
            });
            await flagAttention();
          }
        }
      }
    } catch (e) {
      console.error('[intake] CV pipeline threw', e);
      out.cv = 'error';
    }
  }

  // ── 3. LinkedIn URL, no file ──────────────────────────────────────────────
  if (hasLinkedIn) {
    try {
      const url = ctx.text.match(LINKEDIN_RE)?.[0] ?? '';
      await recordLinkedInOnly(admin, wsId, { leadId: lead.id, conversationId: conv.id, url });
      out.linkedin = 'recorded_for_human';
    } catch (e) {
      console.error('[intake] linkedin step threw', e);
      out.linkedin = 'error';
    }
  }

  return out;
}
