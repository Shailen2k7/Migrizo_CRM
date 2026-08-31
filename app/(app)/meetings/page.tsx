'use client';

// =============================================================================
// MEETINGS — the CRM side of the Scheduling module.
// Upcoming list · Day/Week/Month calendar · status management · notes ·
// reminder history + email delivery status · booking-page settings.
// =============================================================================
import { useState, useEffect, useMemo, useCallback } from 'react';
import { useApp } from '@/components/shared/app-provider';
import { MeetingsDashboard, type MeetFilter } from '@/components/meetings/meetings-dashboard';
import { createClient } from '@/lib/supabase/client';
import { CalendarDays, List as ListIcon, Settings2, Copy, X, Clock, CheckCircle2, Ban, UserX, Loader2, Link as LinkIcon, BellRing, Pencil, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface Meeting {
  id: string; member_id: string; lead_id: string | null;
  client_name: string; client_email: string; client_phone: string | null;
  starts_at: string; ends_at: string; status: string; notes: string | null;
  meet_link: string | null; manage_token: string; created_at: string;
}
interface Member { id: string; user_id: string; slug: string; display_name: string; title: string; meeting_link: string | null; timezone: string; slot_minutes: number; slot_step_minutes: number; buffer_minutes: number; working_hours: Record<string, [string, string][]>; active: boolean;
  min_notice_minutes: number; max_days_ahead: number; daily_meeting_cap: number | null;
  reminder_kinds: string[]; paused_message: string | null; }
interface DateOverride { id: string; on_date: string; windows: [string, string][]; note: string | null; }
interface Reminder { id: string; kind: string; send_at: string; status: string; attempts: number; error: string | null; sent_at: string | null; }
interface Activity { id: string; event: string; meta: Record<string, unknown>; created_at: string; }

const STATUS_META: Record<string, { label: string; fg: string; bg: string; icon: typeof Clock }> = {
  upcoming:  { label: 'Upcoming', fg: '#3E56D4', bg: '#EEF2FF', icon: Clock },
  completed: { label: 'Completed', fg: '#047857', bg: '#E6F7EE', icon: CheckCircle2 },
  cancelled: { label: 'Cancelled', fg: '#6B7280', bg: '#F3F4F6', icon: Ban },
  no_show:   { label: 'No Show', fg: '#B45309', bg: '#FEF6E7', icon: UserX },
};
const KIND_LABEL: Record<string, string> = {
  confirm: 'Confirmation', h24: '24-hour reminder', h3: '3-hour reminder', h1: '1-hour reminder',
  m15: '15-minute reminder', start: 'Meeting-start email', followup: 'No-join follow-up',
};

export default function MeetingsPage() {
  const { user, workspace, role } = useApp();
  const supabase = useMemo(() => createClient(), []);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [resched, setResched] = useState<{ meeting_id: string; created_at: string }[]>([]);
  const [view, setView] = useState<'list' | 'day' | 'week' | 'month'>('list');
  const [anchor, setAnchor] = useState(() => new Date());
  const [selected, setSelected] = useState<Meeting | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // ── history list controls (the old page hard-capped Past at 40 rows) ──────
  const [dashFilter, setDashFilter] = useState<MeetFilter | null>(null);
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'upcoming' | 'completed' | 'no_show' | 'cancelled'>('all');
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 25;

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      // 2000, not 500: the dashboard aggregates the whole year, and the old
      // cap silently hid everything before mid-August at ~500 rows. If the
      // business ever books beyond 2000 meetings a year the aggregation moves
      // to a SQL view; until then one fetch of narrow rows is cheaper than
      // being wrong.
      const [msRes, memRes, reRes] = await Promise.all([
        supabase.from('meetings').select('*').eq('workspace_id', workspace.id).order('starts_at', { ascending: true }).limit(2000),
        supabase.from('scheduler_members').select('*').eq('workspace_id', workspace.id),
        supabase.from('meeting_activity').select('meeting_id, created_at').eq('workspace_id', workspace.id).eq('event', 'rescheduled').limit(2000),
      ]);
      if (msRes.error) throw msRes.error;
      if (memRes.error) throw memRes.error;
      setMeetings((msRes.data as Meeting[]) || []);
      setMembers((memRes.data as Member[]) || []);
      setResched(((reRes.data as { meeting_id: string; created_at: string }[]) || []));
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load meetings. Please try again.');
      setMeetings([]);
      setMembers([]);
    } finally {
      setLoading(false);
    }
  }, [supabase, workspace.id]);
  useEffect(() => { void load(); }, [load]);

  const memberById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);
  const myMember = members.find((m) => m.user_id === user.id) || null;

  async function setStatus(m: Meeting, status: string) {
    await supabase.from('meetings').update({ status, updated_at: new Date().toISOString() }).eq('id', m.id);
    if (status !== 'upcoming') await supabase.from('meeting_reminders').update({ status: 'skipped' }).eq('meeting_id', m.id).eq('status', 'queued');
    await supabase.from('meeting_activity').insert({ meeting_id: m.id, workspace_id: workspace.id, event: 'status_changed', meta: { to: status } });
    setMeetings((prev) => prev.map((x) => (x.id === m.id ? { ...x, status } : x)));
    if (selected?.id === m.id) setSelected({ ...m, status });
    toast.success(`Marked ${STATUS_META[status]?.label || status}`);
  }

  const fmtTime = (s: string) => new Intl.DateTimeFormat('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(s));
  const fmtDay = (s: string) => new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(s));
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

  // ------- calendar helpers -------
  const daysFor = useMemo(() => {
    if (view === 'day') return [new Date(anchor)];
    if (view === 'week') {
      const start = new Date(anchor); start.setDate(start.getDate() - ((start.getDay() + 6) % 7)); // Monday
      return Array.from({ length: 7 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
    }
    // month grid (6 rows)
    const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const start = new Date(first); start.setDate(1 - ((first.getDay() + 6) % 7));
    return Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  }, [view, anchor]);

  const meetingsOn = (d: Date) => meetings.filter((m) => sameDay(new Date(m.starts_at), d));
  const upcoming = meetings.filter((m) => m.status === 'upcoming' && new Date(m.starts_at) >= new Date(Date.now() - 30 * 60000));

  // Full history — searchable, filterable, paginated. Every meeting ever
  // booked is reachable from here; nothing is silently truncated any more.
  const history = useMemo(() => {
    const upcomingIds = new Set(upcoming.map((m) => m.id));
    // A dashboard drill-in ("Booked in period") may legitimately include calls
    // that are still upcoming — when it is active the list covers everything,
    // otherwise upcoming rows stay in their own section above.
    let list = (dashFilter ? meetings : meetings.filter((m) => !upcomingIds.has(m.id))).slice().reverse();
    if (dashFilter) list = list.filter((m) => dashFilter.ids.has(m.id));
    if (statusFilter !== 'all') list = list.filter((m) => m.status === statusFilter);
    const needle = q.trim().toLowerCase();
    if (needle) {
      list = list.filter((m) =>
        m.client_name.toLowerCase().includes(needle) ||
        (m.client_email || '').toLowerCase().includes(needle) ||
        (m.client_phone || '').toLowerCase().includes(needle));
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetings, dashFilter, statusFilter, q]);
  const pageCount = Math.max(1, Math.ceil(history.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = history.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  const shift = (dir: 1 | -1) => {
    const d = new Date(anchor);
    if (view === 'day') d.setDate(d.getDate() + dir);
    else if (view === 'week') d.setDate(d.getDate() + 7 * dir);
    else d.setMonth(d.getMonth() + dir);
    setAnchor(d);
  };

  return (
    <div className="max-w-[1240px] mx-auto px-4 sm:px-6 lg:px-8 pt-5 sm:pt-7 pb-16 animate-pageIn">
      {/* Header */}
      <div className="flex items-start justify-between mb-5 gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2.5"><CalendarDays className="w-6 h-6 text-indigo" /><h1 className="text-[26px] font-bold text-ink">Meetings</h1></div>
          <p className="text-[13px] text-muted mt-1">Bookings, reminders, and your public scheduling links</p>
        </div>
        <div className="flex items-center gap-2.5 flex-wrap">
          {myMember && (
            <button onClick={() => { navigator.clipboard.writeText(`https://crm.migrizo.com/book/${myMember.slug}`); toast.success('Booking link copied'); }} className="btn btn-outline">
              <LinkIcon className="w-4 h-4" /> Copy my booking link
            </button>
          )}
          <button onClick={() => setSettingsOpen(true)} className="btn btn-outline"><Settings2 className="w-4 h-4" /> Booking settings</button>
        </div>
      </div>

      {/* Dashboard — clicking a card filters the History list below and
          switches to List view so the filtered rows are actually visible. */}
      {!loading && !loadError && (
        <MeetingsDashboard
          meetings={meetings}
          resched={resched}
          activeFilter={dashFilter}
          onFilter={(f) => { setDashFilter(f); setPage(0); setStatusFilter('all'); if (f) setView('list'); }}
        />
      )}

      {/* View toggle */}
      <div className="flex items-center justify-between gap-3 mb-5 flex-wrap">
        <div className="inline-flex items-center gap-1 bg-surface-2 rounded-lg p-1">
          {([['list', 'List', ListIcon], ['day', 'Day', CalendarDays], ['week', 'Week', CalendarDays], ['month', 'Month', CalendarDays]] as const).map(([k, label]) => (
            <button key={k} onClick={() => setView(k)} className={cn('px-3 py-1.5 rounded-md text-[12.5px] font-medium transition', view === k ? 'bg-surface shadow-sm text-ink' : 'text-muted hover:text-ink')}>{label}</button>
          ))}
        </div>
        {view !== 'list' && (
          <div className="flex items-center gap-2">
            <button onClick={() => shift(-1)} className="btn btn-outline btn-sm">‹</button>
            <span className="text-[13px] font-semibold text-ink min-w-[150px] text-center">
              {view === 'month'
                ? new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' }).format(anchor)
                : new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(anchor)}
            </span>
            <button onClick={() => shift(1)} className="btn btn-outline btn-sm">›</button>
            <button onClick={() => setAnchor(new Date())} className="btn btn-outline btn-sm">Today</button>
          </div>
        )}
      </div>

      {loading ? <div className="panel panel-pad text-center py-16 text-muted text-[13px]">Loading meetings…</div> : loadError ? (
        <div className="panel panel-pad text-center py-16">
          <div className="text-[13px] text-muted mb-3">Couldn&apos;t load meetings.</div>
          <div className="text-[11px] text-faint mb-4 max-w-md mx-auto break-words">{loadError}</div>
          <button onClick={() => void load()} className="btn btn-outline btn-sm">Retry</button>
        </div>
      ) : view === 'list' ? (
        <>
          <h2 className="text-[13px] font-bold text-muted uppercase tracking-wide mb-2">Upcoming ({upcoming.length})</h2>
          {upcoming.length === 0 && (
            <div className="panel panel-pad text-center py-12 mb-6">
              <div className="text-[14px] font-medium text-ink mb-1">No upcoming meetings</div>
              <div className="text-[12.5px] text-muted">Share your booking link and meetings will appear here the moment they're booked.</div>
            </div>
          )}
          <div className="space-y-2.5 mb-8">
            {upcoming.map((m) => <MeetingRow key={m.id} m={m} member={memberById.get(m.member_id)} onOpen={() => setSelected(m)} fmtDay={fmtDay} fmtTime={fmtTime} />)}
          </div>

          {/* ── Full history: search + status filter + pagination ── */}
          <div className="mb-2 flex flex-wrap items-center gap-2.5">
            <h2 className="text-[13px] font-bold text-muted uppercase tracking-wide">History ({history.length})</h2>
            {dashFilter && (
              <span className="inline-flex items-center gap-2 rounded-lg bg-[hsl(var(--indigo-soft))] px-2.5 py-1 text-[11.5px] font-semibold text-[#3730A3]">
                {dashFilter.label}
                <button onClick={() => { setDashFilter(null); setPage(0); }} className="font-bold hover:opacity-70">✕</button>
              </span>
            )}
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <div className="inline-flex items-center gap-1 rounded-lg bg-surface-2 p-1">
                {([['all', 'All'], ['upcoming', 'Upcoming'], ['completed', 'Completed'], ['no_show', 'No show'], ['cancelled', 'Cancelled']] as const).map(([k, label]) => (
                  <button key={k} onClick={() => { setStatusFilter(k); setPage(0); }}
                    className={cn('rounded-md px-2.5 py-1 text-[11.5px] font-semibold transition', statusFilter === k ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink')}>
                    {label}
                  </button>
                ))}
              </div>
              <input
                value={q}
                onChange={(e) => { setQ(e.target.value); setPage(0); }}
                placeholder="Search name, email, phone…"
                className="input w-[200px] px-3 py-1.5 text-[12.5px]"
              />
            </div>
          </div>
          {history.length === 0 ? (
            <div className="panel panel-pad py-10 text-center text-[12.5px] text-muted">No meetings match.</div>
          ) : (
            <>
              <div className="space-y-2.5">
                {pageRows.map((m) => <MeetingRow key={m.id} m={m} member={memberById.get(m.member_id)} onOpen={() => setSelected(m)} fmtDay={fmtDay} fmtTime={fmtTime} />)}
              </div>
              {pageCount > 1 && (
                <div className="mt-4 flex items-center justify-between text-[12.5px] text-muted">
                  <span>Showing <b className="text-ink">{safePage * PAGE_SIZE + 1}–{Math.min(history.length, (safePage + 1) * PAGE_SIZE)}</b> of <b className="text-ink">{history.length}</b></span>
                  <div className="flex items-center gap-2">
                    <button onClick={() => setPage(Math.max(0, safePage - 1))} disabled={safePage === 0} className="btn btn-outline btn-sm disabled:opacity-40">‹ Newer</button>
                    <span className="num font-semibold text-ink">{safePage + 1} / {pageCount}</span>
                    <button onClick={() => setPage(Math.min(pageCount - 1, safePage + 1))} disabled={safePage >= pageCount - 1} className="btn btn-outline btn-sm disabled:opacity-40">Older ›</button>
                  </div>
                </div>
              )}
            </>
          )}
        </>
      ) : (
        <div className={cn('grid gap-2', view === 'day' ? 'grid-cols-1' : view === 'week' ? 'grid-cols-2 sm:grid-cols-7' : 'grid-cols-7')}>
          {view === 'month' && ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d} className="text-[11px] font-bold text-muted text-center">{d}</div>)}
          {daysFor.map((d, i) => {
            const list = meetingsOn(d);
            const isToday = sameDay(d, new Date());
            const inMonth = view !== 'month' || d.getMonth() === anchor.getMonth();
            return (
              <div key={i} className={cn('panel p-2 min-h-[92px]', !inMonth && 'opacity-40', isToday && 'border-indigo')}>
                <div className={cn('text-[11.5px] font-bold mb-1.5', isToday ? 'text-indigo' : 'text-muted')}>
                  {view === 'month' ? d.getDate() : new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric' }).format(d)}
                </div>
                <div className="space-y-1">
                  {list.slice(0, view === 'day' ? 50 : 3).map((m) => {
                    const s = STATUS_META[m.status] || STATUS_META.upcoming;
                    return (
                      <button key={m.id} onClick={() => setSelected(m)} className="w-full text-left rounded-md px-1.5 py-1 text-[10.5px] font-semibold truncate" style={{ background: s.bg, color: s.fg }}>
                        {fmtTime(m.starts_at)} · {m.client_name}
                      </button>
                    );
                  })}
                  {list.length > 3 && view !== 'day' && <div className="text-[10px] text-muted">+{list.length - 3} more</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {selected && <MeetingDrawer m={selected} member={memberById.get(selected.member_id)} onClose={() => setSelected(null)} onStatus={(s) => void setStatus(selected, s)} workspaceId={workspace.id} userId={user.id}
        onNotes={(notes) => { setMeetings((prev) => prev.map((x) => x.id === selected.id ? { ...x, notes } : x)); }}
        onUpdated={(patch) => { setMeetings((prev) => prev.map((x) => x.id === selected.id ? { ...x, ...patch } : x)); setSelected((cur) => cur ? { ...cur, ...patch } : cur); }}
        onDeleted={() => { setMeetings((prev) => prev.filter((x) => x.id !== selected.id)); setSelected(null); }} />}
      {settingsOpen && <SettingsDrawer myMember={myMember} members={members} isAdmin={role === 'admin'} userId={user.id} workspaceId={workspace.id} onClose={() => { setSettingsOpen(false); void load(); }} />}
    </div>
  );
}

function MeetingRow({ m, member, onOpen, fmtDay, fmtTime }: { m: Meeting; member?: Member; onOpen: () => void; fmtDay: (s: string) => string; fmtTime: (s: string) => string }) {
  const s = STATUS_META[m.status] || STATUS_META.upcoming;
  const Icon = s.icon;
  return (
    <div onClick={onOpen} className="panel px-4 py-3 flex items-center gap-3.5 hover:shadow-md transition-shadow cursor-pointer">
      <div className="w-11 h-11 rounded-[10px] flex flex-col items-center justify-center flex-shrink-0" style={{ background: s.bg }}>
        <span className="text-[10px] font-bold" style={{ color: s.fg }}>{fmtDay(m.starts_at).split(' ')[0]}</span>
        <span className="text-[13px] font-800 font-bold leading-none" style={{ color: s.fg }}>{new Date(m.starts_at).getDate()}</span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="font-semibold text-ink text-[13.5px] truncate">{m.client_name}</div>
        <div className="text-[11.5px] text-muted truncate">{fmtDay(m.starts_at)} · {fmtTime(m.starts_at)}–{fmtTime(m.ends_at)}{member ? ` · with ${member.display_name}` : ''}</div>
      </div>
      <span className="inline-flex items-center gap-1 text-[11px] font-bold rounded-full px-2.5 py-1 flex-shrink-0" style={{ background: s.bg, color: s.fg }}>
        <Icon className="w-3 h-3" />{s.label}
      </span>
    </div>
  );
}

function MeetingDrawer({ m, member, onClose, onStatus, workspaceId, userId, onNotes, onUpdated, onDeleted }: {
  m: Meeting; member?: Member; onClose: () => void; onStatus: (s: string) => void; workspaceId: string; userId: string; onNotes: (n: string) => void; onUpdated: (patch: Partial<Meeting>) => void; onDeleted: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [notes, setNotes] = useState(m.notes || '');
  const [savingNotes, setSavingNotes] = useState(false);

  // ── Edit / Reschedule / Delete ──────────────────────────────────────────
  const [editOpen, setEditOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const start0 = new Date(m.starts_at);
  const dur0 = Math.max(15, Math.round((new Date(m.ends_at).getTime() - start0.getTime()) / 60000));
  const [eName, setEName] = useState(m.client_name);
  const [eEmail, setEEmail] = useState(m.client_email);
  const [ePhone, setEPhone] = useState(m.client_phone || '');
  const [eDate, setEDate] = useState(() => `${start0.getFullYear()}-${String(start0.getMonth() + 1).padStart(2, '0')}-${String(start0.getDate()).padStart(2, '0')}`);
  const [eTime, setETime] = useState(() => `${String(start0.getHours()).padStart(2, '0')}:${String(start0.getMinutes()).padStart(2, '0')}`);
  const [eDur, setEDur] = useState(String(dur0));

  async function saveEdit() {
    if (!eName.trim() || !eEmail.trim() || !eDate || !eTime) { toast.error('Name, email, date and time are required'); return; }
    const starts = new Date(`${eDate}T${eTime}:00`);
    const durMin = Math.max(15, parseInt(eDur, 10) || dur0);
    const ends = new Date(starts.getTime() + durMin * 60000);
    if (isNaN(starts.getTime())) { toast.error('Invalid date or time'); return; }
    setSaving(true);
    try {
      const timeChanged = starts.toISOString() !== new Date(m.starts_at).toISOString() || ends.toISOString() !== new Date(m.ends_at).toISOString();
      const patch = {
        client_name: eName.trim(), client_email: eEmail.trim(), client_phone: ePhone.trim() || null,
        starts_at: starts.toISOString(), ends_at: ends.toISOString(), updated_at: new Date().toISOString(),
      };
      const { error } = await supabase.from('meetings').update(patch).eq('id', m.id);
      if (error) throw error;
      if (timeChanged) {
        // Re-queue reminder emails for the new time (same offsets as booking flow).
        await supabase.from('meeting_reminders').update({ status: 'skipped' }).eq('meeting_id', m.id).eq('status', 'queued');
        const OFF: { kind: string; minutes: number }[] = [
          { kind: 'h24', minutes: -1440 }, { kind: 'h3', minutes: -180 }, { kind: 'h1', minutes: -60 },
          { kind: 'm15', minutes: -15 }, { kind: 'start', minutes: 0 }, { kind: 'followup', minutes: 10 },
        ];
        const now = Date.now();
        const rows = OFF.map((o) => ({ meeting_id: m.id, workspace_id: workspaceId, kind: o.kind, send_at: new Date(starts.getTime() + o.minutes * 60000).toISOString() }))
          .filter((r) => new Date(r.send_at).getTime() > now - 60000);
        if (rows.length) await supabase.from('meeting_reminders').insert(rows);
        await supabase.from('meeting_activity').insert({ meeting_id: m.id, workspace_id: workspaceId, event: 'rescheduled', meta: { by: 'staff', to: starts.toISOString() } });
        const { data } = await supabase.from('meeting_reminders').select('*').eq('meeting_id', m.id).order('send_at');
        setReminders((data as Reminder[]) || []);
      } else {
        await supabase.from('meeting_activity').insert({ meeting_id: m.id, workspace_id: workspaceId, event: 'details_updated', meta: { by: 'staff' } });
      }
      onUpdated(patch as Partial<Meeting>);
      setEditOpen(false);
      toast.success(timeChanged ? 'Meeting rescheduled — reminders re-queued' : 'Meeting updated');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save changes');
    } finally {
      setSaving(false);
    }
  }

  async function deleteMeeting() {
    setDeleting(true);
    try {
      const { error } = await supabase.from('meetings').delete().eq('id', m.id);
      if (error) throw error;
      toast.success('Meeting deleted');
      onDeleted(); // reminders & activity are removed automatically (DB cascade)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete meeting');
      setDeleting(false);
    }
  }

  useEffect(() => {
    void supabase.from('meeting_reminders').select('*').eq('meeting_id', m.id).order('send_at').then(({ data }) => setReminders((data as Reminder[]) || []));
    void supabase.from('meeting_activity').select('*').eq('meeting_id', m.id).order('created_at', { ascending: false }).limit(30).then(({ data }) => setActivity((data as Activity[]) || []));
  }, [m.id, supabase]);

  /**
   * Mirror this meeting's note onto the lead (migration 072).
   *
   * A call note is the most valuable thing anyone writes about a lead, and it
   * used to live only on the meeting. Writing it into `notes` — and refreshing
   * leads.last_note — is what makes it appear in the lead drawer, the Last note
   * column, the daily tracker and its CSV export, search, and the AI context.
   *
   * ONE note per meeting: edit the meeting note and the same row is updated,
   * so the lead never collects near-duplicates. Clearing the meeting note
   * removes the mirror.
   */
  async function mirrorNoteToLead(body: string) {
    if (!m.lead_id) return;               // walk-in / unmatched booking: nothing to attach to
    const leadId = m.lead_id;

    const { data: existing } = await supabase
      .from('notes').select('id').eq('meeting_id', m.id).maybeSingle();

    if (!body) {
      if (existing?.id) await supabase.from('notes').delete().eq('id', existing.id);
    } else if (existing?.id) {
      // created_at is deliberately NOT touched: the note belongs to the moment
      // of the meeting, so a later edit should not jump it to the top of the
      // lead's timeline.
      const { data, error } = await supabase
        .from('notes').update({ body }).eq('id', existing.id).select('id');
      if (error || !data?.length) throw new Error('The note could not be saved to the lead');
    } else {
      const { error } = await supabase.from('notes').insert({
        lead_id: leadId, workspace_id: workspaceId, body,
        author_id: userId, meeting_id: m.id,
      });
      if (error) throw new Error(error.message);
    }

    // Recompute the lead's "last note" from the notes table rather than
    // assuming this one is newest — it may be an edit to an older meeting.
    const { data: latest } = await supabase
      .from('notes').select('body, created_at, author_id')
      .eq('lead_id', leadId).order('created_at', { ascending: false }).limit(1);
    const top = latest?.[0] as { body: string; created_at: string; author_id: string | null } | undefined;
    await supabase.from('leads').update({
      last_note: top?.body ?? null,
      last_note_at: top?.created_at ?? null,
      last_note_author_id: top?.author_id ?? null,
    }).eq('id', leadId);
  }

  async function saveNotes() {
    setSavingNotes(true);
    const body = notes.trim();
    try {
      const { error } = await supabase.from('meetings').update({ notes }).eq('id', m.id).select('id');
      if (error) throw new Error(error.message);
      await mirrorNoteToLead(body);
      await supabase.from('meeting_activity').insert({ meeting_id: m.id, workspace_id: workspaceId, event: 'note_added', meta: {} });
      onNotes(notes);
      toast.success(m.lead_id ? 'Notes saved — also added to the lead' : 'Notes saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save notes');
    } finally {
      setSavingNotes(false);
    }
  }

  const fmt = (s: string) => new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(s));
  const remStatus: Record<string, { fg: string; bg: string; label: string }> = {
    queued: { fg: '#3E56D4', bg: '#EEF2FF', label: 'Scheduled' }, sent: { fg: '#047857', bg: '#E6F7EE', label: 'Delivered' },
    failed: { fg: '#B91C1C', bg: '#FDECEC', label: 'Failed' }, skipped: { fg: '#6B7280', bg: '#F3F4F6', label: 'Skipped' },
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex justify-end" onClick={onClose}>
      <div className="bg-surface w-full max-w-[480px] h-full overflow-y-auto p-5 animate-fadeIn" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[17px] font-bold text-ink">{m.client_name}</h2>
          <button onClick={onClose} className="p-1.5 rounded-md hover:bg-surface-2 text-muted"><X className="w-4 h-4" /></button>
        </div>
        <div className="panel panel-pad mb-4 text-[13px] text-ink leading-relaxed">
          📅 <b>{fmt(m.starts_at)}</b> – {new Intl.DateTimeFormat('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(m.ends_at))}<br />
          ✉️ {m.client_email}{m.client_phone ? <><br />📞 {m.client_phone}</> : null}
          {member && <><br />🧑‍💼 With {member.display_name}</>}
          {m.meet_link && <><br />🔗 <a href={m.meet_link} target="_blank" className="text-indigo underline" rel="noreferrer">{m.meet_link}</a></>}
        </div>

        {/* Actions: edit / reschedule / delete */}
        <div className="flex gap-2 mb-4">
          <button onClick={() => setEditOpen((v) => !v)} className="btn btn-outline btn-sm flex-1"><Pencil className="w-3.5 h-3.5" /> Edit / Reschedule</button>
          {!confirmDelete ? (
            <button onClick={() => setConfirmDelete(true)} className="btn btn-sm" style={{ background: '#FDECEC', color: '#B91C1C', border: '1px solid #F5C6C6' }}><Trash2 className="w-3.5 h-3.5" /> Delete</button>
          ) : (
            <div className="flex gap-1.5">
              <button onClick={() => void deleteMeeting()} disabled={deleting} className="btn btn-sm" style={{ background: '#B91C1C', color: '#fff' }}>{deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null} Confirm delete</button>
              <button onClick={() => setConfirmDelete(false)} className="btn btn-outline btn-sm">Keep</button>
            </div>
          )}
        </div>

        {/* Inline edit / reschedule panel */}
        {editOpen && (
          <div className="panel panel-pad mb-4 space-y-2.5">
            <div className="text-[11px] font-bold uppercase tracking-wide text-muted">Edit meeting</div>
            <input value={eName} onChange={(e) => setEName(e.target.value)} placeholder="Client name" className="w-full px-3 py-2 border border-border rounded-lg text-[13px] focus:border-indigo outline-none" />
            <div className="grid grid-cols-2 gap-2">
              <input value={eEmail} onChange={(e) => setEEmail(e.target.value)} placeholder="Email" type="email" className="px-3 py-2 border border-border rounded-lg text-[13px] focus:border-indigo outline-none" />
              <input value={ePhone} onChange={(e) => setEPhone(e.target.value)} placeholder="Phone (optional)" className="px-3 py-2 border border-border rounded-lg text-[13px] focus:border-indigo outline-none" />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <div className="text-[10.5px] text-muted mb-1 font-semibold">Date</div>
                <input value={eDate} onChange={(e) => setEDate(e.target.value)} type="date" className="w-full px-2.5 py-2 border border-border rounded-lg text-[12.5px] focus:border-indigo outline-none" />
              </div>
              <div>
                <div className="text-[10.5px] text-muted mb-1 font-semibold">Start time</div>
                <input value={eTime} onChange={(e) => setETime(e.target.value)} type="time" className="w-full px-2.5 py-2 border border-border rounded-lg text-[12.5px] focus:border-indigo outline-none" />
              </div>
              <div>
                <div className="text-[10.5px] text-muted mb-1 font-semibold">Duration (min)</div>
                <input value={eDur} onChange={(e) => setEDur(e.target.value)} type="number" min={15} step={5} className="w-full px-2.5 py-2 border border-border rounded-lg text-[12.5px] focus:border-indigo outline-none" />
              </div>
            </div>
            <div className="text-[11px] text-muted">Changing the date or time re-queues all reminder emails for the new slot automatically.</div>
            <div className="flex gap-2 pt-1">
              <button onClick={() => void saveEdit()} disabled={saving} className="btn btn-primary btn-sm">{saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null} Save changes</button>
              <button onClick={() => setEditOpen(false)} className="btn btn-outline btn-sm">Cancel</button>
            </div>
          </div>
        )}

        {/* Status */}
        <div className="text-[11px] font-bold uppercase tracking-wide text-muted mb-1.5">Status</div>
        <div className="flex gap-1.5 flex-wrap mb-5">
          {Object.entries(STATUS_META).map(([k, s]) => (
            <button key={k} onClick={() => onStatus(k)} className={cn('text-[11.5px] font-bold rounded-full px-3 py-1.5 border transition', m.status === k ? 'border-transparent' : 'border-border bg-surface text-muted hover:text-ink')}
              style={m.status === k ? { background: s.bg, color: s.fg } : undefined}>{s.label}</button>
          ))}
        </div>

        {/* Notes */}
        <div className="text-[11px] font-bold uppercase tracking-wide text-muted mb-1.5">Meeting notes</div>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} placeholder="Discussion points, outcomes, next steps…"
          className="w-full px-3 py-2.5 border border-border rounded-lg text-[13px] focus:border-indigo outline-none resize-y mb-2" />
        <div className="flex items-center gap-2 mb-5">
          <button onClick={saveNotes} disabled={savingNotes} className="btn btn-outline btn-sm">{savingNotes ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null} Save notes</button>
          {/* Say where the note is going. Silent side effects on client records
              are how people end up writing things they would not have written. */}
          <span className="text-[11px] text-muted">
            {m.lead_id
              ? 'Also saved to this lead — visible in the lead drawer, leads list and exports.'
              : 'This meeting is not linked to a lead, so the note stays here only.'}
          </span>
        </div>

        {/* Reminder history / delivery status */}
        <div className="text-[11px] font-bold uppercase tracking-wide text-muted mb-1.5 flex items-center gap-1.5"><BellRing className="w-3.5 h-3.5" /> Reminders & email delivery</div>
        <div className="panel divide-y divide-border mb-5">
          {reminders.length === 0 && <div className="px-4 py-3 text-[12px] text-muted">No reminders scheduled.</div>}
          {reminders.map((r) => {
            const s = remStatus[r.status] || remStatus.queued;
            return (
              <div key={r.id} className="px-4 py-2.5 flex items-center justify-between gap-3">
                <div>
                  <div className="text-[12.5px] font-semibold text-ink">{KIND_LABEL[r.kind] || r.kind}</div>
                  <div className="text-[11px] text-muted">{r.status === 'sent' && r.sent_at ? `Delivered ${fmt(r.sent_at)}` : `For ${fmt(r.send_at)}`}{r.error ? ` · ${r.error}` : ''}{r.attempts > 1 ? ` · ${r.attempts} attempts` : ''}</div>
                </div>
                <span className="text-[10.5px] font-bold rounded-full px-2 py-0.5 flex-shrink-0" style={{ background: s.bg, color: s.fg }}>{s.label}</span>
              </div>
            );
          })}
        </div>

        {/* Activity timeline */}
        <div className="text-[11px] font-bold uppercase tracking-wide text-muted mb-1.5">Activity timeline</div>
        <div className="space-y-2">
          {activity.map((a) => (
            <div key={a.id} className="flex items-start gap-2.5 text-[12px]">
              <span className="w-1.5 h-1.5 rounded-full bg-indigo mt-1.5 flex-shrink-0" />
              <div>
                <span className="text-ink font-medium capitalize">{a.event.replace(/_/g, ' ')}</span>
                {a.meta && (a.meta as { kind?: string }).kind ? <span className="text-muted"> · {KIND_LABEL[(a.meta as { kind: string }).kind] || (a.meta as { kind: string }).kind}</span> : null}
                <span className="text-faint"> · {fmt(a.created_at)}</span>
              </div>
            </div>
          ))}
          {activity.length === 0 && <div className="text-[12px] text-muted">No activity yet.</div>}
        </div>
      </div>
    </div>
  );
}

const DAYS: { key: string; label: string }[] = [
  { key: 'mon', label: 'Monday' }, { key: 'tue', label: 'Tuesday' }, { key: 'wed', label: 'Wednesday' },
  { key: 'thu', label: 'Thursday' }, { key: 'fri', label: 'Friday' }, { key: 'sat', label: 'Saturday' }, { key: 'sun', label: 'Sunday' },
];

function SettingsDrawer({ myMember, members, isAdmin, userId, workspaceId, onClose }: {
  myMember: Member | null; members: Member[]; isAdmin: boolean; userId: string; workspaceId: string; onClose: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [m, setM] = useState<Partial<Member>>(myMember || {
    slug: '', display_name: '', title: 'GTV Consultation', meeting_link: '', timezone: 'Asia/Kolkata',
    slot_minutes: 30, slot_step_minutes: 30, buffer_minutes: 0, active: true,
    min_notice_minutes: 60, max_days_ahead: 30, daily_meeting_cap: null,
    reminder_kinds: ['h24', 'h3', 'h1', 'm15', 'start'], paused_message: null,
    working_hours: { mon: [['10:00', '22:00']], tue: [['10:00', '22:00']], wed: [['10:00', '22:00']], thu: [['10:00', '22:00']], fri: [['10:00', '22:00']], sat: [], sun: [['10:00', '22:00']] },
  });
  const [saving, setSaving] = useState(false);
  const wh = (m.working_hours || {}) as Record<string, [string, string][]>;

  // ── one-off exceptions (084) ───────────────────────────────────────────────
  // A holiday, a flight, a conference. Previously this meant editing the weekly
  // pattern and remembering to put it back — which nobody ever does.
  const [overrides, setOverrides] = useState<DateOverride[]>([]);
  const [ovDate, setOvDate] = useState('');
  const [ovNote, setOvNote] = useState('');
  const [ovFrom, setOvFrom] = useState('');
  const [ovTo, setOvTo] = useState('');

  const loadOverrides = useCallback(async () => {
    if (!myMember?.id) return;
    const { data } = await supabase.from('scheduler_date_overrides')
      .select('id, on_date, windows, note')
      .eq('member_id', myMember.id)
      .gte('on_date', new Date().toISOString().slice(0, 10))
      .order('on_date');
    setOverrides((data || []) as DateOverride[]);
  }, [supabase, myMember?.id]);

  useEffect(() => { void loadOverrides(); }, [loadOverrides]);

  async function addOverride() {
    if (!myMember?.id) { toast.error('Save your booking page first'); return; }
    if (!ovDate) { toast.error('Pick a date'); return; }
    // Both times given → different hours that day. Neither → the day is off.
    const windows = ovFrom && ovTo ? [[ovFrom, ovTo]] : [];
    const { error } = await supabase.from('scheduler_date_overrides').upsert({
      workspace_id: workspaceId, member_id: myMember.id,
      on_date: ovDate, windows, note: ovNote.trim() || null, created_by: userId,
    }, { onConflict: 'member_id,on_date' });
    if (error) { toast.error(error.message); return; }
    toast.success(windows.length ? 'Custom hours saved' : 'Day blocked');
    setOvDate(''); setOvNote(''); setOvFrom(''); setOvTo('');
    void loadOverrides();
  }

  async function removeOverride(id: string) {
    const { error } = await supabase.from('scheduler_date_overrides').delete().eq('id', id);
    if (error) { toast.error(error.message); return; }
    void loadOverrides();
  }

  // A day is a LIST of windows, not one. That is what makes a lunch break
  // possible — 10:00–13:00 and 15:00–19:00 on the same Tuesday. The slot engine
  // always supported it; only this editor did not.
  function setDay(key: string, open: boolean) {
    setM({ ...m, working_hours: { ...wh, [key]: open ? [['10:00', '18:00']] : [] } });
  }
  function setRange(key: string, i: number, idx: 0 | 1, val: string) {
    const list = [...(wh[key] || [])];
    const cur = list[i] || ['10:00', '18:00'];
    list[i] = (idx === 0 ? [val, cur[1]] : [cur[0], val]) as [string, string];
    setM({ ...m, working_hours: { ...wh, [key]: list } });
  }
  function addWindow(key: string) {
    const list = [...(wh[key] || [])];
    const last = list[list.length - 1];
    // Start the new window after the previous one ends, so the common case
    // (add a break) needs one click and no typing.
    const start = last ? last[1] : '15:00';
    list.push([start, '19:00']);
    setM({ ...m, working_hours: { ...wh, [key]: list } });
  }
  function removeWindow(key: string, i: number) {
    const list = (wh[key] || []).filter((_, x) => x !== i);
    setM({ ...m, working_hours: { ...wh, [key]: list } });
  }
  function copyToWeekdays(key: string) {
    const src = wh[key] || [];
    const next = { ...wh };
    ['mon', 'tue', 'wed', 'thu', 'fri'].forEach((d) => { next[d] = src.map((w) => [...w] as [string, string]); });
    setM({ ...m, working_hours: next });
    toast.success('Copied to Monday–Friday');
  }
  function toggleReminder(kind: string) {
    const cur = (m.reminder_kinds as string[]) || [];
    setM({ ...m, reminder_kinds: cur.includes(kind) ? cur.filter((k) => k !== kind) : [...cur, kind] });
  }

  async function save() {
    if (!m.slug?.trim() || !m.display_name?.trim()) { toast.error('Slug and display name are required'); return; }
    setSaving(true);
    const payload = {
      workspace_id: workspaceId, user_id: myMember?.user_id || userId,
      slug: m.slug!.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-'),
      display_name: m.display_name!.trim(), title: m.title || 'Consultation', bio: null,
      meeting_link: m.meeting_link || null, timezone: m.timezone || 'Asia/Kolkata',
      slot_minutes: Number(m.slot_minutes) || 30,
      slot_step_minutes: Math.max(5, Math.min(240, Number(m.slot_step_minutes) || 30)),
      // Deliberately NOT `|| 0` guarded with a fallback — 0 is the useful value
      // here (it is what makes back-to-back slots possible), so an empty field
      // must read as zero, not silently become 10 again.
      buffer_minutes: Math.max(0, Number(m.buffer_minutes) || 0),
      working_hours: m.working_hours, active: m.active !== false,
      min_notice_minutes: Math.max(0, Math.min(10080, Number(m.min_notice_minutes) ?? 60)),
      max_days_ahead: Math.max(1, Math.min(180, Number(m.max_days_ahead) || 30)),
      daily_meeting_cap: m.daily_meeting_cap ? Math.max(1, Math.min(50, Number(m.daily_meeting_cap))) : null,
      reminder_kinds: (m.reminder_kinds as string[]) || ['h24', 'h3', 'h1', 'm15', 'start'],
      paused_message: m.paused_message?.trim() || null,
      updated_at: new Date().toISOString(),
    };
    const q = myMember
      ? supabase.from('scheduler_members').update(payload).eq('id', myMember.id)
      : supabase.from('scheduler_members').insert(payload);
    const { error } = await q;
    setSaving(false);
    if (error) { toast.error(error.message.includes('unique') ? 'That slug is already taken' : error.message); return; }
    toast.success('Booking settings saved');
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex justify-end" onClick={onClose}>
      <div className="bg-surface w-full max-w-[460px] h-full overflow-y-auto p-5 animate-fadeIn" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[17px] font-bold text-ink">Booking settings</h2>
          <button onClick={onClose} className="p-1.5 rounded-md hover:bg-surface-2 text-muted"><X className="w-4 h-4" /></button>
        </div>

        <label className="block text-[12px] font-medium text-muted mb-1">Your booking link</label>
        <div className="flex items-center gap-2 mb-3">
          <span className="text-[12.5px] text-muted whitespace-nowrap">crm.migrizo.com/book/</span>
          <input value={m.slug || ''} onChange={(e) => setM({ ...m, slug: e.target.value })} placeholder="shailen"
            className="flex-1 px-3 py-2 border border-border rounded-lg text-[13px] focus:border-indigo outline-none" />
        </div>
        <label className="block text-[12px] font-medium text-muted mb-1">Display name</label>
        <input value={m.display_name || ''} onChange={(e) => setM({ ...m, display_name: e.target.value })} className="w-full px-3 py-2 border border-border rounded-lg text-[13px] mb-3 focus:border-indigo outline-none" />
        <label className="block text-[12px] font-medium text-muted mb-1">Meeting title</label>
        <input value={m.title || ''} onChange={(e) => setM({ ...m, title: e.target.value })} className="w-full px-3 py-2 border border-border rounded-lg text-[13px] mb-3 focus:border-indigo outline-none" />
        <label className="block text-[12px] font-medium text-muted mb-1">Your meeting link (Google Meet / Zoom)</label>
        <input value={m.meeting_link || ''} onChange={(e) => setM({ ...m, meeting_link: e.target.value })} placeholder="https://meet.google.com/xxx-xxxx-xxx"
          className="w-full px-3 py-2 border border-border rounded-lg text-[13px] mb-1 focus:border-indigo outline-none" />
        <p className="text-[11px] text-faint mb-3">Sent on every confirmation and reminder. (Auto-created Meet links arrive with the Google Calendar phase.)</p>

        {/* Grid spacing and call length are separate questions. Keeping them in
            one number was the bug: a 60-minute call quietly turned an
            every-30-minutes page into an hourly one. */}
        <div className="grid grid-cols-3 gap-2.5 mb-1">
          <div><label className="block text-[12px] font-medium text-muted mb-1">Slot every (min)</label>
            <select value={m.slot_step_minutes ?? 30} onChange={(e) => setM({ ...m, slot_step_minutes: Number(e.target.value) })}
              className="w-full px-3 py-2 border border-border rounded-lg text-[13px] focus:border-indigo outline-none bg-surface">
              {[15, 20, 30, 45, 60].map((v) => <option key={v} value={v}>{v} min</option>)}
            </select></div>
          <div><label className="block text-[12px] font-medium text-muted mb-1">Call length (min)</label>
            <input type="number" value={m.slot_minutes || 30} onChange={(e) => setM({ ...m, slot_minutes: Number(e.target.value) })} className="w-full px-3 py-2 border border-border rounded-lg text-[13px] focus:border-indigo outline-none" /></div>
          <div><label className="block text-[12px] font-medium text-muted mb-1">Gap after (min)</label>
            <input type="number" min={0} value={m.buffer_minutes ?? 0} onChange={(e) => setM({ ...m, buffer_minutes: Number(e.target.value) })} className="w-full px-3 py-2 border border-border rounded-lg text-[13px] focus:border-indigo outline-none" /></div>
        </div>
        <p className="text-[11px] text-faint mb-3 leading-[1.5]">
          <b className="text-ink-2">Slot every 30 · call 30 · gap 0</b> offers 10:00, 10:30, 11:00 — and booking 2:00pm still leaves 2:30pm open.
          Any gap above 0 is enforced on <i>both</i> sides of a booking, so it removes the neighbouring slot.
        </p>
        <label className="block text-[12px] font-medium text-muted mb-1">Timezone</label>
        <input value={m.timezone || ''} onChange={(e) => setM({ ...m, timezone: e.target.value })} className="w-full px-3 py-2 border border-border rounded-lg text-[13px] mb-4 focus:border-indigo outline-none" />

        {/* ── Booking rules ──────────────────────────────────────────────
            Three things that used to be constants in the code. Nobody should
            need a deploy to say "no bookings inside two hours". */}
        <div className="text-[11px] font-bold uppercase tracking-wide text-muted mb-2">Booking rules</div>
        <div className="grid grid-cols-3 gap-2.5 mb-1">
          <div>
            <label className="block text-[12px] font-medium text-muted mb-1">Notice needed</label>
            <select value={m.min_notice_minutes ?? 60} onChange={(e) => setM({ ...m, min_notice_minutes: Number(e.target.value) })}
              className="w-full px-3 py-2 border border-border rounded-lg text-[13px] focus:border-indigo outline-none bg-surface">
              {[0, 30, 60, 120, 240, 720, 1440, 2880].map((v) => (
                <option key={v} value={v}>
                  {v === 0 ? 'None' : v < 60 ? `${v} min` : v < 1440 ? `${v / 60} hour${v === 60 ? '' : 's'}` : `${v / 1440} day${v === 1440 ? '' : 's'}`}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[12px] font-medium text-muted mb-1">Book up to</label>
            <select value={m.max_days_ahead ?? 30} onChange={(e) => setM({ ...m, max_days_ahead: Number(e.target.value) })}
              className="w-full px-3 py-2 border border-border rounded-lg text-[13px] focus:border-indigo outline-none bg-surface">
              {[7, 14, 21, 30, 45, 60, 90].map((v) => <option key={v} value={v}>{v} days ahead</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[12px] font-medium text-muted mb-1">Max calls / day</label>
            <input type="number" min={1} max={50} placeholder="No limit"
              value={m.daily_meeting_cap ?? ''}
              onChange={(e) => setM({ ...m, daily_meeting_cap: e.target.value ? Number(e.target.value) : null })}
              className="w-full px-3 py-2 border border-border rounded-lg text-[13px] focus:border-indigo outline-none" />
          </div>
        </div>
        <p className="text-[11px] text-faint mb-4 leading-[1.5]">
          Once the day&apos;s cap is reached it shows as fully booked, however much free time is left.
        </p>

        {/* ── Working hours: a LIST of windows per day ─────────────────── */}
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[11px] font-bold uppercase tracking-wide text-muted">Working hours</span>
          <span className="text-[11px] text-faint">Add a second window for a lunch break</span>
        </div>
        <div className="space-y-2.5 mb-5">
          {DAYS.map(({ key, label }) => {
            const list = wh[key] || [];
            const open = list.length > 0;
            return (
              <div key={key} className="flex items-start gap-2.5">
                <label className="flex w-[104px] flex-shrink-0 cursor-pointer items-center gap-2 pt-1.5">
                  <input type="checkbox" checked={open} onChange={(e) => setDay(key, e.target.checked)} className="accent-indigo w-4 h-4" />
                  <span className="text-[12.5px] text-ink">{label}</span>
                </label>
                {open ? (
                  <div className="flex flex-1 flex-col gap-1.5">
                    {list.map((range, i) => (
                      <div key={i} className="flex items-center gap-1.5">
                        <input type="time" value={range[0]} onChange={(e) => setRange(key, i, 0, e.target.value)}
                          className="px-2 py-1.5 border border-border rounded-md text-[12px]" />
                        <span className="text-muted text-[12px]">to</span>
                        <input type="time" value={range[1]} onChange={(e) => setRange(key, i, 1, e.target.value)}
                          className="px-2 py-1.5 border border-border rounded-md text-[12px]" />
                        {list.length > 1 && (
                          <button onClick={() => removeWindow(key, i)} title="Remove this window"
                            className="rounded-md p-1 text-muted transition hover:bg-surface-2 hover:text-danger">
                            <X className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    ))}
                    <div className="flex items-center gap-3">
                      <button onClick={() => addWindow(key)} className="text-[11.5px] font-medium text-indigo hover:underline">+ Add window</button>
                      <button onClick={() => copyToWeekdays(key)} className="text-[11.5px] text-muted hover:text-ink hover:underline">Copy to Mon–Fri</button>
                    </div>
                  </div>
                ) : <span className="pt-1.5 text-[12px] text-faint">Unavailable</span>}
              </div>
            );
          })}
        </div>

        {/* ── Reminders ────────────────────────────────────────────────── */}
        <div className="text-[11px] font-bold uppercase tracking-wide text-muted mb-2">Reminder emails</div>
        <div className="mb-1 flex flex-wrap gap-1.5">
          {([['h24', '24 hours before'], ['h3', '3 hours before'], ['h1', '1 hour before'], ['m15', '15 min before'], ['start', 'At start time']] as const).map(([k, lbl]) => {
            const on = ((m.reminder_kinds as string[]) || []).includes(k);
            return (
              <button key={k} onClick={() => toggleReminder(k)}
                className={cn('rounded-lg border px-2.5 py-1.5 text-[12px] font-medium transition',
                  on ? 'border-transparent bg-[#EEF2FF] text-[#3730A3]' : 'border-border text-muted hover:bg-surface-2')}>
                {lbl}
              </button>
            );
          })}
        </div>
        <p className="text-[11px] text-faint mb-5">The booking confirmation always sends. These are the nudges after it.</p>

        {/* ── Days off and one-off hours ───────────────────────────────── */}
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[11px] font-bold uppercase tracking-wide text-muted">Days off &amp; one-off hours</span>
          <span className="text-[11px] text-faint">Beats the weekly pattern</span>
        </div>

        <div className="mb-2 rounded-xl border border-border p-3">
          <div className="mb-2 grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-[11.5px] font-medium text-muted">Date</label>
              <input type="date" value={ovDate} onChange={(e) => setOvDate(e.target.value)}
                min={new Date().toISOString().slice(0, 10)}
                className="w-full rounded-lg border border-border px-2.5 py-1.5 text-[12.5px] outline-none focus:border-indigo" />
            </div>
            <div>
              <label className="mb-1 block text-[11.5px] font-medium text-muted">Note (optional)</label>
              <input value={ovNote} onChange={(e) => setOvNote(e.target.value)} placeholder="Diwali"
                className="w-full rounded-lg border border-border px-2.5 py-1.5 text-[12.5px] outline-none focus:border-indigo" />
            </div>
          </div>
          <div className="mb-2 flex items-center gap-1.5">
            <span className="w-[104px] text-[11.5px] text-muted">Hours that day</span>
            <input type="time" value={ovFrom} onChange={(e) => setOvFrom(e.target.value)}
              className="rounded-md border border-border px-2 py-1.5 text-[12px]" />
            <span className="text-[12px] text-muted">to</span>
            <input type="time" value={ovTo} onChange={(e) => setOvTo(e.target.value)}
              className="rounded-md border border-border px-2 py-1.5 text-[12px]" />
          </div>
          <div className="flex items-center justify-between gap-2">
            <p className="m-0 text-[11px] leading-[1.5] text-faint">
              Leave both times empty to block the whole day.
            </p>
            <button onClick={() => void addOverride()} className="btn btn-outline btn-sm flex-shrink-0">Add</button>
          </div>
        </div>

        {overrides.length > 0 && (
          <div className="panel mb-5 divide-y divide-border">
            {overrides.map((o) => {
              const blocked = !o.windows || o.windows.length === 0;
              return (
                <div key={o.id} className="flex items-center justify-between gap-2 px-3 py-2">
                  <div className="min-w-0">
                    <div className="text-[12.5px] font-medium text-ink">
                      {new Date(o.on_date + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}
                      {o.note ? <span className="font-normal text-muted"> · {o.note}</span> : null}
                    </div>
                    <div className="text-[11.5px]" style={{ color: blocked ? '#B45309' : '#047857' }}>
                      {blocked ? 'Fully blocked' : o.windows.map((w) => `${w[0]}–${w[1]}`).join(', ')}
                    </div>
                  </div>
                  <button onClick={() => void removeOverride(o.id)} title="Remove"
                    className="rounded-md p-1.5 text-muted transition hover:bg-surface-2 hover:text-danger">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
        {overrides.length === 0 && (
          <p className="mb-5 text-[11.5px] text-faint">No exceptions coming up. Your weekly hours apply every day.</p>
        )}

        <label className="flex items-center gap-2 mb-2 cursor-pointer">
          <input type="checkbox" checked={m.active !== false} onChange={(e) => setM({ ...m, active: e.target.checked })} className="accent-indigo w-4 h-4" />
          <span className="text-[13px] text-ink">Booking page is live</span>
        </label>
        {m.active === false && (
          <input value={m.paused_message || ''} onChange={(e) => setM({ ...m, paused_message: e.target.value })}
            placeholder="Away until 12 Sept — email info@migrizo.com and we'll sort a time"
            className="mb-2 w-full rounded-lg border border-border px-3 py-2 text-[13px] outline-none focus:border-indigo" />
        )}
        <p className="text-[11px] text-faint mb-5">
          {m.active === false
            ? 'Visitors see this message instead of a 404. Leave it blank for the default.'
            : 'Turn this off to pause bookings without deleting your link.'}
        </p>

        <button onClick={save} disabled={saving} className="btn btn-primary w-full justify-center py-2.5">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Save settings
        </button>

        {isAdmin && members.length > 0 && (
          <>
            <div className="text-[11px] font-bold uppercase tracking-wide text-muted mt-6 mb-2">Team booking pages</div>
            <div className="panel divide-y divide-border">
              {members.map((tm) => (
                <div key={tm.id} className="px-3.5 py-2.5 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[12.5px] font-semibold text-ink truncate">{tm.display_name}</div>
                    <div className="text-[11px] text-muted truncate">/book/{tm.slug} · {tm.active ? 'live' : 'off'}</div>
                  </div>
                  <button onClick={() => { navigator.clipboard.writeText(`https://crm.migrizo.com/book/${tm.slug}`); toast.success('Copied'); }} className="p-1.5 rounded-md hover:bg-surface-2 text-muted" title="Copy link"><Copy className="w-3.5 h-3.5" /></button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
