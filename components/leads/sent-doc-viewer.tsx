'use client';

// =============================================================================
// SENT DOCUMENT VIEWER — read-only view of a branded email already sent
// (SLA, onboarding, invoice…), opened from the drawer's email history.
//
// Content comes from /api/email/document: the exact copy when one was kept,
// otherwise (older SLAs) a rebuild from the template, which is labelled so
// nobody mistakes it for the original. Rendered in a sandboxed iframe for the
// same reason as the editor: the document carries its own styles.
// =============================================================================

import { useEffect, useState } from 'react';
import { X, Loader2, Printer, Info } from 'lucide-react';
import { wrapForPrint, safeFileTitle } from '@/lib/email/print';

interface Doc { subject: string; html: string; to: string; exact: boolean; edited?: boolean }

interface Props {
  /** The 'email_sent' activity row to show; null keeps the viewer closed. */
  activityId: string | null;
  label: string;
  sentAt: string | null;
  onClose: () => void;
}

const REASONS: Record<string, string> = {
  not_kept: 'A copy of this email wasn’t kept. Copies are saved for everything sent from now on.',
  forbidden: 'You don’t have permission to view client documents.',
  not_found: 'This email could not be found.',
};

export function SentDocViewer({ activityId, label, sentAt, onClose }: Props) {
  const [doc, setDoc] = useState<Doc | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!activityId) return;
    let cancelled = false;
    setDoc(null);
    setError(null);
    fetch(`/api/email/document?activity=${encodeURIComponent(activityId)}`)
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        if (j?.ok) setDoc(j as Doc);
        else setError(REASONS[j?.reason] || 'Could not load this email.');
      })
      .catch(() => { if (!cancelled) setError('Could not load this email.'); });
    return () => { cancelled = true; };
  }, [activityId]);

  useEffect(() => {
    if (!activityId) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activityId, onClose]);

  const print = () => {
    if (!doc) return;
    const url = URL.createObjectURL(new Blob([wrapForPrint(doc.html, safeFileTitle(doc.subject))], { type: 'text/html' }));
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  if (!activityId) return null;

  const when = sentAt
    ? `${new Date(sentAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })} · ${new Date(sentAt).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}`
    : '';

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center p-3 sm:p-6">
      <div className="absolute inset-0 bg-black/45" onClick={onClose} />
      <div className="relative bg-surface rounded-2xl shadow-2xl w-full max-w-[860px] h-[92vh] flex flex-col overflow-hidden">

        {/* header */}
        <div className="flex items-center gap-3 px-4 sm:px-5 py-3 border-b border-border flex-shrink-0">
          <div className="min-w-0">
            <div className="text-[14px] font-semibold truncate">{label}</div>
            <div className="text-[11.5px] text-muted truncate">
              {doc?.to ? `To ${doc.to}` : ''}{doc?.to && when ? ' · ' : ''}{when ? `Sent ${when}` : ''}
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2 flex-shrink-0">
            {doc && (
              <button onClick={print} title="Open a print view — choose “Save as PDF” to download"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12.5px] font-medium text-[#506BD8] bg-white border border-[#C7D0F0] hover:bg-[#EEF2FF] transition-all">
                <Printer className="w-3.5 h-3.5" /> Print / PDF
              </button>
            )}
            <button onClick={onClose} className="p-1.5 text-faint hover:text-ink"><X className="w-5 h-5" /></button>
          </div>
        </div>

        {/* subject */}
        {doc && (
          <div className="px-4 sm:px-5 py-2.5 border-b border-border flex items-center gap-2.5 flex-shrink-0">
            <span className="text-[10px] font-extrabold tracking-[0.08em] uppercase text-faint flex-shrink-0">Subject</span>
            <span className="text-[13px] truncate">{doc.subject}</span>
          </div>
        )}

        {/* rebuilt-copy notice */}
        {doc && !doc.exact && (
          <div className="px-4 sm:px-5 py-2.5 border-b border-amber-200 bg-amber-50 flex items-start gap-2 flex-shrink-0 text-[12px] text-amber-900">
            <Info className="w-4 h-4 flex-shrink-0 mt-px" />
            <span>
              Rebuilt from the agreement template with this client’s current details
              {doc.edited ? '. This one was edited before sending, and those edits weren’t saved, so wording may differ from what the client received.' : '. Sent before copies were kept, so it may differ slightly if the template has changed since.'}
            </span>
          </div>
        )}

        {/* the document itself */}
        <div className="flex-1 min-h-0 relative bg-[#F0F1F4]">
          {!doc && !error && (
            <div className="absolute inset-0 flex items-center justify-center text-muted text-[13px]">
              <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading the document…
            </div>
          )}
          {error && (
            <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-muted text-[13px]">{error}</div>
          )}
          {doc && (
            <iframe title="Sent document" srcDoc={doc.html} sandbox="allow-popups allow-popups-to-escape-sandbox"
              className="w-full h-full border-0 bg-white" />
          )}
        </div>
      </div>
    </div>
  );
}
