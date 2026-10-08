'use client';

import { useState, useEffect, useMemo } from 'react';
import { Modal } from '@/components/shared/modal';
import { useApp } from '@/components/shared/app-provider';
import { MILESTONE_META, IFV_MILESTONE_META, isIfvVisa } from '@/lib/types';
import type { Milestone, Payment, Currency, Lead } from '@/lib/types';
import { formatMoney, moneySymbol, cn, fxStanding } from '@/lib/utils';
import { Select } from '@/components/shared/select';
import { Wallet, CheckCircle2, CalendarClock, AlertTriangle, ArrowRightLeft } from 'lucide-react';

interface Props { open: boolean; onClose: () => void; presetLeadId?: string | null; }

type RecordMode = 'received' | 'scheduled';

/** Today as YYYY-MM-DD in LOCAL time. toISOString() would return yesterday
 *  for any IST moment before 05:30, which would quietly misfile payments. */
function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function RecordPaymentDialog({ open, onClose, presetLeadId }: Props) {
  const { leads, payments, recordPayment, updateLead } = useApp();
  const [leadId, setLeadId] = useState<string>('');
  const [milestone, setMilestone] = useState<Milestone>('kickstart');
  const [amount, setAmount] = useState<string>('');
  const [totalFee, setTotalFee] = useState<string>('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<RecordMode>('received');
  const [dueDate, setDueDate] = useState<string>(''); // YYYY-MM-DD format
  // The day the money actually arrived. Defaults to today, but a payment
  // being entered late must be filed under the month it was received, not the
  // month somebody got round to typing it in.
  const [paidDate, setPaidDate] = useState<string>('');
  // THIS PAYMENT's currency — what the money was paid / invoiced in. It never
  // relabels the client's earlier amounts (that was the 8 Oct 2026 bug).
  const [currency, setCurrency] = useState<Currency>('INR');
  // Rate from the payment currency to the client's billing currency, as text
  // so it can be edited; filled from /api/fx (ECB) when the currencies differ.
  const [fxRate, setFxRate] = useState<string>('');
  const [fxSource, setFxSource] = useState<string>('');

  const selectedLead = useMemo(() => leads.find((l) => l.id === leadId) || null, [leads, leadId]);
  const savedCurrency: Currency = (selectedLead?.currency as Currency) || 'INR';
  const hasPayments = useMemo(() => payments.some((p) => p.lead_id === leadId), [payments, leadId]);
  // The client's BILLING currency: total fee, paid and pending are in it. A
  // client with no payments yet simply takes the currency of this first one.
  const billing: Currency = hasPayments ? savedCurrency : currency;
  const converting = currency !== billing;
  const rate = parseFloat(fxRate) || 0;
  const currentTotal = selectedLead?.amount_total || 0;
  const currentPaid = selectedLead?.amount_paid || 0;
  const thisPayment = parseFloat(amount) || 0;
  // What this payment counts for in the billing currency.
  const credit = converting ? Math.round(thisPayment * rate) : thisPayment;
  const totalFeeInput = parseFloat(totalFee) || 0;
  const effectiveTotal = totalFeeInput > 0 ? totalFeeInput : currentTotal;
  const remainingAfter = effectiveTotal > 0 && mode === 'received' ? Math.max(0, effectiveTotal - currentPaid - credit) : null;
  const ifv = isIfvVisa(selectedLead?.visa_type);

  // Compute whether the due date is in the past (would mean immediately overdue)
  const isDueDatePast = dueDate && new Date(dueDate + 'T23:59:59').getTime() < Date.now();

  useEffect(() => {
    if (open) {
      const id = presetLeadId || (leads[0]?.id ?? '');
      setLeadId(id);
      setMilestone('kickstart');
      setAmount('');
      setNote('');
      setMode('received');
      setPaidDate(localToday());
      // Default due date to 7 days from now
      const defaultDue = new Date();
      defaultDue.setDate(defaultDue.getDate() + 7);
      setDueDate(defaultDue.toISOString().split('T')[0]);
      const lead = leads.find((l) => l.id === id);
      setTotalFee(lead?.amount_total ? String(lead.amount_total) : '');
    }
  }, [open, presetLeadId, leads]);

  useEffect(() => {
    if (selectedLead) {
      setTotalFee(selectedLead.amount_total ? String(selectedLead.amount_total) : '');
      setCurrency((selectedLead.currency as Currency) || 'INR');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLead?.id]);

  // A client with no payments yet whose first payment comes in another
  // currency: the total fee (stored in the old one) is offered converted into
  // the new billing currency — shown, never silent, and editable.
  useEffect(() => {
    if (!selectedLead || hasPayments) return;
    const stored = selectedLead.amount_total || 0;
    if (!stored) return;
    setTotalFee(String(currency === savedCurrency ? stored : Math.round(stored * fxStanding(savedCurrency, currency))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currency]);

  // Today's rate whenever this payment's currency differs from the billing one.
  useEffect(() => {
    if (!converting) { setFxRate(''); setFxSource(''); return; }
    let alive = true;
    setFxRate(String(Math.round(fxStanding(currency, billing) * 10000) / 10000));
    setFxSource('standing rate');
    fetch(`/api/fx?from=${currency}&to=${billing}`)
      .then((r) => r.json())
      .then((j: { ok?: boolean; rate?: number; source?: string; date?: string | null }) => {
        if (!alive || !j?.ok || !j.rate) return;
        setFxRate(String(Math.round(j.rate * 10000) / 10000));
        setFxSource(j.source === 'ecb' ? `ECB rate${j.date ? ` · ${new Date(j.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : ''}` : 'standing rate');
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [converting, currency, billing]);

  const submit = async () => {
    const n = parseFloat(amount);
    if (!leadId || !n || n <= 0) return;
    if (mode === 'scheduled' && !dueDate) return;
    setBusy(true);
    if (converting && !(rate > 0)) { setBusy(false); return; }
    const leadPatch: Partial<Lead> = {};
    if (totalFeeInput > 0 && totalFeeInput !== currentTotal) leadPatch.amount_total = totalFeeInput;
    // Only a client with NO payments yet takes this payment's currency as its
    // billing currency — there is nothing earlier to relabel. A client who has
    // paid before keeps its billing currency; this payment is converted.
    if (!hasPayments && billing !== savedCurrency) leadPatch.currency = billing;
    if (Object.keys(leadPatch).length > 0) {
      const ok = await updateLead(leadId, leadPatch);
      if (ok === false) { setBusy(false); return; }
    }
    // Determine status: if scheduled and due_date is in the past → overdue; otherwise pending
    const status: Payment['status'] = mode === 'received'
      ? 'paid'
      : (isDueDatePast ? 'overdue' : 'pending');
    await recordPayment({
      lead_id: leadId,
      milestone,
      amount: Math.round(n),
      currency,
      status,
      due_date: mode === 'scheduled' ? dueDate : null,
      paid_at: mode === 'received' && paidDate ? new Date(`${paidDate}T12:00:00`).toISOString() : undefined,
      note: note.trim() || null,
      ...(converting ? { credit_amount: credit, credit_currency: billing, fx_rate: rate } : {}),
    });
    setBusy(false);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Record payment"
      subtitle={mode === 'received' ? 'Log a payment that came in' : 'Schedule an upcoming installment'}
      footer={<>
        <button onClick={onClose} className="btn btn-ghost">Cancel</button>
        <button onClick={submit} disabled={busy || !leadId || !amount || parseFloat(amount) <= 0 || (mode === 'scheduled' && !dueDate) || (converting && !(rate > 0))} className="btn btn-primary disabled:opacity-50">
          {busy ? 'Saving…' : mode === 'received' ? 'Record payment' : 'Schedule payment'}
        </button>
      </>}
    >
      <div className="space-y-4">
        <div>
          <label className="input-label">Client *</label>
          <Select<string>
            value={leadId}
            onChange={setLeadId}
            options={leads.length === 0
              ? [{ value: '', label: 'No clients yet' }]
              : leads.map((l) => ({ value: l.id, label: l.full_name, hint: l.phone || l.email || undefined }))}
            placeholder="Select a client"
          />
        </div>

        {selectedLead && (
          <div className="rounded-md p-3 grid grid-cols-3 gap-2 text-center" style={{ background: '#F7F8FA', border: '0.5px solid #E5E7EB' }}>
            <div>
              <div className="text-[10px] text-faint uppercase tracking-wider font-semibold">Total fee</div>
              <div className="text-[14px] font-semibold mt-0.5 num">{currentTotal > 0 ? formatMoney(currentTotal, savedCurrency) : <span className="text-faint">Not set</span>}</div>
            </div>
            <div>
              <div className="text-[10px] text-faint uppercase tracking-wider font-semibold">Already paid</div>
              <div className="text-[14px] font-semibold mt-0.5 num" style={{ color: '#0F6E56' }}>{formatMoney(currentPaid, savedCurrency)}</div>
            </div>
            <div>
              <div className="text-[10px] text-faint uppercase tracking-wider font-semibold">Pending</div>
              <div className="text-[14px] font-semibold mt-0.5 num" style={{ color: currentTotal > 0 ? '#A32D2D' : '#9CA3AF' }}>
                {currentTotal > 0 ? formatMoney(Math.max(0, currentTotal - currentPaid), savedCurrency) : '—'}
              </div>
            </div>
          </div>
        )}

        {/* Mode toggle: Received vs Scheduled */}
        <div>
          <label className="input-label">Type *</label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setMode('received')}
              className={cn('flex items-center gap-2 px-3 py-2.5 rounded-md text-[13px] font-medium border transition text-left', mode === 'received' ? 'border-transparent' : 'border-border hover:bg-surface-2 text-muted')}
              style={mode === 'received' ? { background: '#E1F5EE', color: '#0F6E56' } : undefined}
            >
              <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
              <div>
                <div>Received now</div>
                <div className={cn('text-[10.5px]', mode === 'received' ? 'opacity-80' : 'text-faint')}>Money already in</div>
              </div>
            </button>
            <button
              type="button"
              onClick={() => setMode('scheduled')}
              className={cn('flex items-center gap-2 px-3 py-2.5 rounded-md text-[13px] font-medium border transition text-left', mode === 'scheduled' ? 'border-transparent' : 'border-border hover:bg-surface-2 text-muted')}
              style={mode === 'scheduled' ? { background: '#FAEEDA', color: '#854F0B' } : undefined}
            >
              <CalendarClock className="w-4 h-4 flex-shrink-0" />
              <div>
                <div>Schedule for later</div>
                <div className={cn('text-[10.5px]', mode === 'scheduled' ? 'opacity-80' : 'text-faint')}>Expected by a date</div>
              </div>
            </button>
          </div>
        </div>

        <div>
          <label className="input-label">Currency *</label>
          <div className="grid grid-cols-3 gap-2">
            {(['INR', 'GBP', 'USD'] as Currency[]).map((c) => (
              <button key={c} type="button" onClick={() => setCurrency(c)}
                className={cn('flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-[13px] font-semibold border transition', currency === c ? 'border-transparent' : 'border-border hover:bg-surface-2 text-muted')}
                style={currency === c ? { background: '#EEF0FF', color: '#3C3489' } : undefined}>
                <span className="text-[15px]">{moneySymbol(c)}</span> {c}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-muted mt-1.5">
            The currency this payment was made in — its invoice and receipt are issued in it.{' '}
            {hasPayments
              ? <>The client is billed in <b className="text-ink-2">{billing}</b>; earlier payments are never changed.</>
              : <>This client has no payments yet, so <b className="text-ink-2">{billing}</b> becomes their billing currency.</>}
          </p>
          {converting && (
            <div className="mt-2 rounded-md p-3" style={{ background: '#EEF0FF', border: '0.5px solid #A6B0F7' }}>
              <div className="flex items-center gap-1.5 text-[12px] font-semibold" style={{ color: '#3C3489' }}>
                <ArrowRightLeft className="w-3.5 h-3.5" /> Converted to the client&rsquo;s {billing} total
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[12.5px]" style={{ color: '#26215C' }}>
                <span>1 {currency} =</span>
                <input type="number" min="0" step="0.0001" value={fxRate} onChange={(e) => setFxRate(e.target.value)}
                  className="input !h-8 !w-[110px] !py-1 text-[12.5px]" aria-label="Exchange rate" />
                <span>{billing}</span>
                <span className="text-[11px] text-muted">· {fxSource || 'rate'} — edit if you used a different rate</span>
              </div>
              {thisPayment > 0 && rate > 0 && (
                <div className="mt-2 text-[12.5px]" style={{ color: '#26215C' }}>
                  {formatMoney(Math.round(thisPayment), currency)} counts as <b>{formatMoney(credit, billing)}</b> toward this client&rsquo;s total.
                </div>
              )}
              {!(rate > 0) && <div className="mt-2 text-[11.5px]" style={{ color: '#A32D2D' }}>Enter the exchange rate to continue.</div>}
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="input-label">Milestone *</label>
            <Select<Milestone>
              value={milestone}
              onChange={setMilestone}
              options={(Object.keys(MILESTONE_META) as Milestone[]).map((m) => ({
                value: m,
                label: ifv
                  ? `${IFV_MILESTONE_META[m].label} (£${IFV_MILESTONE_META[m].gbp.toLocaleString('en-GB')})`
                  : `${MILESTONE_META[m].label} (${MILESTONE_META[m].pct}%)`,
              }))}
            />
          </div>
          <div>
            <label className="input-label">{mode === 'received' ? `Amount received (${moneySymbol(currency)}) *` : `Amount expected (${moneySymbol(currency)}) *`}</label>
            <input type="number" min="0" className="input" placeholder="0" value={amount} onChange={(e) => setAmount(e.target.value)} />
            {amount && Number(amount) > 0 && <div className="text-[11px] text-muted mt-1">{formatMoney(Math.round(Number(amount)), currency)}</div>}
          </div>
        </div>

        {/* Date received — only in received mode. Without this every payment
            lands on today's date, which is how historical payments all end up
            stacked under the month the CRM was populated. */}
        {mode === 'received' && (
          <div>
            <label className="input-label">Date received <span className="text-faint">· change it if the money came in earlier</span></label>
            <input
              type="date"
              className="input"
              max={localToday()}
              value={paidDate}
              onChange={(e) => setPaidDate(e.target.value)}
            />
            {paidDate && paidDate !== localToday() && (
              <div className="text-[11.5px] mt-1.5 text-muted">
                This payment will be counted in{' '}
                <b className="text-ink-2">{new Date(`${paidDate}T12:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}</b>.
              </div>
            )}
          </div>
        )}

        {/* Due date — only shown in scheduled mode */}
        {mode === 'scheduled' && (
          <div>
            <label className="input-label">Due date *</label>
            <input
              type="date"
              className="input"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
            {dueDate && isDueDatePast && (
              <div className="text-[11.5px] mt-1.5 flex items-center gap-1" style={{ color: '#A32D2D' }}>
                <AlertTriangle className="w-3 h-3" />
                This date is in the past, so this payment will be marked Overdue immediately
              </div>
            )}
            {dueDate && !isDueDatePast && (
              <div className="text-[11.5px] mt-1.5 text-muted">
                If payment isn&apos;t received by {new Date(dueDate + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}, this row will automatically appear as Overdue across the system.
              </div>
            )}
          </div>
        )}

        <div>
          <label className="input-label">Total fee for this client ({moneySymbol(billing)}) <span className="text-faint">{currentTotal > 0 ? '· update if it has changed' : '· set the full expected fee'}</span></label>
          <input type="number" min="0" className="input" placeholder="0" value={totalFee} onChange={(e) => setTotalFee(e.target.value)} />
          <div className="text-[11px] text-faint mt-1">
            {totalFeeInput > 0 && currentTotal === 0 && <>You&apos;re setting the total fee. Pending will be auto-tracked from here.</>}
            {totalFeeInput > 0 && currentTotal > 0 && totalFeeInput !== currentTotal && <>This will replace the current total ({formatMoney(currentTotal, savedCurrency)}).</>}
            {totalFeeInput === 0 && currentTotal === 0 && <>Without a total fee, pending stays uncalculated for this client.</>}
            {totalFeeInput > 0 && totalFeeInput === currentTotal && <>Total fee unchanged.</>}
            {!hasPayments && billing !== savedCurrency && currentTotal > 0 && (
              <span className="block mt-0.5" style={{ color: '#92400E' }}>
                Was {formatMoney(currentTotal, savedCurrency)} — converted to {billing} at the standing rate. Check it before saving.
              </span>
            )}
          </div>
        </div>

        {selectedLead && thisPayment > 0 && mode === 'received' && effectiveTotal > 0 && (
          <div className="rounded-md p-3 flex items-center gap-3" style={{ background: remainingAfter === 0 ? '#E1F5EE' : '#EEF0FF', border: `0.5px solid ${remainingAfter === 0 ? '#5DBFA1' : '#A6B0F7'}` }}>
            {remainingAfter === 0 ? <CheckCircle2 className="w-4 h-4" style={{ color: '#0F6E56' }} /> : <Wallet className="w-4 h-4" style={{ color: '#3C3489' }} />}
            <div className="text-[12.5px]" style={{ color: remainingAfter === 0 ? '#0F6E56' : '#26215C' }}>
              {remainingAfter === 0
                ? <>After this payment, <strong>{selectedLead.full_name}</strong> is fully paid up.</>
                : <>After this payment, <strong>{formatMoney(remainingAfter || 0, billing)}</strong> will still be pending.</>}
            </div>
          </div>
        )}

        <div>
          <label className="input-label">Note <span className="text-faint">(visible on this payment row)</span></label>
          <textarea className="input" rows={2} placeholder="Reference, mode of payment, etc." value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </div>
    </Modal>
  );
}
