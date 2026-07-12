'use client';

// =============================================================================
// MEETINGS — the CRM side of the Scheduling module.
// Upcoming list · Day/Week/Month calendar · status management · notes ·
// reminder history + email delivery status · booking-page settings.
// =============================================================================
import { useState, useEffect, useMemo, useCallback } from 'react';
import { useApp } from '@/components/shared/app-provider';
import { createClient } from '@/lib/supabase/client';
import { CalendarDays, List as ListIcon, Settings2, Copy, X, Clock, CheckCircle2, Ban, UserX, Loader2, Link as LinkIcon, BellRing } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface Meeting {
  id: string; member_id: string; lead_id: string | null;
  client_name: string; client_email: string; client_phone: string | null;
  starts_at: string; ends_at: string; status: string; notes: string | null;
  meet_link: string | null; manage_token: string; created_at: string;
}
interface Member { id: string; user_id: string; slug: string; display_name: string; title: string; meeting_link: string | null; timezone: string; slot_minutes: number; buffer_minutes: number; working_hours: Record<string, [string, string][]>; active: boolean; }
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
  const [view, setView] = useState<'list' | 'day' | 'week' | 'month'>('list');
  const [anchor, setAnchor] = useState(() => new Date());
  const [selected, setSelected] = useState<Meeting | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: ms }, { data: mem }] = await Promise.all([
      supabase.from('meetings').select('*').eq('workspace_id', workspace.id).order('starts_at', { ascending: true }).limit(500),
      supabase.from('scheduler_members').select('*').eq('workspace_id', workspace.id),
    ]);
    setMeetings((ms as Meeting[]) || []);
    setMembers((mem as Member[]) || []);
    setLoading(false);
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
  const past = meetings.filter((m) => !(m.status === 'upcoming' && new Date(m.starts_at) >= new Date(Date.now() - 30 * 60000))).slice().reverse();

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

      {loading ? <div className="panel panel-pad text-center py-16 text-muted text-[13px]">Loading meetings…</div> : view === 'list' ? (
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
          {past.length > 0 && <>
            <h2 className="text-[13px] font-bold text-muted uppercase tracking-wide mb-2">Past & other ({past.length})</h2>
            <div className="space-y-2.5">{past.slice(0, 40).map((m) => <MeetingRow key={m.id} m={m} member={memberById.get(m.member_id)} onOpen={() => setSelected(m)} fmtDay={fmtDay} fmtTime={fmtTime} />)}</div>
          </>}
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

      {selected && <MeetingDrawer m={selected} member={memberById.get(selected.member_id)} onClose={() => setSelected(null)} onStatus={(s) => void setStatus(selected, s)} workspaceId={workspace.id} onNotes={(notes) => { setMeetings((prev) => prev.map((x) => x.id === selected.id ? { ...x, notes } : x)); }} />}
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

function MeetingDrawer({ m, member, onClose, onStatus, workspaceId, onNotes }: {
  m: Meeting; member?: Member; onClose: () => void; onStatus: (s: string) => void; workspaceId: string; onNotes: (n: string) => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [notes, setNotes] = useState(m.notes || '');
  const [savingNotes, setSavingNotes] = useState(false);

  useEffect(() => {
    void supabase.from('meeting_reminders').select('*').eq('meeting_id', m.id).order('send_at').then(({ data }) => setReminders((data as Reminder[]) || []));
    void supabase.from('meeting_activity').select('*').eq('meeting_id', m.id).order('created_at', { ascending: false }).limit(30).then(({ data }) => setActivity((data as Activity[]) || []));
  }, [m.id, supabase]);

  async function saveNotes() {
    setSavingNotes(true);
    await supabase.from('meetings').update({ notes }).eq('id', m.id);
    await supabase.from('meeting_activity').insert({ meeting_id: m.id, workspace_id: workspaceId, event: 'note_added', meta: {} });
    onNotes(notes);
    setSavingNotes(false);
    toast.success('Notes saved');
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
        <button onClick={saveNotes} disabled={savingNotes} className="btn btn-outline btn-sm mb-5">{savingNotes ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null} Save notes</button>

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
    slot_minutes: 30, buffer_minutes: 10, active: true,
    working_hours: { mon: [['10:00', '18:00']], tue: [['10:00', '18:00']], wed: [['10:00', '18:00']], thu: [['10:00', '18:00']], fri: [['10:00', '18:00']], sat: [], sun: [] },
  });
  const [saving, setSaving] = useState(false);
  const wh = (m.working_hours || {}) as Record<string, [string, string][]>;

  function setDay(key: string, open: boolean, from = '10:00', to = '18:00') {
    setM({ ...m, working_hours: { ...wh, [key]: open ? [[from, to]] : [] } });
  }
  function setRange(key: string, idx: 0 | 1, val: string) {
    const cur = wh[key]?.[0] || ['10:00', '18:00'];
    const next: [string, string] = idx === 0 ? [val, cur[1]] : [cur[0], val];
    setM({ ...m, working_hours: { ...wh, [key]: [next] } });
  }

  async function save() {
    if (!m.slug?.trim() || !m.display_name?.trim()) { toast.error('Slug and display name are required'); return; }
    setSaving(true);
    const payload = {
      workspace_id: workspaceId, user_id: myMember?.user_id || userId,
      slug: m.slug!.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-'),
      display_name: m.display_name!.trim(), title: m.title || 'Consultation', bio: null,
      meeting_link: m.meeting_link || null, timezone: m.timezone || 'Asia/Kolkata',
      slot_minutes: Number(m.slot_minutes) || 30, buffer_minutes: Number(m.buffer_minutes) || 10,
      working_hours: m.working_hours, active: m.active !== false, updated_at: new Date().toISOString(),
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

        <div className="grid grid-cols-3 gap-2.5 mb-4">
          <div><label className="block text-[12px] font-medium text-muted mb-1">Duration (min)</label>
            <input type="number" value={m.slot_minutes || 30} onChange={(e) => setM({ ...m, slot_minutes: Number(e.target.value) })} className="w-full px-3 py-2 border border-border rounded-lg text-[13px] focus:border-indigo outline-none" /></div>
          <div><label className="block text-[12px] font-medium text-muted mb-1">Buffer (min)</label>
            <input type="number" value={m.buffer_minutes ?? 10} onChange={(e) => setM({ ...m, buffer_minutes: Number(e.target.value) })} className="w-full px-3 py-2 border border-border rounded-lg text-[13px] focus:border-indigo outline-none" /></div>
          <div><label className="block text-[12px] font-medium text-muted mb-1">Timezone</label>
            <input value={m.timezone || ''} onChange={(e) => setM({ ...m, timezone: e.target.value })} className="w-full px-3 py-2 border border-border rounded-lg text-[13px] focus:border-indigo outline-none" /></div>
        </div>

        <div className="text-[11px] font-bold uppercase tracking-wide text-muted mb-2">Working hours</div>
        <div className="space-y-2 mb-5">
          {DAYS.map(({ key, label }) => {
            const open = (wh[key] || []).length > 0;
            const range = wh[key]?.[0] || ['10:00', '18:00'];
            return (
              <div key={key} className="flex items-center gap-2.5">
                <label className="flex items-center gap-2 w-[110px] cursor-pointer">
                  <input type="checkbox" checked={open} onChange={(e) => setDay(key, e.target.checked)} className="accent-indigo w-4 h-4" />
                  <span className="text-[12.5px] text-ink">{label}</span>
                </label>
                {open ? (
                  <div className="flex items-center gap-1.5">
                    <input type="time" value={range[0]} onChange={(e) => setRange(key, 0, e.target.value)} className="px-2 py-1.5 border border-border rounded-md text-[12px]" />
                    <span className="text-muted text-[12px]">to</span>
                    <input type="time" value={range[1]} onChange={(e) => setRange(key, 1, e.target.value)} className="px-2 py-1.5 border border-border rounded-md text-[12px]" />
                  </div>
                ) : <span className="text-[12px] text-faint">Unavailable</span>}
              </div>
            );
          })}
        </div>

        <label className="flex items-center gap-2 mb-5 cursor-pointer">
          <input type="checkbox" checked={m.active !== false} onChange={(e) => setM({ ...m, active: e.target.checked })} className="accent-indigo w-4 h-4" />
          <span className="text-[13px] text-ink">Booking page is live</span>
        </label>

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
