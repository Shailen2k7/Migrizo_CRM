'use client';

import { useState } from 'react';
import { Modal } from '@/components/shared/modal';
import { useApp } from '@/components/shared/app-provider';
import { STAGE_META } from '@/lib/types';
import type { LeadStage } from '@/lib/types';
import { normalizePhone, normalizeEmail } from '@/lib/utils';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function AddLeadDialog({ open, onClose }: Props) {
  const { createLead } = useApp();
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [visaType, setVisaType] = useState('');
  const [stage, setStage] = useState<LeadStage>('new');
  const [nextFollowUp, setNextFollowUp] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setFullName(''); setPhone(''); setEmail(''); setVisaType(''); setStage('new'); setNextFollowUp(''); setNote('');
  };

  const submit = async () => {
    if (!fullName.trim()) return;
    setBusy(true);
    const created = await createLead({
      full_name: fullName.trim(),
      phone: normalizePhone(phone),
      email: normalizeEmail(email),
      visa_type: visaType.trim() || null,
      stage,
      next_follow_up: nextFollowUp ? new Date(nextFollowUp).toISOString() : null,
      last_note: note.trim() || null,
    });
    setBusy(false);
    if (created) { reset(); onClose(); }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add new lead"
      subtitle="Capture an inquiry in 10 seconds"
      footer={
        <>
          <button onClick={onClose} className="btn btn-ghost">Cancel</button>
          <button onClick={submit} disabled={busy || !fullName.trim()} className="btn btn-primary disabled:opacity-50">
            {busy ? 'Adding…' : 'Add lead'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="input-label">Full name *</label>
          <input className="input" placeholder="e.g. Aditi Sharma" value={fullName} onChange={(e) => setFullName(e.target.value)} autoFocus />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="input-label">Phone</label>
            <input className="input" placeholder="+91 98214 22341" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div>
            <label className="input-label">Email</label>
            <input type="email" className="input" placeholder="aditi@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="input-label">Visa type</label>
            <input className="input" placeholder="UK GTV, Innovator…" value={visaType} onChange={(e) => setVisaType(e.target.value)} />
          </div>
          <div>
            <label className="input-label">Stage</label>
            <select className="input" value={stage} onChange={(e) => setStage(e.target.value as LeadStage)}>
              {(Object.keys(STAGE_META) as LeadStage[]).map((k) => <option key={k} value={k}>{STAGE_META[k].label}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="input-label">Next follow-up</label>
          <input type="datetime-local" className="input" value={nextFollowUp} onChange={(e) => setNextFollowUp(e.target.value)} />
        </div>
        <div>
          <label className="input-label">Initial note</label>
          <textarea className="input" rows={3} placeholder="Where did this lead come from? Any context?" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </div>
    </Modal>
  );
}
