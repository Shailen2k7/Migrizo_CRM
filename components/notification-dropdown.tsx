'use client';

import { useMemo, useState, useEffect } from 'react';
import { Bell, AlertTriangle, Clock, IndianRupee, Zap, Check, CheckCheck, X, BellOff, ExternalLink } from 'lucide-react';
import type { Lead, Payment } from '@/lib/types';
import { formatMoney, timeAgo, initials, avatarColor } from '@/lib/utils';
import { getReadSet, markRead, markUnread, clearAllRead, getPrefs } from '@/lib/notifications';

type NotifType = 'overdue-fu' | 'today-fu' | 'overdue-pay' | 'hot-stale';

interface Notif {
  id: string;
  type: NotifType;
  text: string;
  sub: string;
  leadId?: string;
  ts: number;
  priority: 'high' | 'med' | 'low';
}

interface Props {
  leads: Lead[];
  payments: Payment[];
  onOpenLead: (id: string) => void;
}

export function useNotifications({ leads, payments }: { leads: Lead[]; payments: Payment[] }): { all: Notif[]; unreadCount: number } {
  // Recompute on every change; tiny cost, big UX win
  const all = useMemo<Notif[]>(() => {
    const prefs = getPrefs();
    const now = Date.now();
    const dayMs = 86400000;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
    const out: Notif[] = [];

    leads.forEach((l) => {
      if (['won', 'junk'].includes(l.stage)) return;

      if (l.next_follow_up) {
        const t = new Date(l.next_follow_up).getTime();
        if (t < now && prefs.overdueFollowups) {
          const overdueDays = Math.floor((now - t) / dayMs);
          out.push({
            id: 'fu-overdue-' + l.id,
            type: 'overdue-fu',
            text: `Follow up with ${l.full_name}`,
            sub: overdueDays === 0 ? 'Due earlier today' : `${overdueDays}d overdue`,
            leadId: l.id,
            ts: t,
            priority: 'high',
          });
        } else if (t >= today.getTime() && t < tomorrow.getTime() && prefs.followupsToday) {
          out.push({
            id: 'fu-today-' + l.id,
            type: 'today-fu',
            text: `Follow up with ${l.full_name}`,
            sub: `Due ${new Date(l.next_follow_up).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`,
            leadId: l.id,
            ts: t,
            priority: 'med',
          });
        }
      }

      // Hot lead going stale
      if (prefs.hotLeadStale && l.score >= 75) {
        const lastTouch = new Date(l.last_note_at || l.updated_at).getTime();
        if (now - lastTouch > 5 * dayMs) {
          out.push({
            id: 'hot-stale-' + l.id,
            type: 'hot-stale',
            text: `${l.full_name} going cold`,
            sub: `Hot lead untouched for ${Math.floor((now - lastTouch) / dayMs)} days`,
            leadId: l.id,
            ts: lastTouch,
            priority: 'med',
          });
        }
      }
    });

    if (prefs.paymentOverdue) {
      payments.forEach((p) => {
        const isOverdue = p.status === 'overdue' || (p.status === 'pending' && p.due_date && new Date(p.due_date).getTime() < now);
        if (!isOverdue) return;
        const lead = leads.find((l) => l.id === p.lead_id);
        if (!lead) return;
        out.push({
          id: 'pay-overdue-' + p.id,
          type: 'overdue-pay',
          text: `Payment overdue from ${lead.full_name}`,
          sub: `${formatMoney(p.amount, lead?.currency || 'INR')} · ${p.due_date ? `due ${timeAgo(p.due_date)}` : 'overdue'}`,
          leadId: p.lead_id,
          ts: p.due_date ? new Date(p.due_date).getTime() : new Date(p.created_at).getTime(),
          priority: 'high',
        });
      });
    }

    return out.sort((a, b) => {
      const prioRank = { high: 0, med: 1, low: 2 };
      if (prioRank[a.priority] !== prioRank[b.priority]) return prioRank[a.priority] - prioRank[b.priority];
      return a.ts - b.ts;
    });
  }, [leads, payments]);

  const [readSet, setReadSet] = useState<Set<string>>(new Set());
  useEffect(() => { setReadSet(getReadSet()); }, []);

  const unreadCount = useMemo(() => all.filter((n) => !readSet.has(n.id)).length, [all, readSet]);

  return { all, unreadCount };
}

export function NotificationDropdown({ leads, payments, onOpenLead }: Props) {
  const [open, setOpen] = useState(false);
  const [readSet, setReadSet] = useState<Set<string>>(new Set());
  const { all } = useNotifications({ leads, payments });

  useEffect(() => { setReadSet(getReadSet()); }, [open]);

  const unread = all.filter((n) => !readSet.has(n.id));
  const read = all.filter((n) => readSet.has(n.id)).slice(0, 8);
  const count = unread.length;

  const markAllRead = () => {
    markRead(unread.map((n) => n.id));
    setReadSet(getReadSet());
  };

  const dismiss = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    markRead(id);
    setReadSet(getReadSet());
  };

  const restore = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    markUnread(id);
    setReadSet(getReadSet());
  };

  const handleClick = (n: Notif) => {
    markRead(n.id);
    setReadSet(getReadSet());
    if (n.leadId) onOpenLead(n.leadId);
    setOpen(false);
  };

  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)} className="relative p-2.5 rounded-md hover:bg-surface-2 transition" title="Notifications">
        <Bell className="w-[18px] h-[18px] text-ink-2" />
        {count > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1.5 bg-danger text-white rounded-full text-[10px] font-semibold flex items-center justify-center border-2 border-surface">
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute top-full right-0 mt-2 w-[400px] max-w-[calc(100vw-32px)] panel shadow-lg z-50 max-h-[600px] flex flex-col animate-fadeIn">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
              <div>
                <h3 className="text-[14px] font-semibold">Notifications</h3>
                <p className="text-[11px] text-muted">{count > 0 ? `${count} unread` : 'All caught up'}</p>
              </div>
              {count > 0 && (
                <button onClick={markAllRead} className="text-[11.5px] font-medium text-indigo-600 hover:text-indigo-700 flex items-center gap-1">
                  <CheckCheck className="w-3.5 h-3.5" /> Mark all read
                </button>
              )}
            </div>

            <div className="flex-1 overflow-y-auto">
              {all.length === 0 ? (
                <div className="py-14 px-6 text-center">
                  <div className="w-14 h-14 rounded-full bg-surface-2 mx-auto mb-3 flex items-center justify-center">
                    <Check className="w-6 h-6 text-success" />
                  </div>
                  <div className="text-[13px] font-semibold mb-1">You're all caught up!</div>
                  <div className="text-[11.5px] text-muted">No overdue or upcoming items right now</div>
                </div>
              ) : (
                <>
                  {unread.length > 0 && (
                    <>
                      <SectionLabel>Unread · {unread.length}</SectionLabel>
                      {unread.map((n) => <NotifRow key={n.id} n={n} read={false} leads={leads} onClick={() => handleClick(n)} onDismiss={(e) => dismiss(n.id, e)} />)}
                    </>
                  )}
                  {read.length > 0 && (
                    <>
                      <SectionLabel>Recently read</SectionLabel>
                      {read.map((n) => <NotifRow key={n.id} n={n} read={true} leads={leads} onClick={() => handleClick(n)} onRestore={(e) => restore(n.id, e)} />)}
                    </>
                  )}
                </>
              )}
            </div>

            <div className="px-4 py-2.5 border-t border-border flex items-center justify-between bg-surface-2 rounded-b-2xl">
              <a href="/settings?section=notifications" className="text-[11.5px] text-muted hover:text-ink flex items-center gap-1">
                <BellOff className="w-3 h-3" /> Notification settings
              </a>
              {(getReadSet().size > 0) && (
                <button onClick={() => { clearAllRead(); setReadSet(new Set()); }} className="text-[11.5px] text-muted hover:text-danger">
                  Reset read state
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="px-4 pt-3 pb-1.5 text-[10px] uppercase tracking-wider font-semibold text-muted">{children}</div>;
}

function NotifRow({ n, read, leads, onClick, onDismiss, onRestore }: {
  n: Notif; read: boolean; leads: Lead[];
  onClick: () => void; onDismiss?: (e: React.MouseEvent) => void; onRestore?: (e: React.MouseEvent) => void;
}) {
  const lead = n.leadId ? leads.find((l) => l.id === n.leadId) : null;
  const Icon = n.type === 'overdue-fu' ? Clock
    : n.type === 'today-fu' ? Clock
    : n.type === 'overdue-pay' ? IndianRupee
    : n.type === 'hot-stale' ? Zap
    : Bell;
  const colors = n.priority === 'high'
    ? { bg: 'hsl(var(--rose-soft))', fg: '#B91C1C' }
    : n.priority === 'med'
      ? { bg: 'hsl(var(--amber-soft))', fg: '#B45309' }
      : { bg: 'hsl(var(--indigo-soft))', fg: '#4338CA' };

  return (
    <button onClick={onClick} className={`w-full flex items-start gap-3 px-4 py-3 hover:bg-surface-2 text-left transition-colors ${read ? 'opacity-60' : ''} group relative`}>
      <div className="w-9 h-9 rounded-md flex items-center justify-center flex-shrink-0" style={{ background: colors.bg, color: colors.fg }}>
        <Icon className="w-4 h-4" />
      </div>
      <div className="flex-1 min-w-0 pr-6">
        <div className="text-[12.5px] font-medium leading-snug text-ink truncate">{n.text}</div>
        <div className="text-[11px] text-muted mt-0.5 truncate">{n.sub}</div>
        {lead?.visa_type && <div className="text-[10.5px] text-faint mt-0.5 truncate">{lead.visa_type}</div>}
      </div>
      {!read && onDismiss && (
        <button onClick={onDismiss} className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-surface text-muted hover:text-ink transition-opacity" title="Mark as read">
          <X className="w-3 h-3" />
        </button>
      )}
      {read && onRestore && (
        <button onClick={onRestore} className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-surface text-muted hover:text-ink transition-opacity" title="Mark as unread">
          <Bell className="w-3 h-3" />
        </button>
      )}
    </button>
  );
}
