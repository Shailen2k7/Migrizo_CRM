'use client';

import { useState, useEffect } from 'react';
import { Modal } from '@/components/shared/modal';
import { useApp } from '@/components/shared/app-provider';
import { MILESTONE_META } from '@/lib/types';
import type { Milestone } from '@/lib/types';
import { formatINRFull } from '@/lib/utils';
import { Select } from '@/components/shared/select';

interface Props { open: boolean; onClose: () => void; presetLeadId?: string | null; }

export function RecordPaymentDialog({ open, onClose, presetLeadId }: Props) {
  const { leads, recordPayment } = useApp();
  const [leadId, setLeadId] = useState<string>('');
  const [milestone, setMilestone] = useState<Milestone>('kickstart');
  const [amount, setAmount] = useState<string>('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (open) { setLeadId(presetLeadId || (leads[0]?.id ?? '')); setMilestone('kickstart'); setAmount(''); setNote(''); } }, [open, presetLeadId, leads]);

  const submit = async () => {
    const n = parseFloat(amount);
    if (!leadId || !n || n <= 0) return;
    setBusy(true);
    await recordPayment({ lead_id: leadId, milestone, amount: Math.round(n), status: 'paid', note: note.trim() || null });
    setBusy(false);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Record payment"
      subtitle="Log a milestone payment"
      footer={<>
        <button onClick={onClose} className="btn btn-ghost">Cancel</button>
        <button onClick={submit} disabled={busy || !leadId || !amount} className="btn btn-primary disabled:opacity-50">{busy ? 'Recording…' : 'Record payment'}</button>
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
            <label className="input-label">Amount (₹) *</label>
            <input type="number" min="0" className="input" placeholder="0" value={amount} onChange={(e) => setAmount(e.target.value)} />
            {amount && Number(amount) > 0 && <div className="text-[11px] text-muted mt-1">{formatINRFull(Math.round(Number(amount)))}</div>}
          </div>
        </div>
        <div>
          <label className="input-label">Note <span className="text-faint">(visible on this payment row)</span></label>
          <textarea className="input" rows={2} placeholder="Reference, mode of payment, etc." value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </div>
    </Modal>
  );
}
