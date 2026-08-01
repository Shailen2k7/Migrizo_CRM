'use client';

// =============================================================================
// DOCUMENT EDITOR — review and edit an outgoing document before it sends.
//
// Flow: the drawer asks /api/email/send with { preview: true }, which returns
// the fully rendered document (subject + html) without sending anything. That
// html is loaded into an iframe with editing switched on, so what you edit is
// pixel-identical to what the client receives. Pressing Send posts the edited
// html back as overrideHtml.
//
// Deliberate constraints:
//   - The document template in code stays the single source of truth. Edits
//     here apply to THIS send only; they are not saved back to the template,
//     so a slip of the keyboard can never silently rewrite the contract for
//     every future client.
//   - An iframe is used rather than dangerouslySetInnerHTML because agreement
//     documents are full HTML pages with their own styles; rendering them
//     inside the app's DOM would let the app's CSS bleed in and the preview
//     would lie.
// =============================================================================

import { useState, useRef, useEffect, useCallback } from 'react';
import { X, Send, Pencil, Eye, Loader2, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Which document this is, for the title bar. */
  docLabel: string;
  /** Fetch the rendered preview. Returns null on failure (already toasted). */
  fetchPreview: () => Promise<{ subject: string; html: string } | null>;
  /** Send with the (possibly edited) subject and html. Resolves true on success. */
  send: (subject: string, html: string) => Promise<boolean>;
  recipient: string;
}

export function DocEditorModal({ open, onClose, docLabel, fetchPreview, send, recipient }: Props) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [subject, setSubject] = useState('');
  const [editing, setEditing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const original = useRef<string>('');

  const load = useCallback(async () => {
    setLoading(true);
    setEditing(false);
    setDirty(false);
    const doc = await fetchPreview();
    setLoading(false);
    if (!doc) { onClose(); return; }
    setSubject(doc.subject);
    original.current = doc.html;
    const f = frame.current;
    if (f) {
      f.srcdoc = doc.html;
    }
  }, [fetchPreview, onClose]);

  useEffect(() => {
    if (open) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const setEditable = (on: boolean) => {
    const d = frame.current?.contentDocument;
    if (!d) return;
    d.designMode = on ? 'on' : 'off';
    setEditing(on);
    if (on) {
      // Any keystroke marks the document as changed.
      d.addEventListener('input', () => setDirty(true), { once: true });
    }
  };

  const restore = () => {
    const f = frame.current;
    if (!f) return;
    f.srcdoc = original.current;
    setDirty(false);
    setEditing(false);
    toast.success('Restored the original document');
  };

  const doSend = async () => {
    const d = frame.current?.contentDocument;
    if (!d) return;
    d.designMode = 'off';
    const html = '<!DOCTYPE html>\n' + (d.documentElement?.outerHTML || '');
    setSending(true);
    const ok = await send(subject, dirty ? html : original.current);
    setSending(false);
    if (ok) onClose();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center p-3 sm:p-6">
      <div className="absolute inset-0 bg-black/45" onClick={() => !sending && onClose()} />
      <div className="relative bg-surface rounded-2xl shadow-2xl w-full max-w-[860px] h-[92vh] flex flex-col overflow-hidden">

        {/* header */}
        <div className="flex items-center gap-3 px-4 sm:px-5 py-3 border-b border-border flex-shrink-0">
          <div className="min-w-0">
            <div className="text-[14px] font-semibold truncate">{docLabel}</div>
            <div className="text-[11.5px] text-muted truncate">To {recipient}{dirty ? ' · edited for this send only' : ''}</div>
          </div>
          <div className="ml-auto flex items-center gap-2 flex-shrink-0">
            {!editing ? (
              <button onClick={() => setEditable(true)} disabled={loading}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12.5px] font-medium text-[#506BD8] bg-white border border-[#C7D0F0] hover:bg-[#EEF2FF] transition-all disabled:opacity-50">
                <Pencil className="w-3.5 h-3.5" /> Edit document
              </button>
            ) : (
              <button onClick={() => setEditable(false)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12.5px] font-medium bg-ink text-white transition-all">
                <Eye className="w-3.5 h-3.5" /> Done editing
              </button>
            )}
            {dirty && (
              <button onClick={restore} title="Throw away your edits and restore the original"
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12.5px] text-muted hover:text-ink hover:bg-surface-2 transition-all">
                <RotateCcw className="w-3.5 h-3.5" /> Restore
              </button>
            )}
            <button onClick={() => !sending && onClose()} className="p-1.5 text-faint hover:text-ink"><X className="w-5 h-5" /></button>
          </div>
        </div>

        {/* subject */}
        <div className="px-4 sm:px-5 py-2.5 border-b border-border flex items-center gap-2.5 flex-shrink-0">
          <span className="text-[10px] font-extrabold tracking-[0.08em] uppercase text-faint flex-shrink-0">Subject</span>
          <input value={subject} onChange={(e) => setSubject(e.target.value)}
            className="flex-1 text-[13px] px-3 py-1.5 rounded-lg border border-border bg-surface outline-none focus:border-indigo-400" />
        </div>

        {/* the document itself */}
        <div className={cn('flex-1 min-h-0 relative bg-[#F0F1F4]', editing && 'ring-2 ring-inset ring-amber-300')}>
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center text-muted text-[13px]">
              <Loader2 className="w-4 h-4 animate-spin mr-2" /> Preparing the document…
            </div>
          )}
          <iframe ref={frame} title="Document preview" className="w-full h-full border-0 bg-white" />
        </div>

        {/* footer */}
        <div className="flex items-center gap-3 px-4 sm:px-5 py-3 border-t border-border flex-shrink-0">
          <span className="text-[11.5px] text-faint">
            {editing
              ? 'Click into the document and type. Edits apply to this send only — the template is never changed.'
              : 'This is exactly what the client receives.'}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={onClose} disabled={sending} className="btn">Cancel</button>
            <button onClick={() => void doSend()} disabled={loading || sending}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-[13px] font-semibold text-white bg-[#4F46E5] hover:bg-[#4338CA] transition-all disabled:opacity-50">
              <Send className="w-3.5 h-3.5" /> {sending ? 'Sending…' : dirty ? 'Send edited version' : 'Send'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
