'use client';

import { useState } from 'react';
import { Modal } from '@/components/shared/modal';
import { Select } from '@/components/shared/select';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { useApp } from '@/components/shared/app-provider';
import type { Payment, Milestone } from '@/lib/types';
import { MILESTONE_META } from '@/lib/types';
import { formatMoney, moneySymbol, cn } from '@/lib/utils';
import { FileText, Pencil, Trash2, Send } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  payment: Payment;
  currency?: string; // the lead's currency — single source of truth
}

export function PaymentRow({ payment, currency = 'INR' }: Props) {
  const { updatePayment, deletePayment, canSendEmails } = useApp();
  const [editOpen, setEditOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const [milestone, setMilestone] = useState<Milestone>(payment.milestone);
  const [amount, setAmount] = useState<string>(String(payment.amount));
  const [status, setStatus] = useState<Payment['status']>(payment.status);
  const [note, setNote] = useState(payment.note || '');
  const [busy, setBusy] = useState(false);
  const [sendingInvoice, setSendingInvoice] = useState(false);

  // One-click branded invoice email for this specific milestone payment.
  const isPaid = payment.status === 'paid';
  const docWord = isPaid ? 'Receipt' : 'Invoice';

  const sendInvoice = async (force = false) => {
    setSendingInvoice(true);
    try {
      const res = await fetch('/api/email/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'invoice', leadId: payment.lead_id, paymentId: payment.id, force }),
      });
      const j = await res.json().catch(() => null);
      if (j?.already_sent) {
        const again = window.confirm(`A ${docWord.toLowerCase()} for this payment was already sent. Send it again?`);
        if (again) { await sendInvoice(true); return; }
      } else if (j?.ok) {
        toast.success(`${docWord} emailed to client`);
      } else if (j?.reason === 'no_email') {
        toast.error('This lead has no email address');
      } else {
        toast.error(`Send failed${j?.reason ? `: ${j.reason}` : ''}`);
      }
    } catch {
      toast.error('Send failed — check your connection');
    } finally {
      setSendingInvoice(false);
    }
  };

  const openEditor = () => {
    setMilestone(payment.milestone);
    setAmount(String(payment.amount));
    setStatus(payment.status);
    setNote(payment.note || '');
    setEditOpen(true);
  };

  const save = async () => {
    const n = parseFloat(amount);
    if (!n || n < 0) return;
    setBusy(true);
    await updatePayment(payment.id, {
      milestone,
      amount: Math.round(n),
      status,
      note: note.trim() || null,
      paid_at: status === 'paid' ? (payment.paid_at || new Date().toISOString()) : null,
    });
    setBusy(false);
    setEditOpen(false);
  };

  const statusMeta: Record<Payment['status'], { label: string; bg: string; fg: string }> = {
    paid:    { label: 'Paid',    bg: 'hsl(var(--green-soft))', fg: '#047857' },
    pending: { label: 'Pending', bg: 'hsl(var(--amber-soft))', fg: '#B45309' },
    overdue: { label: 'Overdue', bg: 'hsl(var(--rose-soft))',  fg: '#B91C1C' },
  };

  return (
    <>
      <div className="p-3 rounded-xl border border-border group">
        <div className="flex items-center justify-between mb-1.5">
          <div>
            <div className="text-[13px] font-semibold">{MILESTONE_META[payment.milestone].label}</div>
            <div className="text-[11px] text-muted">{payment.paid_at ? `Paid · ${new Date(payment.paid_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}` : 'Not yet received'}</div>
          </div>
          <div className="flex items-center gap-2">
            <div className="text-right">
              <div className="num font-bold">{formatMoney(payment.amount, currency)}</div>
              <span className="chip" style={{ background: statusMeta[payment.status].bg, color: statusMeta[payment.status].fg, border: 'none' }}>{statusMeta[payment.status].label}</span>
            </div>
            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
              {canSendEmails && (
              <button
                onClick={() => sendInvoice(false)}
                disabled={sendingInvoice}
                className="group/send relative w-7 h-7 rounded-full flex items-center justify-center text-[#506BD8] bg-[#EEF2FF] hover:bg-[#506BD8] hover:text-white hover:shadow-sm transition-all disabled:opacity-50"
                title={`Email branded ${docWord.toLowerCase()} to client`}
              >
                {sendingInvoice
                  ? <span className="w-3 h-3 border-[1.5px] border-current border-t-transparent rounded-full animate-spin" />
                  : <Send className="w-3.5 h-3.5 transition-transform group-hover/send:translate-x-[1px] group-hover/send:-translate-y-[1px]" />}
              </button>
              )}
              <button onClick={openEditor} className="p-1.5 rounded hover:bg-surface-2 text-muted hover:text-ink" title="Edit payment">
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => setConfirmDelete(true)} className="p-1.5 rounded hover:bg-rose-50 text-muted hover:text-danger" title="Delete payment">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
        {payment.note && (
          <div className="mt-2 pt-2 border-t border-border flex items-start gap-1.5">
            <FileText className="w-3 h-3 text-muted flex-shrink-0 mt-0.5" />
            <div className="text-[11.5px] text-ink-2 leading-relaxed whitespace-pre-wrap">{payment.note}</div>
          </div>
        )}
      </div>

      <Modal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="Edit payment"
        subtitle="Correct the amount, status, or details"
        footer={<>
          <button onClick={() => setEditOpen(false)} className="btn btn-ghost" disabled={busy}>Cancel</button>
          <button onClick={save} disabled={busy || !amount || parseFloat(amount) < 0} className="btn btn-primary disabled:opacity-50">
            {busy ? 'Saving…' : 'Save changes'}
          </button>
        </>}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="input-label">Milestone</label>
              <Select<Milestone>
                value={milestone}
                onChange={setMilestone}
                options={(Object.keys(MILESTONE_META) as Milestone[]).map((m) => ({ value: m, label: `${MILESTONE_META[m].label} (${MILESTONE_META[m].pct}%)` }))}
              />
            </div>
            <div>
              <label className="input-label">Amount ({moneySymbol(currency)})</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-faint text-[13px] num">{moneySymbol(currency)}</span>
                <input type="number" min="0" className="input pl-8" placeholder="0" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </div>
              {amount && Number(amount) > 0 && <div className="text-[11px] text-muted mt-1">{formatMoney(Math.round(Number(amount)), currency)}</div>}
            </div>
          </div>

          <div>
            <label className="input-label">Status</label>
            <div className="flex gap-2">
              {(['paid', 'pending', 'overdue'] as Payment['status'][]).map((s) => (
                <button key={s} onClick={() => setStatus(s)} className={cn('flex-1 py-2 rounded-md text-[12.5px] font-medium border transition', status === s ? 'border-transparent' : 'border-border hover:bg-surface-2 text-muted')}
                  style={status === s ? { background: statusMeta[s].bg, color: statusMeta[s].fg } : undefined}>
                  {statusMeta[s].label}
                </button>
              ))}
            </div>
            <div className="text-[11px] text-faint mt-1">
              {status === 'paid' && 'Money received. Counts toward Collected.'}
              {status === 'pending' && 'Expected but not yet received. Does NOT count toward Collected.'}
              {status === 'overdue' && 'Was expected, deadline passed, still not received.'}
            </div>
          </div>

          <div>
            <label className="input-label">Note <span className="text-faint">(reference, mode, etc.)</span></label>
            <textarea className="input" rows={3} placeholder="Reference number, UPI, bank transfer…" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={async () => { await deletePayment(payment.id); setConfirmDelete(false); }}
        title="Delete this payment?"
        description={`This will delete the ${MILESTONE_META[payment.milestone].label} payment of ${formatMoney(payment.amount, currency)}. The client's Collected total will be reduced automatically. This cannot be undone.`}
        confirmLabel="Delete payment"
        variant="danger"
      />
    </>
  );
}
