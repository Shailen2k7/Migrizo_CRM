'use client';

import { useState } from 'react';
import { Modal } from '@/components/shared/modal';
import { useApp } from '@/components/shared/app-provider';
import type { Lead } from '@/lib/types';
import { initials, avatarColor } from '@/lib/utils';
import { Search, User } from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
  leads: Lead[];
  onCreated: (caseId: string) => void;
}

export function AddCaseDialog({ open, onClose, leads, onCreated }: Props) {
  const { createCase } = useApp();
  const [mode, setMode] = useState<'lead' | 'fresh'>('lead');
  const [search, setSearch] = useState('');
  const [pickedLead, setPickedLead] = useState<Lead | null>(null);
  const [name, setName] = useState('');
  const [visaType, setVisaType] = useState('Global Talent Visa');
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setMode('lead'); setSearch(''); setPickedLead(null);
    setName(''); setVisaType('Global Talent Visa'); setBusy(false);
  };

  const handleClose = () => { reset(); onClose(); };

  const submit = async () => {
    setBusy(true);
    const clientName = mode === 'lead' ? (pickedLead?.full_name || '') : name.trim();
    if (!clientName) { setBusy(false); return; }
    const id = await createCase({
      lead_id: mode === 'lead' ? (pickedLead?.id || null) : null,
      client_name: clientName,
      visa_type: visaType,
    });
    setBusy(false);
    if (id) { reset(); onCreated(id); }
  };

  const filteredLeads = search.trim()
    ? leads.filter((l) => {
        const q = search.toLowerCase();
        return l.full_name.toLowerCase().includes(q) || (l.email || '').toLowerCase().includes(q) || (l.phone || '').toLowerCase().includes(q);
      }).slice(0, 8)
    : leads.filter((l) => l.stage === 'invoice_sent' || l.stage === 'won' || l.stage === 'mr_coming_soon').slice(0, 8);

  const canSubmit = mode === 'lead' ? !!pickedLead : name.trim().length >= 2;

  return (
    <Modal open={open} onClose={handleClose} size="md"
      title="Open a new case"
      subtitle="Start tracking a client through the 6-stage UK visa process"
      footer={<>
        <button onClick={handleClose} className="btn btn-ghost">Cancel</button>
        <button onClick={submit} disabled={!canSubmit || busy} className="btn btn-primary disabled:opacity-50">
          {busy ? 'Opening case…' : 'Open case'}
        </button>
      </>}
    >
      <div className="space-y-4">
        {/* Mode toggle */}
        <div className="inline-flex p-1 rounded-md bg-surface-2 gap-1 w-full">
          <button onClick={() => setMode('lead')} className={`flex-1 px-3 py-1.5 rounded text-[12.5px] font-medium ${mode === 'lead' ? 'bg-surface shadow-sm' : 'text-muted'}`}>
            From existing lead
          </button>
          <button onClick={() => setMode('fresh')} className={`flex-1 px-3 py-1.5 rounded text-[12.5px] font-medium ${mode === 'fresh' ? 'bg-surface shadow-sm' : 'text-muted'}`}>
            Fresh entry
          </button>
        </div>

        {mode === 'lead' ? (
          <>
            <div>
              <label className="input-label">Pick a lead</label>
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
                <input value={search} onChange={(e) => { setSearch(e.target.value); setPickedLead(null); }} placeholder="Search leads by name, email, or phone…"
                  className="input pl-8" />
              </div>
              <p className="text-[11px] text-muted mt-1">
                {search.trim() ? `Matches for "${search}"` : 'Showing leads ready to convert (Invoice Sent / Won / Mr. Coming Soon)'}
              </p>
            </div>

            <div className="border border-border rounded-md max-h-[260px] overflow-y-auto">
              {filteredLeads.length === 0 ? (
                <div className="py-8 text-center text-[12.5px] text-muted">No matching leads</div>
              ) : filteredLeads.map((l) => (
                <button key={l.id} onClick={() => setPickedLead(l)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2.5 border-b border-border last:border-0 text-left transition-colors ${pickedLead?.id === l.id ? 'bg-indigo-soft' : 'hover:bg-surface-2'}`}
                  style={{ background: pickedLead?.id === l.id ? 'hsl(var(--indigo-soft))' : undefined }}
                >
                  <div className="av" style={{ background: avatarColor(l.id), width: 30, height: 30, fontSize: 11 }}>{initials(l.full_name)}</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-semibold text-ink truncate">{l.full_name}</div>
                    <div className="text-[11px] text-muted truncate">{l.email || l.phone || '—'} · {l.visa_type || 'No visa type'}</div>
                  </div>
                </button>
              ))}
            </div>
          </>
        ) : (
          <div>
            <label className="input-label">Client name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Aditya Sharma" className="input" autoFocus />
          </div>
        )}

        <div>
          <label className="input-label">Visa type</label>
          <select className="input" value={visaType} onChange={(e) => setVisaType(e.target.value)}>
            <option>Global Talent Visa</option>
            <option>Innovator Founder Visa</option>
            <option>Skilled Worker Visa</option>
            <option>High Potential Individual Visa</option>
            <option>Scale-up Visa</option>
          </select>
        </div>

        <div className="rounded-md border border-border bg-surface-2 p-3 flex items-start gap-2.5 text-[11.5px] text-muted leading-relaxed">
          <User className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          <div>The case will be created with a complete <strong className="text-ink-2">~50-item checklist</strong> across all 6 stages: Roadmap, Profile Building, Final Mapping, Endorsement, Visa Application, Post-Arrival. You can edit any item later.</div>
        </div>
      </div>
    </Modal>
  );
}
