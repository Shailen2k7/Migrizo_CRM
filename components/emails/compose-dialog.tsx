'use client';

// ============================================================================
// COMPOSE DIALOG + LEAD EMAIL THREAD
// ComposeDialog — write a free-form email; the sender's saved signature is
//   previewed live and auto-appended on send (via /api/email/compose).
// LeadEmailThread — the two-way conversation: sent (indigo) / received (green).
// ============================================================================
import { useState, useEffect } from 'react';
import { X, Send, Loader2, Inbox as InboxIcon, ArrowUpRight, ArrowDownLeft } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { DEFAULT_SIGNATURE, type EmailSignature } from '@/lib/email/custom';
import { toast } from 'sonner';

export interface LeadEmailRow {
  id: string; direction: 'out' | 'in'; from_email: string; to_email: string;
  subject: string; body_text: string; status: string; error: string | null; created_at: string;
}

// ── Compose ────────────────────────────────────────────────────────────────
export function ComposeDialog({ open, leadId, toEmail, toName, workspaceId, userId, onClose, onSent }: {
  open: boolean; leadId: string; toEmail: string; toName: string; workspaceId: string; userId: string;
  onClose: () => void; onSent: () => void;
}) {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [sig, setSig] = useState<EmailSignature>(DEFAULT_SIGNATURE);

  // Load the sender's saved signature for the live preview.
  useEffect(() => {
    if (!open) return;
    const supabase = createClient();
    supabase.from('email_signatures').select('signature').eq('workspace_id', workspaceId).eq('user_id', userId).maybeSingle()
      .then(({ data }) => setSig({ ...DEFAULT_SIGNATURE, ...((data?.signature as Partial<EmailSignature>) || {}) }));
  }, [open, workspaceId, userId]);

  // Escape closes (unless mid-send).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !sending) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, sending, onClose]);

  if (!open) return null;

  const send = async () => {
    if (!subject.trim()) { toast.error('Add a subject'); return; }
    if (!body.trim()) { toast.error('Write a message'); return; }
    setSending(true);
    try {
      const res = await fetch('/api/email/compose', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId, subject: subject.trim(), body: body.trim() }),
      });
      const j = await res.json().catch(() => null);
      if (j?.ok) {
        toast.success(`Email sent to ${toEmail}`);
        setSubject(''); setBody('');
        onSent(); onClose();
      } else {
        toast.error(`Send failed${j?.reason ? `: ${j.reason}` : ''}`);
      }
    } catch {
      toast.error('Send failed — check your connection');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4" onClick={() => !sending && onClose()}>
      <div className="bg-surface w-full max-w-[560px] max-h-[90vh] overflow-y-auto rounded-2xl shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-[15px] font-bold text-ink">Compose email</h2>
          <button onClick={() => !sending && onClose()} className="p-1.5 rounded-md hover:bg-surface-2 text-muted"><X className="w-4 h-4" /></button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <div>
            <div className="text-[10.5px] font-bold uppercase tracking-wide text-muted mb-1">To</div>
            <div className="px-3 py-2.5 border border-border rounded-lg text-[13px] bg-surface-2 text-ink">{toName} &lt;{toEmail}&gt;</div>
          </div>
          <div>
            <div className="text-[10.5px] font-bold uppercase tracking-wide text-muted mb-1">Subject</div>
            <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" maxLength={200}
              className="w-full px-3 py-2.5 border border-border rounded-lg text-[13px] focus:border-indigo outline-none" />
          </div>
          <div>
            <div className="text-[10.5px] font-bold uppercase tracking-wide text-muted mb-1">Message</div>
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={8} placeholder="Write your message… (blank line = new paragraph)"
              className="w-full px-3 py-2.5 border border-border rounded-lg text-[13px] focus:border-indigo outline-none resize-y" />
          </div>
          {/* Signature preview — auto-appended on send */}
          <div className="rounded-lg border border-dashed border-[#C7D0F0] bg-[#F7F8FC] px-3.5 py-3">
            <div className="text-[10px] font-bold uppercase tracking-wide text-[#4F46E5] mb-1.5">Signature · added automatically</div>
            <div className="text-[12.5px] leading-relaxed text-ink-2">
              {sig.closing}<br />
              <span className="font-bold text-ink">{sig.name}</span><br />
              <span className="text-muted">{sig.title}</span><br />
              <span className="font-semibold">{sig.company}</span><br />
              <span className="text-muted text-[12px]">{sig.phone} · {sig.website.replace(/^https?:\/\//, '')} · {sig.email}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 px-5 py-4 border-t border-border bg-surface-2 rounded-b-2xl">
          <button onClick={() => void send()} disabled={sending} className="btn btn-primary btn-sm">
            {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} {sending ? 'Sending…' : 'Send email'}
          </button>
          <button onClick={() => !sending && onClose()} className="btn btn-outline btn-sm">Cancel</button>
          <span className="ml-auto text-[10.5px] text-faint">Replies go to info@migrizo.com</span>
        </div>
      </div>
    </div>
  );
}

// ── Thread ─────────────────────────────────────────────────────────────────
export function LeadEmailThread({ rows }: { rows: LeadEmailRow[] | null }) {
  if (rows === null) return <div className="py-6 text-center text-[12.5px] text-muted">Loading conversation…</div>;
  if (rows.length === 0) {
    return (
      <div className="text-center py-8 rounded-md border border-dashed border-border mb-5">
        <InboxIcon className="w-6 h-6 text-faint mx-auto mb-2" />
        <div className="text-[12.5px] text-muted mb-1">No conversation yet</div>
        <div className="text-[11px] text-faint max-w-[300px] mx-auto">Emails you compose and the client&apos;s replies will appear here as a thread.</div>
      </div>
    );
  }
  const fmt = (s: string) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(s));
  return (
    <div className="space-y-2.5 mb-5">
      {rows.map((r) => {
        const out = r.direction === 'out';
        const failed = r.status === 'failed';
        return (
          <div key={r.id} className="rounded-[10px] border px-3.5 py-2.5"
            style={out ? { background: failed ? '#FDECEC' : '#EEF2FF', borderColor: failed ? '#F5C6C6' : '#DEE4FF' } : { background: '#EAFBF1', borderColor: '#CFEEDB' }}>
            <div className="flex items-center gap-2 flex-wrap">
              {out ? <ArrowUpRight className="w-3.5 h-3.5" style={{ color: failed ? '#B91C1C' : '#4338CA' }} /> : <ArrowDownLeft className="w-3.5 h-3.5" style={{ color: '#047857' }} />}
              <span className="text-[12.5px] font-bold text-ink truncate">{r.subject || '(no subject)'}</span>
              <span className="ml-auto text-[9.5px] font-extrabold tracking-wide px-2 py-0.5 rounded-full text-white" style={{ background: failed ? '#B91C1C' : out ? '#4F46E5' : '#059669' }}>
                {failed ? 'FAILED' : out ? 'SENT' : 'RECEIVED'}
              </span>
            </div>
            {r.body_text && <div className="text-[12px] text-ink-2 mt-1.5 whitespace-pre-wrap" style={{ display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{r.body_text}</div>}
            <div className="text-[10.5px] text-faint mt-1.5">{out ? `To ${r.to_email}` : `From ${r.from_email}`} · {fmt(r.created_at)}{failed && r.error ? ` · ${r.error.slice(0, 80)}` : ''}</div>
          </div>
        );
      })}
    </div>
  );
}
