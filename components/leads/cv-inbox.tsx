'use client';

// =============================================================================
// CVs FROM WHATSAPP — the ones the machine would not save on its own.
// -----------------------------------------------------------------------------
// WHY THIS EXISTS
// When a client sends a document on WhatsApp, the webhook reads it and decides.
// A confident CV lands on the lead by itself. Everything else got a verdict and
// then went nowhere, because there was no screen showing it: a CV that scored
// just under the bar, one sent from a number no lead matches, a scan with no
// text inside. On 22 Sep 2026 three clients in one evening sent CVs that never
// reached their records, and all three were told they were not eligible the
// next morning. Nobody could have noticed, because nothing was displayed.
//
// So this is the list of everything the machine could not finish by itself:
//
//   review      readable and CV-like, but not certain enough to save alone
//   unmatched   looks like a CV, but no lead matches the sender
//   unreadable  a scan or photo — there is no text to read without OCR
//
// Approving writes the text onto the lead exactly as an automatic save would,
// including the profile_received stamp, so the drawer's "View profile" works
// straight away. The extracted text is already on the capture row, so nothing
// has to be downloaded or read a second time.
//
// IT DEGRADES QUIETLY. If migration 121 has not been run the table does not
// exist, every query returns an error, and this renders nothing at all rather
// than putting an error in front of someone who cannot act on it.
// =============================================================================

import { useCallback, useEffect, useState } from 'react';
import { FileWarning, X, Check, Trash2, RefreshCw, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import { useApp } from '@/components/shared/app-provider';
import { timeAgo, cn } from '@/lib/utils';

type Status = 'review' | 'unmatched' | 'unreadable';

interface Capture {
  id: string;
  lead_id: string | null;
  phone_e164: string | null;
  file_name: string | null;
  file_mime: string | null;
  status: Status;
  reason: string | null;
  cv_score: number | null;
  extracted_text: string | null;
  received_at: string;
  conversation_id: string;
}

const META: Record<Status, { label: string; bg: string; fg: string; dot: string; help: string }> = {
  review:     { label: 'Needs a look', bg: '#FEF3C7', fg: '#92400E', dot: '#F59E0B',
                help: 'Reads like a CV but not clearly enough to save on its own.' },
  unmatched:  { label: 'No lead',      bg: '#EDE9FE', fg: '#5B21B6', dot: '#7C3AED',
                help: 'Looks like a CV, but no lead matches the number it came from.' },
  unreadable: { label: 'Cannot read',  bg: '#F4F4F6', fg: '#6B7280', dot: '#9CA3AF',
                help: 'A scan or photo with no text inside. Open it and copy the text by hand.' },
};

export function CvInbox() {
  const supabase = createClient();
  const { leads, refreshLead, user } = useApp();
  const [rows, setRows] = useState<Capture[] | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('relay_cv_captures')
      .select('id, lead_id, phone_e164, file_name, file_mime, status, reason, cv_score, extracted_text, received_at, conversation_id')
      .in('status', ['review', 'unmatched', 'unreadable'])
      .order('received_at', { ascending: false })
      .limit(50);
    // Migration 121 not run yet, or no access: stay invisible rather than
    // showing an error nobody on this screen can do anything about.
    if (error) { setRows(null); return; }
    setRows((data ?? []) as Capture[]);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  const resolve = async (c: Capture, action: 'approve' | 'dismiss') => {
    setBusy(c.id);
    try {
      if (action === 'approve') {
        if (!c.lead_id) { toast.error('There is no lead attached to this one'); return; }
        if (!c.extracted_text) { toast.error('No text was kept for this file — open the chat and copy it in'); return; }
        const lead = leads.find((l) => l.id === c.lead_id);
        const { error: e1 } = await supabase.from('leads').update({
          profile_text: c.extracted_text,
          profile_received: lead?.profile_received === 'both' || lead?.profile_received === 'linkedin' ? 'both' : 'cv',
          profile_received_at: new Date().toISOString(),
          cv_name: c.file_name,
        }).eq('id', c.lead_id);
        if (e1) { toast.error(`Could not save: ${e1.message}`); return; }
        await refreshLead(c.lead_id);
      }
      const { error: e2 } = await supabase.from('relay_cv_captures').update({
        status: action === 'approve' ? 'approved' : 'dismissed',
        resolved_at: new Date().toISOString(),
        resolved_by: user.id,
      }).eq('id', c.id);
      if (e2) { toast.error(`Could not update: ${e2.message}`); return; }

      setRows((prev) => (prev ?? []).filter((r) => r.id !== c.id));
      toast.success(action === 'approve' ? 'CV saved to the lead' : 'Dismissed');
    } finally {
      setBusy(null);
    }
  };

  // Nothing to show, or the table is not there yet.
  if (!rows || rows.length === 0) return null;

  return (
    <>
      <button onClick={() => setOpen(true)}
        className="btn btn-outline inline-flex items-center gap-1.5"
        title="Documents sent on WhatsApp that could not be filed automatically">
        <FileWarning className="h-3.5 w-3.5 text-amber-500" />
        CVs to check
        <span className="ml-0.5 rounded-full bg-amber-500 px-1.5 text-[10.5px] font-bold leading-[16px] text-white">{rows.length}</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-[70] flex items-start justify-center p-4 pt-[8vh]">
          <div onClick={() => setOpen(false)} className="absolute inset-0 animate-fadeIn bg-black/40 backdrop-blur-[2px]" />
          <div className="animate-pageIn relative flex max-h-[80vh] w-full max-w-[720px] flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl">
            <div className="flex items-start gap-3 border-b border-border px-5 py-4">
              <div className="min-w-0 flex-1">
                <h2 className="text-[15.5px] font-semibold tracking-tight">CVs from WhatsApp</h2>
                <p className="mt-1 text-[12.3px] leading-relaxed text-muted">
                  {rows.length} document{rows.length === 1 ? '' : 's'} the CRM could not file on its own.
                  Approving one saves its text to the lead exactly as an automatic save would.
                </p>
              </div>
              <button onClick={load} title="Refresh"
                className="rounded-lg p-1.5 text-faint transition hover:bg-surface-2 hover:text-ink">
                <RefreshCw className="h-4 w-4" />
              </button>
              <button onClick={() => setOpen(false)} aria-label="Close"
                className="rounded-lg p-1.5 text-faint transition hover:bg-surface-2 hover:text-ink">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {rows.map((c) => {
                const m = META[c.status];
                const lead = c.lead_id ? leads.find((l) => l.id === c.lead_id) : null;
                const working = busy === c.id;
                return (
                  <div key={c.id} className="mb-2 rounded-xl border border-border p-3 last:mb-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center gap-1.5 rounded-md px-2 py-[3px] text-[11px] font-semibold"
                        style={{ background: m.bg, color: m.fg }}>
                        <span className="h-1.5 w-1.5 rounded-full" style={{ background: m.dot }} />{m.label}
                      </span>
                      <span className="text-[13px] font-medium text-ink">
                        {lead?.full_name ?? c.phone_e164 ?? 'Unknown sender'}
                      </span>
                      {c.cv_score !== null && (
                        <span className="text-[11px] text-faint">score {Number(c.cv_score).toFixed(2)}</span>
                      )}
                      <span className="ml-auto text-[11px] text-faint">{timeAgo(c.received_at)}</span>
                    </div>

                    <div className="mt-1.5 truncate text-[12px] text-muted">{c.file_name || 'Document'}</div>
                    <div className="mt-0.5 text-[11.5px] text-faint">{c.reason || m.help}</div>

                    {c.extracted_text && (
                      <div className="mt-2 max-h-20 overflow-y-auto rounded-lg bg-surface-2 p-2 text-[11.5px] leading-relaxed text-muted">
                        {c.extracted_text.slice(0, 400)}{c.extracted_text.length > 400 ? '…' : ''}
                      </div>
                    )}

                    <div className="mt-2.5 flex items-center gap-2">
                      <button
                        disabled={working || !c.lead_id || !c.extracted_text}
                        onClick={() => resolve(c, 'approve')}
                        className={cn('btn btn-sm inline-flex items-center gap-1.5',
                          !c.lead_id || !c.extracted_text ? 'btn-outline opacity-40' : 'btn-primary')}
                        title={!c.lead_id ? 'No lead matches this sender'
                          : !c.extracted_text ? 'There is no text to save — open the chat and copy it in'
                          : 'Save this text to the lead'}>
                        <Check className="h-3.5 w-3.5" /> Save to lead
                      </button>
                      <button disabled={working} onClick={() => resolve(c, 'dismiss')}
                        className="btn btn-outline btn-sm inline-flex items-center gap-1.5">
                        <Trash2 className="h-3.5 w-3.5" /> Dismiss
                      </button>
                      <a href={`https://chat.migrizo.com/?c=${c.conversation_id}`} target="_blank" rel="noopener noreferrer"
                        className="ml-auto inline-flex items-center gap-1 text-[12px] font-medium text-indigo transition hover:underline">
                        Open chat <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
