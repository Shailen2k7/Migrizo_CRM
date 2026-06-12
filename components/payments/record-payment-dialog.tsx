'use client';

import { useState, useEffect, useMemo } from 'react';
import { Modal } from '@/components/shared/modal';
import { useApp } from '@/components/shared/app-provider';
import { MILESTONE_META } from '@/lib/types';
import type { Milestone, Payment, Currency, Lead } from '@/lib/types';
import { formatMoney, moneySymbol, cn } from '@/lib/utils';
import { Select } from '@/components/shared/select';
import { Wallet, CheckCircle2, CalendarClock, AlertTriangle } from 'lucide-react';

interface Props { open: boolean; onClose: () => void; presetLeadId?: string | null; }

type RecordMode = 'received' | 'scheduled';

export function RecordPaymentDialog({ open, onClose, presetLeadId }: Props) {
  const { leads, recordPayment, updateLead } = useApp();
  const [leadId, setLeadId] = useState<string>('');
  const [milestone, setMilestone] = useState<Milestone>('kickstart');
  const [amount, setAmount] = useState<string>('');
  const [totalFee, setTotalFee] = useState<string>('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<RecordMode>('received');
  const [dueDate, setDueDate] = useState<string>(''); // YYYY-MM-DD format
  const [currency, setCurrency] = useState<Currency>('INR');

  const selectedLead = useMemo(() => leads.find((l) => l.id === leadId) || null, [leads, leadId]);
  const currentTotal = selectedLead?.amount_total || 0;
  const currentPaid = selectedLead?.amount_paid || 0;
  const thisPayment = parseFloat(amount) || 0;
  const totalFeeInput = parseFloat(totalFee) || 0;
  const effectiveTotal = totalFeeInput > 0 ? totalFeeInput : currentTotal;
  const remainingAfter = effectiveTotal > 0 && mode === 'received' ? Math.max(0, effectiveTotal - currentPaid - thisPayment) : null;

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

  const submit = async () => {
    const n = parseFloat(amount);
    if (!leadId || !n || n <= 0) return;
    if (mode === 'scheduled' && !dueDate) return;
    setBusy(true);
    const leadPatch: Partial<Lead> = {};
    if (totalFeeInput > 0 && totalFeeInput !== currentTotal) leadPatch.amount_total = totalFeeInput;
    if (currency !== (selectedLead?.currency || 'INR')) leadPatch.currency = currency;
    if (Object.keys(leadPatch).length > 0) await updateLead(leadId, leadPatch);
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
      note: note.trim() || null,
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
        <button onClick={submit} disabled={busy || !leadId || !amount || parseFloat(amount) <= 0 || (mode === 'scheduled' && !dueDate)} className="btn btn-primary disabled:opacity-50">
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
              <div className="text-[14px] font-semibold mt-0.5 num">{currentTotal > 0 ? formatMoney(currentTotal, currency) : <span className="text-faint">Not set</span>}</div>
            </div>
            <div>
              <div className="text-[10px] text-faint uppercase tracking-wider font-semibold">Already paid</div>
              <div className="text-[14px] font-semibold mt-0.5 num" style={{ color: '#0F6E56' }}>{formatMoney(currentPaid, currency)}</div>
            </div>
            <div>
              <div className="text-[10px] text-faint uppercase tracking-wider font-semibold">Pending</div>
              <div className="text-[14px] font-semibold mt-0.5 num" style={{ color: effectiveTotal > 0 ? '#A32D2D' : '#9CA3AF' }}>
                {effectiveTotal > 0 ? formatMoney(Math.max(0, effectiveTotal - currentPaid), currency) : '—'}
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
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="input-label">Milestone *</label>
            <Select<Milestone>
              value={milestone}
              onChange={setMilestone}
              options={(Object.keys(MILESTONE_META) as Milestone[]).map((m) => ({ value: m, label: `${MILESTONE_META[m].label} (${MILESTONE_META[m].pct}%)` }))}
            />
          </div>
          <div>
            <label className="input-label">{mode === 'received' ? `Amount received (${moneySymbol(currency)}) *` : `Amount expected (${moneySymbol(currency)}) *`}</label>
            <input type="number" min="0" className="input" placeholder="0" value={amount} onChange={(e) => setAmount(e.target.value)} />
            {amount && Number(amount) > 0 && <div className="text-[11px] text-muted mt-1">{formatMoney(Math.round(Number(amount)), currency)}</div>}
          </div>
        </div>

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
          <label className="input-label">Total fee for this client ({moneySymbol(currency)}) <span className="text-faint">{currentTotal > 0 ? '· update if it has changed' : '· set the full expected fee'}</span></label>
          <input type="number" min="0" className="input" placeholder="0" value={totalFee} onChange={(e) => setTotalFee(e.target.value)} />
          <div className="text-[11px] text-faint mt-1">
            {totalFeeInput > 0 && currentTotal === 0 && <>You&apos;re setting the total fee. Pending will be auto-tracked from here.</>}
            {totalFeeInput > 0 && currentTotal > 0 && totalFeeInput !== currentTotal && <>This will replace the current total ({formatMoney(currentTotal, currency)}).</>}
            {totalFeeInput === 0 && currentTotal === 0 && <>Without a total fee, pending stays uncalculated for this client.</>}
            {totalFeeInput > 0 && totalFeeInput === currentTotal && <>Total fee unchanged.</>}
          </div>
        </div>

        {selectedLead && thisPayment > 0 && mode === 'received' && effectiveTotal > 0 && (
          <div className="rounded-md p-3 flex items-center gap-3" style={{ background: remainingAfter === 0 ? '#E1F5EE' : '#EEF0FF', border: `0.5px solid ${remainingAfter === 0 ? '#5DBFA1' : '#A6B0F7'}` }}>
            {remainingAfter === 0 ? <CheckCircle2 className="w-4 h-4" style={{ color: '#0F6E56' }} /> : <Wallet className="w-4 h-4" style={{ color: '#3C3489' }} />}
            <div className="text-[12.5px]" style={{ color: remainingAfter === 0 ? '#0F6E56' : '#26215C' }}>
              {remainingAfter === 0
                ? <>After this payment, <strong>{selectedLead.full_name}</strong> is fully paid up.</>
                : <>After this payment, <strong>{formatMoney(remainingAfter || 0, currency)}</strong> will still be pending.</>}
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
