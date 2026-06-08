'use client';

import { useState } from 'react';
import { Modal } from '@/components/shared/modal';
import { useApp } from '@/components/shared/app-provider';
import { STAGE_META, VISA_META } from '@/lib/types';
import type { LeadStage, Industry } from '@/lib/types';
import { normalizePhone, normalizeEmail } from '@/lib/utils';
import { IndustrySelector } from '@/components/shared/industry-chip';

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
  const [industry, setIndustry] = useState<Industry | null>(null);
  const [stage, setStage] = useState<LeadStage>('cold');
  const [nextFollowUp, setNextFollowUp] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setFullName(''); setPhone(''); setEmail(''); setVisaType(''); setIndustry(null); setStage('cold'); setNextFollowUp(''); setNote('');
  };

  const submit = async () => {
    if (!fullName.trim()) return;
    setBusy(true);
    const created = await createLead({
      full_name: fullName.trim(),
      phone: normalizePhone(phone),
      email: normalizeEmail(email),
      visa_type: visaType.trim() || null,
      industry: industry || null,
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
            <div className="grid grid-cols-2 gap-2">
              {(['gtv', 'ifv'] as const).map((k) => {
                const m = VISA_META[k];
                const on = visaType === k;
                return (
                  <button key={k} type="button" onClick={() => setVisaType(on ? '' : k)}
                    className="flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition-all"
                    style={on ? { borderColor: m.dot, background: m.bg } : { borderColor: 'hsl(var(--border))', background: 'hsl(var(--surface))' }}>
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: m.dot }} />
                    <span className="min-w-0">
                      <span className="block text-[12px] font-bold leading-none" style={{ color: on ? m.fg : 'hsl(var(--ink))' }}>{m.short}</span>
                      <span className="block text-[9.5px] text-muted leading-tight mt-0.5 truncate">{m.full}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <label className="input-label">Stage</label>
            <select className="input" value={stage} onChange={(e) => setStage(e.target.value as LeadStage)}>
              {(Object.keys(STAGE_META) as LeadStage[]).map((k) => <option key={k} value={k}>{STAGE_META[k].label}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="input-label">Industry <span className="text-faint">· optional, click to tag</span></label>
          <IndustrySelector value={industry} onChange={setIndustry} />
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
