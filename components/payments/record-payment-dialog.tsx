'use client';

import { useState, useEffect, useMemo } from 'react';
import { Modal } from '@/components/shared/modal';
import { useApp } from '@/components/shared/app-provider';
import { MILESTONE_META } from '@/lib/types';
import type { Milestone } from '@/lib/types';
import { formatINRFull } from '@/lib/utils';
import { Select } from '@/components/shared/select';
import { Wallet, CheckCircle2 } from 'lucide-react';

interface Props { open: boolean; onClose: () => void; presetLeadId?: string | null; }

export function RecordPaymentDialog({ open, onClose, presetLeadId }: Props) {
  const { leads, recordPayment, updateLead } = useApp();
  const [leadId, setLeadId] = useState<string>('');
  const [milestone, setMilestone] = useState<Milestone>('kickstart');
  const [amount, setAmount] = useState<string>('');
  const [totalFee, setTotalFee] = useState<string>('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const selectedLead = useMemo(() => leads.find((l) => l.id === leadId) || null, [leads, leadId]);
  const currentTotal = selectedLead?.amount_total || 0;
  const currentPaid = selectedLead?.amount_paid || 0;
  const thisPayment = parseFloat(amount) || 0;
  const totalFeeInput = parseFloat(totalFee) || 0;
  const effectiveTotal = totalFeeInput > 0 ? totalFeeInput : currentTotal;
  const remainingAfter = effectiveTotal > 0 ? Math.max(0, effectiveTotal - currentPaid - thisPayment) : null;

  useEffect(() => {
    if (open) {
      const id = presetLeadId || (leads[0]?.id ?? '');
      setLeadId(id);
      setMilestone('kickstart');
      setAmount('');
      setNote('');
      const lead = leads.find((l) => l.id === id);
      setTotalFee(lead?.amount_total ? String(lead.amount_total) : '');
    }
  }, [open, presetLeadId, leads]);

  useEffect(() => {
    if (selectedLead) setTotalFee(selectedLead.amount_total ? String(selectedLead.amount_total) : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLead?.id]);

  const submit = async () => {
    const n = parseFloat(amount);
    if (!leadId || !n || n <= 0) return;
    setBusy(true);
    if (totalFeeInput > 0 && totalFeeInput !== currentTotal) {
      await updateLead(leadId, { amount_total: totalFeeInput });
    }
    await recordPayment({ lead_id: leadId, milestone, amount: Math.round(n), status: 'paid', note: note.trim() || null });
    setBusy(false);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Record payment"
      subtitle="Log a milestone payment for this client"
      footer={<>
        <button onClick={onClose} className="btn btn-ghost">Cancel</button>
        <button onClick={submit} disabled={busy || !leadId || !amount || parseFloat(amount) <= 0} className="btn btn-primary disabled:opacity-50">
          {busy ? 'Recording…' : 'Record payment'}
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
              <div className="text-[14px] font-semibold mt-0.5 num">{currentTotal > 0 ? formatINRFull(currentTotal) : <span className="text-faint">Not set</span>}</div>
            </div>
            <div>
              <div className="text-[10px] text-faint uppercase tracking-wider font-semibold">Already paid</div>
              <div className="text-[14px] font-semibold mt-0.5 num" style={{ color: '#0F6E56' }}>{formatINRFull(currentPaid)}</div>
            </div>
            <div>
              <div className="text-[10px] text-faint uppercase tracking-wider font-semibold">Pending</div>
              <div className="text-[14px] font-semibold mt-0.5 num" style={{ color: effectiveTotal > 0 ? '#A32D2D' : '#9CA3AF' }}>
                {effectiveTotal > 0 ? formatINRFull(Math.max(0, effectiveTotal - currentPaid)) : '—'}
              </div>
            </div>
          </div>
        )}

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
            <label className="input-label">Amount received (₹) *</label>
            <input type="number" min="0" className="input" placeholder="0" value={amount} onChange={(e) => setAmount(e.target.value)} />
            {amount && Number(amount) > 0 && <div className="text-[11px] text-muted mt-1">{formatINRFull(Math.round(Number(amount)))}</div>}
          </div>
        </div>

        <div>
          <label className="input-label">Total fee for this client (₹) <span className="text-faint">{currentTotal > 0 ? '· update if it has changed' : '· set the full expected fee'}</span></label>
          <input type="number" min="0" className="input" placeholder="0" value={totalFee} onChange={(e) => setTotalFee(e.target.value)} />
          <div className="text-[11px] text-faint mt-1">
            {totalFeeInput > 0 && currentTotal === 0 && <>You&apos;re setting the total fee. Pending will be auto-tracked from here.</>}
            {totalFeeInput > 0 && currentTotal > 0 && totalFeeInput !== currentTotal && <>This will replace the current total ({formatINRFull(currentTotal)}).</>}
            {totalFeeInput === 0 && currentTotal === 0 && <>Without a total fee, pending stays uncalculated for this client.</>}
            {totalFeeInput > 0 && totalFeeInput === currentTotal && <>Total fee unchanged.</>}
          </div>
        </div>

        {selectedLead && thisPayment > 0 && effectiveTotal > 0 && (
          <div className="rounded-md p-3 flex items-center gap-3" style={{ background: remainingAfter === 0 ? '#E1F5EE' : '#EEF0FF', border: `0.5px solid ${remainingAfter === 0 ? '#5DBFA1' : '#A6B0F7'}` }}>
            {remainingAfter === 0 ? <CheckCircle2 className="w-4 h-4" style={{ color: '#0F6E56' }} /> : <Wallet className="w-4 h-4" style={{ color: '#3C3489' }} />}
            <div className="text-[12.5px]" style={{ color: remainingAfter === 0 ? '#0F6E56' : '#26215C' }}>
              {remainingAfter === 0
                ? <>After this payment, <strong>{selectedLead.full_name}</strong> is fully paid up.</>
                : <>After this payment, <strong>{formatINRFull(remainingAfter || 0)}</strong> will still be pending.</>}
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
