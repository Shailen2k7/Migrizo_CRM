'use client';

import { useState } from 'react';
import { Modal } from '@/components/shared/modal';
import { Select } from '@/components/shared/select';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { useApp } from '@/components/shared/app-provider';
import type { Payment, Milestone } from '@/lib/types';
import { MILESTONE_META } from '@/lib/types';
import { formatMoney, moneySymbol, cn } from '@/lib/utils';
import { FileText, Pencil, Trash2, Send, Download, X, Percent, Building2, MapPin, Receipt } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  payment: Payment;
  currency?: string; // the lead's currency — single source of truth
}

export function PaymentRow({ payment, currency = 'INR' }: Props) {
  const { updatePayment, deletePayment, canSendEmails, leads, updateLead } = useApp();
  const [editOpen, setEditOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const [milestone, setMilestone] = useState<Milestone>(payment.milestone);
  const [amount, setAmount] = useState<string>(String(payment.amount));
  const [status, setStatus] = useState<Payment['status']>(payment.status);
  const [note, setNote] = useState(payment.note || '');
  const [busy, setBusy] = useState(false);
  const [sendingInvoice, setSendingInvoice] = useState(false);
  // GST bar — mirrors the SLA discount flow: click Send, set the rate, send.
  const [gstOpen, setGstOpen] = useState(false);
  const [gstRate, setGstRate] = useState<string>(String(payment.gst_rate ?? 0));
  const [gstMode, setGstMode] = useState<'add' | 'inclusive'>((payment.gst_mode ?? 'add') as 'add' | 'inclusive');
  const [savingGst, setSavingGst] = useState(false);

  // ── the client's GST number ───────────────────────────────────────────────
  // It belongs to the CLIENT, so it is read from and written to the lead. Type
  // it once here and every future invoice for this person already carries it.
  const lead = leads.find((l) => l.id === payment.lead_id);
  const [gstin, setGstin] = useState<string>(lead?.gstin || '');
  const cleanGstin = gstin.replace(/\s+/g, '').toUpperCase();
  const gstinValid = cleanGstin.length === 0 || /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/.test(cleanGstin);
  const gstinLooksShort = cleanGstin.length > 0 && cleanGstin.length !== 15;
  // Migrizo is registered in Uttar Pradesh (09...). A client registered in a
  // different state is an INTERSTATE supply, which is normally IGST at the full
  // rate rather than CGST+SGST at half each. We flag it rather than silently
  // changing the tax on an invoice — that is an accounting decision.
  const OUR_STATE = '09';
  const interstate = cleanGstin.length === 15 && cleanGstin.slice(0, 2) !== OUR_STATE;

  // ── the client's billing address ──────────────────────────────────────────
  // Also the CLIENT's, so it lives on the lead beside the GSTIN (migration
  // 123). One free-text field: addresses are pasted whole, from India and
  // abroad, and print line for line. Tidied, never rewritten — trailing spaces
  // and runs of blank lines go, everything the person typed stays.
  const ADDRESS_MAX = 600;
  const [address, setAddress] = useState<string>(lead?.billing_address || '');
  const cleanAddress = address
    .split(/\r?\n/).map((line) => line.replace(/\s+$/, ''))
    .join('\n').replace(/\n{3,}/g, '\n\n').trim();
  const addressLines = cleanAddress ? cleanAddress.split('\n') : [];

  // One-click branded invoice email for this specific milestone payment.
  const isPaid = payment.status === 'paid';
  const docWord = isPaid ? 'Receipt' : 'Invoice';

  const rateNum = Math.min(Math.max(Number(gstRate) || 0, 0), 100);
  const preview = (() => {
    const a = payment.amount || 0;
    if (rateNum <= 0) return { taxable: a, gst: 0, total: a };
    if (gstMode === 'inclusive') {
      const g = (a * rateNum) / (100 + rateNum);
      return { taxable: a - g, gst: g, total: a };
    }
    const g = (a * rateNum) / 100;
    return { taxable: a, gst: g, total: a + g };
  })();

  /**
   * Persist the GST on the payment BEFORE emailing or printing. Both the email
   * route and the PDF route read the rate from the row, so saving first is what
   * guarantees the document the client receives matches the one you preview.
   */
  const saveGst = async (): Promise<boolean> => {
    const gstinChanged = cleanGstin !== (lead?.gstin || '');
    const addressChanged = cleanAddress !== (lead?.billing_address || '');
    const rateChanged = rateNum !== Number(payment.gst_rate ?? 0) || gstMode !== (payment.gst_mode ?? 'add');
    if (!rateChanged && !gstinChanged && !addressChanged) return true;
    setSavingGst(true);
    // The client's details go on the lead, the rate on the payment. A
    // malformed GSTIN is never written — the invoice would carry it to the
    // client's accountant. Both client fields go in ONE write so the document
    // can never print a new address beside an old GST number.
    const clientPatch: { gstin?: string | null; billing_address?: string | null } = {};
    if (gstinChanged && (gstinValid || cleanGstin.length === 0)) clientPatch.gstin = cleanGstin || null;
    if (addressChanged) clientPatch.billing_address = cleanAddress || null;
    // If the client's details did not save, STOP: sending or downloading now
    // would produce an invoice without the address you can see in the preview.
    if (lead && Object.keys(clientPatch).length) {
      const ok = await updateLead(lead.id, clientPatch);
      if (!ok) { setSavingGst(false); return false; }
    }
    if (rateChanged) await updatePayment(payment.id, { gst_rate: rateNum, gst_mode: gstMode });
    setSavingGst(false);
    return true;
  };

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

  /**
   * Download the invoice as a PDF — the same document the client is emailed.
   *
   * Opened SYNCHRONOUSLY in a new tab (no await before window.open) so popup
   * blockers treat it as a user gesture. The route renders the invoice with
   * print CSS and opens the print dialog; the user picks "Save as PDF".
   */
  const downloadPdf = () => {
    // The PDF route reads GST from the payment row, so what downloads always
    // matches what was emailed.
    const w = window.open(`/api/invoice/pdf?paymentId=${encodeURIComponent(payment.id)}`, '_blank');
    if (!w) { toast.error('Popup blocked — allow popups for the CRM to download the PDF'); return; }
    toast.info('Choose “Save as PDF” in the print dialog');
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
                onClick={() => setGstOpen((v) => !v)}
                disabled={sendingInvoice}
                className="group/send relative w-7 h-7 rounded-full flex items-center justify-center text-[#506BD8] bg-[#EEF2FF] hover:bg-[#506BD8] hover:text-white hover:shadow-sm transition-all disabled:opacity-50"
                title={`Email branded ${docWord.toLowerCase()} to client — set GST first if applicable`}
              >
                {sendingInvoice
                  ? <span className="w-3 h-3 border-[1.5px] border-current border-t-transparent rounded-full animate-spin" />
                  : <Send className="w-3.5 h-3.5 transition-transform group-hover/send:translate-x-[1px] group-hover/send:-translate-y-[1px]" />}
              </button>
              )}
              {/* Download is NOT gated on canSendEmails: saving a copy of a
                  document you can already see on screen is not the same
                  privilege as emailing the client. */}
              <button
                onClick={downloadPdf}
                className="group/dl relative w-7 h-7 rounded-full flex items-center justify-center text-[#047857] bg-[#E6F7EE] hover:bg-[#047857] hover:text-white hover:shadow-sm transition-all"
                title={`Download ${docWord.toLowerCase()} as PDF`}
              >
                <Download className="w-3.5 h-3.5 transition-transform group-hover/dl:translate-y-[1px]" />
              </button>
              <button onClick={openEditor} className="p-1.5 rounded hover:bg-surface-2 text-muted hover:text-ink" title="Edit payment">
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => setConfirmDelete(true)} className="p-1.5 rounded hover:bg-rose-50 text-muted hover:text-danger" title="Delete payment">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
        {/* GST bar — same shape as the SLA discount flow: set the rate, see
            the total the client will owe, then send or download. */}
        {gstOpen && (
          <div className="mt-2.5 pt-2.5 border-t border-border animate-pageIn">
            <div className="flex flex-wrap items-center gap-2">
              <span className="mr-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">Tax</span>
              <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-ink-2">
                <Percent className="w-3.5 h-3.5 text-muted" /> GST
              </span>
              <input
                autoFocus type="number" min="0" max="100" step="0.5" value={gstRate}
                onChange={(e) => setGstRate(e.target.value)}
                placeholder="0"
                className="w-[70px] px-2 py-1 rounded-md border border-border bg-surface text-[12.5px] outline-none focus:border-[#4F46E5]"
              />
              <span className="text-[12px] text-muted">%</span>
              <div className="inline-flex items-center gap-1 rounded-lg bg-surface-2 p-0.5">
                {(['add', 'inclusive'] as const).map((m) => (
                  <button key={m} onClick={() => setGstMode(m)}
                    className={cn('px-2.5 py-1 rounded-md text-[11.5px] font-semibold transition',
                      gstMode === m ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink')}>
                    {m === 'add' ? 'Add on top' : 'Already included'}
                  </button>
                ))}
              </div>
              <button onClick={() => { setGstOpen(false); setGstRate(String(payment.gst_rate ?? 0)); setGstMode((payment.gst_mode ?? 'add') as 'add' | 'inclusive'); setGstin(lead?.gstin || ''); setAddress(lead?.billing_address || ''); }}
                className="p-1 rounded hover:bg-surface-2 text-muted hover:text-ink" title="Cancel">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* ── Bill to ─────────────────────────────────────────────────
                The client's details on the left, the block exactly as the
                invoice will print it on the right — so nobody sends a
                document to find out what it says. */}
            <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
              <div className="flex min-w-0 flex-col gap-2.5">
                <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">Bill to</div>

                <label className="block">
                  <span className="mb-1 flex items-center gap-1.5 text-[11.5px] font-medium text-ink-2">
                    <Building2 className="h-3.5 w-3.5 text-muted" /> GSTIN
                    <span className="font-normal text-faint">· optional</span>
                    {cleanGstin.length > 0 && gstinValid && <span className="ml-auto text-[11px] font-semibold text-[#047857]">looks right</span>}
                    {cleanGstin.length > 0 && !gstinValid && (
                      <span className="ml-auto text-[11px] text-[#B91C1C]">
                        {gstinLooksShort ? `${cleanGstin.length} of 15` : 'invalid format'}
                      </span>
                    )}
                  </span>
                  <input
                    type="text" value={gstin} maxLength={20}
                    onChange={(e) => setGstin(e.target.value)}
                    placeholder="22AAAAA0000A1Z5"
                    spellCheck={false}
                    className={cn(
                      'w-full rounded-lg border bg-surface px-2.5 py-1.5 text-[12.5px] uppercase tracking-wide outline-none transition',
                      cleanGstin.length === 0 ? 'border-border focus:border-[#4F46E5]'
                        : gstinValid ? 'border-[#A7F3D0] focus:border-[#047857]'
                        : 'border-[#FCA5A5] focus:border-[#B91C1C]',
                    )}
                  />
                </label>

                <label className="block">
                  <span className="mb-1 flex items-center gap-1.5 text-[11.5px] font-medium text-ink-2">
                    <MapPin className="h-3.5 w-3.5 text-muted" /> Billing address
                    <span className="font-normal text-faint">· optional</span>
                    {address.length > ADDRESS_MAX - 80 && (
                      <span className={cn('ml-auto text-[11px] tabular-nums', address.length > ADDRESS_MAX ? 'text-[#B91C1C]' : 'text-faint')}>
                        {address.length}/{ADDRESS_MAX}
                      </span>
                    )}
                  </span>
                  <textarea
                    value={address}
                    onChange={(e) => setAddress(e.target.value.slice(0, ADDRESS_MAX))}
                    rows={4}
                    placeholder={'Flat 12, Green Park Residency\nSector 62, Noida\nUttar Pradesh 201301, India'}
                    className="w-full resize-none rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[12.5px] leading-relaxed outline-none transition placeholder:text-faint focus:border-[#4F46E5]"
                  />
                  <span className="mt-1 block text-[11px] text-faint">Paste it as it should appear — each line prints as a line.</span>
                </label>

                {(lead?.gstin || lead?.billing_address) && (cleanGstin !== (lead?.gstin || '') || cleanAddress !== (lead?.billing_address || '')) && (
                  <button onClick={() => { setGstin(lead?.gstin || ''); setAddress(lead?.billing_address || ''); }}
                    className="self-start text-[11px] text-muted underline hover:text-ink">Undo changes</button>
                )}
              </div>

              {/* Live preview — the same fields, order and tone as the invoice's BILL TO. */}
              <div className="flex min-w-0 flex-col">
                <div className="mb-2.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">
                  <Receipt className="h-3 w-3" /> On the invoice
                </div>
                <div className="flex-1 rounded-xl border border-[#E7EAF1] bg-[#F7F8FC] px-4 py-3.5 dark:border-border dark:bg-surface-2">
                  <div className="text-[9.5px] font-extrabold tracking-[0.1em] text-[#8A91A3]">BILL TO</div>
                  <div className="mt-1.5 break-words text-[13.5px] font-extrabold leading-snug text-[#12205A] dark:text-ink">{lead?.full_name || 'Client name'}</div>
                  {addressLines.length > 0 ? (
                    <div className="mt-1.5 text-[11.8px] leading-[1.55] text-[#4A5162] dark:text-ink-2">
                      {addressLines.map((line, i) => <div key={i} className="break-words">{line || '\u00A0'}</div>)}
                    </div>
                  ) : (
                    <div className="mt-1.5 text-[11.5px] italic text-faint">No address — this line is left out</div>
                  )}
                  {lead?.email && <div className="mt-1.5 break-all text-[11.8px] leading-[1.6] text-[#4A5162] dark:text-ink-2">{lead.email}</div>}
                  {lead?.phone && <div className="text-[11.8px] leading-[1.6] text-[#4A5162] dark:text-ink-2">{lead.phone}</div>}
                  {cleanGstin.length > 0 && gstinValid && (
                    <div className="mt-1.5 text-[11.5px] text-[#1A1D29] dark:text-ink"><b>GSTIN:</b> {cleanGstin}</div>
                  )}
                </div>
              </div>
            </div>

            {interstate && (
              <div className="mt-1.5 rounded-lg border border-[#FDE68A] bg-[hsl(var(--amber-soft))] px-2.5 py-1.5 text-[11.5px] leading-relaxed text-[#92400E]">
                This GSTIN is registered in another state, so the supply is interstate.
                The invoice will still print <b>CGST + SGST</b>. If it should be <b>IGST {rateNum || 18}%</b> instead, say so and it will be changed.
              </div>
            )}

            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-muted">
              <span>Taxable <b className="text-ink-2 num">{formatMoney(Math.round(preview.taxable), currency)}</b></span>
              {rateNum > 0 && <span>GST <b className="text-ink-2 num">{formatMoney(Math.round(preview.gst), currency)}</b></span>}
              <span>Client pays <b className="text-ink num">{formatMoney(Math.round(preview.total), currency)}</b></span>
              {rateNum > 0 && (
                <span className="text-faint">CGST {(rateNum / 2)}% + SGST {(rateNum / 2)}%</span>
              )}
            </div>

            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <button
                onClick={async () => { if (await saveGst()) downloadPdf(); }}
                disabled={savingGst || sendingInvoice || !gstinValid}
                title={!gstinValid ? 'Fix or clear the GSTIN first' : undefined}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12.5px] font-medium text-ink-2 bg-surface border border-border hover:bg-surface-2 transition-all disabled:opacity-50"
              >
                <Download className="w-3.5 h-3.5" /> Save &amp; download PDF
              </button>
              <button
                onClick={async () => { if (!(await saveGst())) return; setGstOpen(false); void sendInvoice(false); }}
                disabled={savingGst || sendingInvoice || !gstinValid}
                title={!gstinValid ? 'Fix or clear the GSTIN first' : undefined}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12.5px] font-semibold text-white bg-[#4F46E5] hover:bg-[#4338CA] transition-all disabled:opacity-50"
              >
                <Send className="w-3.5 h-3.5" />
                {savingGst ? 'Saving…' : sendingInvoice ? 'Sending…' : rateNum > 0 ? `Send with ${rateNum}% GST` : 'Send without GST'}
              </button>
            </div>
          </div>
        )}
        {/* GST is part of the money on this row, so it stays visible without
            opening anything. */}
        {!gstOpen && Number(payment.gst_rate ?? 0) > 0 && (
          <div className="mt-2 pt-2 border-t border-border flex items-center gap-1.5 text-[11.5px] text-muted">
            <Percent className="w-3 h-3 flex-shrink-0" />
            GST {Number(payment.gst_rate)}% {payment.gst_mode === 'inclusive' ? 'included' : 'added'} ·
            client pays <b className="text-ink-2 num">{formatMoney(Math.round(
              payment.gst_mode === 'inclusive'
                ? payment.amount
                : payment.amount * (1 + Number(payment.gst_rate) / 100)), currency)}</b>
            {lead?.gstin && <span className="text-faint">· GSTIN {lead.gstin}</span>}
            {lead?.billing_address && <span className="text-faint">· address on file</span>}
          </div>
        )}
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
