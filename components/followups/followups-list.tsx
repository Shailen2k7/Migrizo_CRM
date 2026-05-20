'use client';

import { useState } from 'react';
import type { FollowUp, FollowUpChannel, Lead } from '@/lib/types';
import { FOLLOWUP_CHANNEL_META, FOLLOWUP_STATUS_META, isFollowUpOverdue, formatFollowUpTime } from '@/lib/types';
import { Phone, Mail, MessageCircle, Users as UsersIcon, MoreHorizontal, CheckCircle2, RotateCcw, Pencil, Trash2, CalendarClock, FileText, XCircle } from 'lucide-react';
import { initials, avatarColor, cn } from '@/lib/utils';
import { useApp } from '@/components/shared/app-provider';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { CompleteFollowUpDialog } from './complete-followup-dialog';
import { AddFollowUpDialog } from './add-followup-dialog';

interface Props {
  followUps: FollowUp[];
  showLeadColumn?: boolean;        // Show lead name? (true on main page, false in lead drawer)
  onLeadClick?: (leadId: string) => void; // Click handler for lead chip
  emptyMessage?: string;
  emptyAction?: React.ReactNode;
}

export function FollowUpsList({ followUps, showLeadColumn = true, onLeadClick, emptyMessage = 'No follow-ups', emptyAction }: Props) {
  const { leads, deleteFollowUp, cancelFollowUp, reopenFollowUp } = useApp();
  const [completing, setCompleting] = useState<FollowUp | null>(null);
  const [editing, setEditing] = useState<FollowUp | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<FollowUp | null>(null);
  const [confirmCancel, setConfirmCancel] = useState<FollowUp | null>(null);

  const leadById = (id: string) => leads.find((l) => l.id === id);

  if (followUps.length === 0) {
    return (
      <div className="panel py-12 text-center">
        <div className="w-14 h-14 rounded-full bg-surface-2 mx-auto mb-3 flex items-center justify-center">
          <CalendarClock className="w-6 h-6 text-faint" />
        </div>
        <p className="text-[13px] text-muted mb-4">{emptyMessage}</p>
        {emptyAction}
      </div>
    );
  }

  return (
    <>
      <div className="panel overflow-hidden">
        <div className="divide-y divide-border">
          {followUps.map((f) => {
            const lead = leadById(f.lead_id);
            const isOverdue = isFollowUpOverdue(f);
            const channelMeta = FOLLOWUP_CHANNEL_META[f.channel];
            const statusMeta = FOLLOWUP_STATUS_META[f.status];
            const isCompleted = f.status === 'completed';
            const isCancelled = f.status === 'cancelled';

            return (
              <div key={f.id} className={cn('px-4 py-3 flex items-start gap-3 hover:bg-surface-2 transition-colors group', isCancelled && 'opacity-60')}>
                {/* Lead avatar */}
                {showLeadColumn && lead && (
                  <button onClick={() => onLeadClick?.(f.lead_id)} className="flex-shrink-0">
                    <div className="av" style={{ background: avatarColor(lead.id), width: 36, height: 36, fontSize: 13 }}>
                      {initials(lead.full_name)}
                    </div>
                  </button>
                )}

                {/* Main content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    {showLeadColumn && lead && (
                      <button onClick={() => onLeadClick?.(f.lead_id)} className="font-semibold text-[13.5px] text-ink hover:text-indigo-600 truncate">
                        {lead.full_name}
                      </button>
                    )}
                    <span className={cn('text-[13px]', isCompleted && 'line-through text-muted', !showLeadColumn && 'font-semibold')}>
                      {f.title}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 mt-1 text-[11.5px] flex-wrap">
                    <ChannelChip channel={f.channel} />
                    <span className={cn('inline-flex items-center gap-1 num', isOverdue ? 'text-rose-600 font-semibold' : 'text-muted')}>
                      <CalendarClock className="w-3 h-3" />
                      {formatFollowUpTime(f.scheduled_at)}
                      {isOverdue && <span className="text-rose-600 font-semibold">· Overdue</span>}
                    </span>
                    {f.status !== 'pending' && (
                      <span className="chip" style={{ background: statusMeta.bg, color: statusMeta.fg, border: 'none', fontSize: 10 }}>{statusMeta.label}</span>
                    )}
                  </div>

                  {f.notes && (
                    <div className="text-[11.5px] text-muted mt-1.5 line-clamp-2">
                      <FileText className="w-3 h-3 inline mr-1" />{f.notes}
                    </div>
                  )}

                  {f.outcome && (
                    <div className="text-[11.5px] text-emerald-700 mt-1.5 line-clamp-2 bg-emerald-50 rounded px-2 py-1 inline-block" style={{ background: '#ECFDF5' }}>
                      <strong>Outcome:</strong> {f.outcome}
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                  {f.status === 'pending' && (
                    <button onClick={() => setCompleting(f)} className="px-2 py-1 rounded text-[11px] font-medium bg-emerald-50 text-emerald-700 hover:bg-emerald-100 inline-flex items-center gap-1" title="Mark complete">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Done
                    </button>
                  )}
                  {f.status === 'completed' && (
                    <button onClick={() => reopenFollowUp(f.id)} className="p-1.5 rounded hover:bg-surface text-muted hover:text-ink" title="Reopen">
                      <RotateCcw className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <button onClick={() => setEditing(f)} className="p-1.5 rounded hover:bg-surface text-muted hover:text-ink" title="Edit">
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  {f.status === 'pending' && (
                    <button onClick={() => setConfirmCancel(f)} className="p-1.5 rounded hover:bg-surface text-muted hover:text-ink" title="Cancel">
                      <XCircle className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <button onClick={() => setConfirmDelete(f)} className="p-1.5 rounded hover:bg-rose-50 text-muted hover:text-danger" title="Delete">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Complete dialog */}
      <CompleteFollowUpDialog
        followUp={completing}
        onClose={() => setCompleting(null)}
      />

      {/* Edit dialog */}
      <AddFollowUpDialog
        open={!!editing}
        onClose={() => setEditing(null)}
        editing={editing || undefined}
      />

      {/* Cancel confirm */}
      <ConfirmDialog
        open={!!confirmCancel}
        onClose={() => setConfirmCancel(null)}
        onConfirm={async () => { if (confirmCancel) { await cancelFollowUp(confirmCancel.id); setConfirmCancel(null); } }}
        title="Cancel this follow-up?"
        description={`"${confirmCancel?.title}" will be marked as cancelled. You can still see it in the history.`}
        confirmLabel="Cancel follow-up"
        cancelLabel="Keep it"
        variant="warning"
      />

      {/* Delete confirm */}
      <ConfirmDialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={async () => { if (confirmDelete) { await deleteFollowUp(confirmDelete.id); setConfirmDelete(null); } }}
        title="Delete this follow-up?"
        description={`"${confirmDelete?.title}" will be permanently deleted. This cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
      />
    </>
  );
}

function ChannelChip({ channel }: { channel: FollowUpChannel }) {
  const meta = FOLLOWUP_CHANNEL_META[channel];
  const Icon =
    channel === 'call' ? Phone
    : channel === 'email' ? Mail
    : channel === 'whatsapp' ? MessageCircle
    : channel === 'meeting' ? UsersIcon
    : MoreHorizontal;
  return (
    <span className="inline-flex items-center gap-1 text-[10.5px] font-medium px-1.5 py-0.5 rounded" style={{ background: meta.bg, color: meta.fg }}>
      <Icon className="w-3 h-3" /> {meta.label}
    </span>
  );
}
