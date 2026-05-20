'use client';

import { useState, useEffect } from 'react';
import { Modal } from '@/components/shared/modal';
import { Select } from '@/components/shared/select';
import { useApp } from '@/components/shared/app-provider';
import type { FollowUp, FollowUpChannel, Lead } from '@/lib/types';
import { initials, avatarColor } from '@/lib/utils';
import { Search } from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
  presetLeadId?: string | null;     // When opening from a lead drawer
  editing?: FollowUp;               // When editing an existing follow-up
  onCreated?: (followUp: FollowUp) => void;
}

// Helper: convert local datetime input string to ISO
function localToISO(local: string): string {
  // local is "YYYY-MM-DDTHH:MM" — interpreted as local time
  if (!local) return new Date().toISOString();
  return new Date(local).toISOString();
}

// Helper: convert ISO to local datetime input format
function isoToLocal(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Default scheduled-at: tomorrow at 10am
function defaultScheduledAt(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(10, 0, 0, 0);
  return isoToLocal(d.toISOString());
}

export function AddFollowUpDialog({ open, onClose, presetLeadId, editing, onCreated }: Props) {
  const { leads, createFollowUp, updateFollowUp } = useApp();

  const [leadId, setLeadId] = useState<string>('');
  const [leadSearch, setLeadSearch] = useState('');
  const [title, setTitle] = useState('');
  const [scheduledAt, setScheduledAt] = useState(defaultScheduledAt());
  const [channel, setChannel] = useState<FollowUpChannel>('call');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setLeadId(editing.lead_id);
      setLeadSearch('');
      setTitle(editing.title);
      setScheduledAt(isoToLocal(editing.scheduled_at));
      setChannel(editing.channel);
      setNotes(editing.notes || '');
    } else {
      setLeadId(presetLeadId || '');
      setLeadSearch('');
      setTitle('');
      setScheduledAt(defaultScheduledAt());
      setChannel('call');
      setNotes('');
    }
  }, [open, editing, presetLeadId]);

  const handleClose = () => { setLeadSearch(''); onClose(); };

  const submit = async () => {
    if (!leadId || !title.trim() || !scheduledAt) return;
    setBusy(true);
    try {
      if (editing) {
        await updateFollowUp(editing.id, {
          title: title.trim(),
          scheduled_at: localToISO(scheduledAt),
          channel,
          notes: notes.trim() || null,
        });
      } else {
        const created = await createFollowUp({
          lead_id: leadId,
          title: title.trim(),
          scheduled_at: localToISO(scheduledAt),
          channel,
          notes: notes.trim() || null,
        });
        if (created && onCreated) onCreated(created);
      }
      handleClose();
    } finally {
      setBusy(false);
    }
  };

  const filteredLeads = leadSearch.trim()
    ? leads.filter((l) => {
        const q = leadSearch.toLowerCase();
        return l.full_name.toLowerCase().includes(q) || (l.email || '').toLowerCase().includes(q) || (l.phone || '').toLowerCase().includes(q);
      }).slice(0, 6)
    : leads.slice(0, 6);

  const pickedLead = leads.find((l) => l.id === leadId);
  const canSubmit = !!leadId && title.trim().length >= 2 && !!scheduledAt;
  const titleEditingMode = editing ? 'Edit follow-up' : 'New follow-up';
  const subtitleEditing = editing ? 'Update the schedule, channel, or notes' : 'Schedule when and how you\'ll follow up';

  return (
    <Modal open={open} onClose={handleClose} size="md"
      title={titleEditingMode}
      subtitle={subtitleEditing}
      footer={<>
        <button onClick={handleClose} className="btn btn-ghost">Cancel</button>
        <button onClick={submit} disabled={!canSubmit || busy} className="btn btn-primary disabled:opacity-50">
          {busy ? 'Saving…' : editing ? 'Save changes' : 'Schedule'}
        </button>
      </>}
    >
      <div className="space-y-4">
        {/* Lead picker — hidden when editing or preset */}
        {!editing && !presetLeadId && (
          <div>
            <label className="input-label">Lead *</label>
            {pickedLead ? (
              <div className="flex items-center gap-2 p-2 rounded-md border border-border bg-surface">
                <div className="av" style={{ background: avatarColor(pickedLead.id), width: 28, height: 28, fontSize: 11 }}>{initials(pickedLead.full_name)}</div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-semibold truncate">{pickedLead.full_name}</div>
                  <div className="text-[11px] text-muted truncate">{pickedLead.email || pickedLead.phone || '—'}</div>
                </div>
                <button onClick={() => { setLeadId(''); setLeadSearch(''); }} className="text-[11px] text-muted hover:text-ink px-2 py-1 rounded hover:bg-surface-2">Change</button>
              </div>
            ) : (
              <>
                <div className="relative">
                  <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
                  <input value={leadSearch} onChange={(e) => setLeadSearch(e.target.value)} placeholder="Search leads by name, email, phone…" className="input pl-8" autoFocus />
                </div>
                <div className="border border-border rounded-md mt-1 max-h-[200px] overflow-y-auto">
                  {filteredLeads.length === 0 ? (
                    <div className="py-6 text-center text-[12px] text-muted">No matching leads</div>
                  ) : filteredLeads.map((l) => (
                    <button key={l.id} onClick={() => setLeadId(l.id)} className="w-full flex items-center gap-2 px-3 py-2 border-b border-border last:border-0 text-left hover:bg-surface-2">
                      <div className="av" style={{ background: avatarColor(l.id), width: 26, height: 26, fontSize: 10 }}>{initials(l.full_name)}</div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[12.5px] font-semibold truncate">{l.full_name}</div>
                        <div className="text-[10.5px] text-muted truncate">{l.email || l.phone || '—'}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* Show selected lead when editing or preset */}
        {(editing || presetLeadId) && pickedLead && (
          <div className="flex items-center gap-2 p-2 rounded-md bg-surface-2">
            <div className="av" style={{ background: avatarColor(pickedLead.id), width: 26, height: 26, fontSize: 10 }}>{initials(pickedLead.full_name)}</div>
            <span className="text-[12.5px] font-semibold">{pickedLead.full_name}</span>
            <span className="text-[11px] text-muted">· {pickedLead.email || pickedLead.phone || '—'}</span>
          </div>
        )}

        <div>
          <label className="input-label">Title *</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Call to discuss visa timeline" className="input" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="input-label">Channel *</label>
            <Select<FollowUpChannel>
              value={channel}
              onChange={setChannel}
              options={[
                { value: 'call',     label: 'Call'     },
                { value: 'email',    label: 'Email'    },
                { value: 'whatsapp', label: 'WhatsApp' },
                { value: 'meeting',  label: 'Meeting'  },
                { value: 'other',    label: 'Other'    },
              ]}
            />
          </div>
          <div>
            <label className="input-label">When *</label>
            <input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} className="input" />
          </div>
        </div>

        <div>
          <label className="input-label">Notes <span className="text-faint">(optional)</span></label>
          <textarea className="input" rows={3} placeholder="What to discuss, agenda, context…" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>
    </Modal>
  );
}
