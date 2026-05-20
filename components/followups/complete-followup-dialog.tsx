'use client';

import { useState, useEffect } from 'react';
import { Modal } from '@/components/shared/modal';
import { useApp } from '@/components/shared/app-provider';
import type { FollowUp } from '@/lib/types';
import { CheckCircle2 } from 'lucide-react';
import { AddFollowUpDialog } from './add-followup-dialog';

interface Props {
  followUp: FollowUp | null;
  onClose: () => void;
}

export function CompleteFollowUpDialog({ followUp, onClose }: Props) {
  const { completeFollowUp } = useApp();
  const [outcome, setOutcome] = useState('');
  const [scheduleNext, setScheduleNext] = useState(false);
  const [busy, setBusy] = useState(false);
  const [scheduleNextOpen, setScheduleNextOpen] = useState(false);
  const [presetLeadForNext, setPresetLeadForNext] = useState<string | null>(null);

  useEffect(() => {
    if (followUp) { setOutcome(''); setScheduleNext(false); }
  }, [followUp]);

  const submit = async () => {
    if (!followUp) return;
    setBusy(true);
    await completeFollowUp(followUp.id, outcome.trim() || null);
    setBusy(false);

    if (scheduleNext) {
      setPresetLeadForNext(followUp.lead_id);
      setScheduleNextOpen(true);
      // Don't close — let user schedule next first
    } else {
      onClose();
    }
  };

  return (
    <>
      <Modal open={!!followUp} onClose={onClose} size="md"
        title="Mark as complete"
        subtitle={followUp?.title}
        footer={<>
          <button onClick={onClose} className="btn btn-ghost" disabled={busy}>Cancel</button>
          <button onClick={submit} disabled={busy} className="btn btn-primary disabled:opacity-50">
            <CheckCircle2 className="w-3.5 h-3.5" /> {busy ? 'Saving…' : scheduleNext ? 'Complete & schedule next' : 'Complete'}
          </button>
        </>}
      >
        <div className="space-y-4">
          <div>
            <label className="input-label">Outcome / Notes <span className="text-faint">(optional)</span></label>
            <textarea className="input" rows={4} placeholder="What happened? Any next steps?" value={outcome} onChange={(e) => setOutcome(e.target.value)} autoFocus />
          </div>

          <label className="flex items-start gap-2 cursor-pointer p-2.5 rounded-md border border-border hover:bg-surface-2 transition-colors">
            <input type="checkbox" checked={scheduleNext} onChange={(e) => setScheduleNext(e.target.checked)} className="mt-0.5" />
            <div>
              <div className="text-[13px] font-medium text-ink">Schedule next follow-up</div>
              <div className="text-[11.5px] text-muted">Open the schedule dialog after completing this one</div>
            </div>
          </label>
        </div>
      </Modal>

      {/* "Schedule next" dialog opens after completion */}
      <AddFollowUpDialog
        open={scheduleNextOpen}
        onClose={() => { setScheduleNextOpen(false); setPresetLeadForNext(null); onClose(); }}
        presetLeadId={presetLeadForNext}
      />
    </>
  );
}
