'use client';

// =============================================================================
// TASKS & GOALS
//
// A spreadsheet, not an app. Type a task, press Enter, it is saved. That is
// the whole interaction.
//
// Four periods, one table. A task belongs to exactly one of them:
//   Daily    keyed on the date          2026-08-06
//   Weekly   keyed on the Monday        2026-08-03
//   Monthly  keyed on the month         2026-08
//   Yearly   keyed on the year          2026      ← COMPANY goals
//
// Yearly rows are the company's goals: the super admin sets them, everyone
// else sees them read-only on their own screen. Everything else is private to
// its owner, except that the super admin sees and edits everyone's.
//
// All of this is enforced by RLS in migration 039 as well as here, so the UI
// can never promise access the database will refuse.
// =============================================================================

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useApp } from '@/components/shared/app-provider';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { Loader2, Check, X, ChevronLeft, ChevronRight, Lock, Users } from 'lucide-react';

type Scope = 'daily' | 'weekly' | 'monthly' | 'yearly';
type Status = 'todo' | 'doing' | 'blocked' | 'done';

interface Row {
  id: string; user_id: string; scope: Scope; period_key: string;
  title: string; status: Status; done: boolean;
}
interface Member { user_id: string; full_name: string; status?: string }

// ── palette: one tint per person, three for status ──────────────────────────
const TINTS = [
  { bg: '#EFF6FF', br: '#BFDBFE', fg: '#1D4ED8', solid: '#2563EB' },
  { bg: '#ECFEFF', br: '#A5F3FC', fg: '#0E7490', solid: '#0891B2' },
  { bg: '#FFFBEB', br: '#FDE68A', fg: '#B45309', solid: '#D97706' },
  { bg: '#F5F3FF', br: '#DDD6FE', fg: '#6D28D9', solid: '#7C3AED' },
  { bg: '#ECFDF5', br: '#A7F3D0', fg: '#047857', solid: '#059669' },
  { bg: '#FEF2F2', br: '#FECACA', fg: '#B91C1C', solid: '#DC2626' },
];
const tintOf = (id: string) => TINTS[Math.abs([...id].reduce((a, c) => a + c.charCodeAt(0), 0)) % TINTS.length];

const STATUS: Record<Status, { label: string; bg: string; fg: string }> = {
  todo:    { label: 'To do',       bg: '#F1F1F3', fg: '#71717A' },
  doing:   { label: 'In progress', bg: '#EFF6FF', fg: '#2563EB' },
  blocked: { label: 'Blocked',     bg: '#FEF2F2', fg: '#DC2626' },
  done:    { label: 'Done',        bg: '#ECFDF5', fg: '#059669' },
};

// ── dates ───────────────────────────────────────────────────────────────────
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const mondayOf = (d: Date) => addDays(new Date(d), -((new Date(d).getDay() + 6) % 7));
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MONL = ['January','February','March','April','May','June','July','August','September','October','November','December'];
function weekNo(d: Date) {
  const t = new Date(d); t.setHours(0, 0, 0, 0);
  t.setDate(t.getDate() + 3 - ((t.getDay() + 6) % 7));
  const w1 = new Date(t.getFullYear(), 0, 4);
  return 1 + Math.round(((t.getTime() - w1.getTime()) / 86400000 - 3 + ((w1.getDay() + 6) % 7)) / 7);
}

const initials = (n: string) => n.split(' ').filter(Boolean).map((x) => x[0]).join('').slice(0, 2).toUpperCase();

function Avatar({ name, id, size = 22 }: { name: string; id: string; size?: number }) {
  return (
    <span className="rounded-full flex items-center justify-center text-white font-semibold flex-shrink-0"
      style={{ width: size, height: size, background: tintOf(id).solid, fontSize: size * 0.42 }}>
      {initials(name)}
    </span>
  );
}

export function TasksView() {
  const app = useApp() as unknown as {
    workspace: { id: string };
    user: { id: string; name: string };
    members: Member[];
  };
  const { workspace, user, members } = app;
  const supabase = useMemo(() => createClient(), []);

  const [isSuper, setIsSuper] = useState(false);
  const [checkedRole, setCheckedRole] = useState(false);
  useEffect(() => {
    let off = false;
    (async () => {
      const { data, error } = await supabase.rpc('is_goal_super_admin');
      if (!off) { if (!error) setIsSuper(data === true); setCheckedRole(true); }
    })();
    return () => { off = true; };
  }, [supabase]);

  const [scope, setScope] = useState<Scope | 'review'>('daily');
  const [curDay, setCurDay] = useState(() => new Date());
  const [curWeek, setCurWeek] = useState(() => mondayOf(new Date()));
  const [curMonth, setCurMonth] = useState(() => new Date().getMonth());
  const [curYear, setCurYear] = useState(() => new Date().getFullYear());

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [fWho, setFWho] = useState<string>('all');
  const [grouped, setGrouped] = useState(true);
  const [newOwner, setNewOwner] = useState(user.id);
  const [draft, setDraft] = useState('');
  const [menu, setMenu] = useState<null | { kind: 'owner' | 'status' | 'newowner'; id?: string; x: number; y: number }>(null);
  const newRef = useRef<HTMLInputElement>(null);

  const people = useMemo(() => (members || []).filter((m) => m.status !== 'paused'), [members]);
  const nameOf = useCallback((uid: string) =>
    people.find((p) => p.user_id === uid)?.full_name || (uid === user.id ? user.name : 'Unknown'),
    [people, user.id, user.name]);

  const todayStr = ymd(new Date());
  const periodKey = useMemo(() => {
    if (scope === 'daily') return ymd(curDay);
    if (scope === 'weekly') return ymd(curWeek);
    if (scope === 'monthly') return `${curYear}-${String(curMonth + 1).padStart(2, '0')}`;
    return String(curYear);
  }, [scope, curDay, curWeek, curMonth, curYear]);

  // ── load ──────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    // The review tab needs every scope; a period tab needs only its own rows,
    // plus the current week's daily rows so the day chips can show counts.
    let q = supabase.from('task_board').select('*').eq('workspace_id', workspace.id);
    if (scope === 'review') {
      // everything
    } else if (scope === 'daily') {
      const from = ymd(mondayOf(curDay)), to = ymd(addDays(mondayOf(curDay), 5));
      q = q.eq('scope', 'daily').gte('period_key', from).lte('period_key', to);
    } else {
      q = q.eq('scope', scope).eq('period_key', periodKey);
    }
    const { data, error } = await q.order('sort_order').order('created_at');
    if (error) toast.error(`Could not load: ${error.message}`);
    setRows((data as Row[]) || []);
    setLoading(false);
  }, [supabase, workspace.id, scope, periodKey, curDay]);

  useEffect(() => { if (checkedRole) void load(); }, [load, checkedRole]);
  useEffect(() => { setFWho('all'); }, [scope]);
  useEffect(() => { setNewOwner(user.id); }, [user.id]);

  // Close the popup on any outside click or Escape.
  useEffect(() => {
    if (!menu) return;
    const c = () => setMenu(null);
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(null); };
    document.addEventListener('click', c);
    document.addEventListener('keydown', k);
    return () => { document.removeEventListener('click', c); document.removeEventListener('keydown', k); };
  }, [menu]);

  // ── visible rows for the current tab ──────────────────────────────────────
  const visible = useMemo(() => {
    let r = rows.filter((t) => t.scope === scope && t.period_key === periodKey);
    if (isSuper && fWho !== 'all' && scope !== 'yearly') r = r.filter((t) => t.user_id === fWho);
    return r;
  }, [rows, scope, periodKey, isSuper, fWho]);

  // Yearly is company-wide and only the super admin may change it.
  const readOnly = scope === 'yearly' && !isSuper;

  // ── actions ───────────────────────────────────────────────────────────────
  const add = async (title: string) => {
    const clean = title.trim();
    if (!clean) return;
    const owner = isSuper ? newOwner : user.id;
    const optimistic: Row = {
      id: `tmp-${Date.now()}`, user_id: owner, scope: scope as Scope,
      period_key: periodKey, title: clean, status: 'todo', done: false,
    };
    setRows((p) => [...p, optimistic]);
    setDraft('');
    const { data, error } = await supabase.from('task_board').insert({
      workspace_id: workspace.id, user_id: owner, scope, period_key: periodKey,
      title: clean, status: 'todo', created_by: user.id,
    }).select().single();
    if (error) {
      setRows((p) => p.filter((x) => x.id !== optimistic.id));
      toast.error(`Could not add: ${error.message}`);
      return;
    }
    setRows((p) => p.map((x) => (x.id === optimistic.id ? (data as Row) : x)));
  };

  const patch = async (id: string, changes: Partial<Row>) => {
    const before = rows.find((x) => x.id === id);
    setRows((p) => p.map((x) => (x.id === id ? { ...x, ...changes } : x)));
    const { error } = await supabase.from('task_board').update(changes).eq('id', id);
    if (error) {
      if (before) setRows((p) => p.map((x) => (x.id === id ? before : x)));
      toast.error(error.message.includes('policy') ? 'You cannot change this one' : 'Could not save');
    }
  };

  const remove = async (id: string) => {
    const before = rows;
    setRows((p) => p.filter((x) => x.id !== id));
    const { error } = await supabase.from('task_board').delete().eq('id', id);
    if (error) { setRows(before); toast.error('Could not delete'); }
  };

  // ── period navigation ─────────────────────────────────────────────────────
  const shift = (dir: number) => {
    if (scope === 'daily') setCurDay((d) => addDays(d, dir * 7));
    else if (scope === 'weekly') setCurWeek((w) => addDays(w, dir * 7));
    else if (scope === 'monthly') {
      // Compute both values first. Calling setCurYear inside the setCurMonth
      // updater would be a side effect in a reducer, and React can invoke
      // updaters twice in development — which would shift the year twice.
      const n = curMonth + dir;
      if (n > 11) { setCurMonth(0); setCurYear(curYear + 1); }
      else if (n < 0) { setCurMonth(11); setCurYear(curYear - 1); }
      else setCurMonth(n);
    } else setCurYear((y) => y + dir);
  };

  const TABS: { k: Scope | 'review'; label: string }[] = [
    { k: 'daily', label: 'Daily' }, { k: 'weekly', label: 'Weekly' },
    { k: 'monthly', label: 'Monthly' }, { k: 'yearly', label: 'Yearly' },
    { k: 'review', label: 'Review' },
  ];

  const doneCount = visible.filter((t) => t.done).length;

  return (
    <div>
      {/* ── header ── */}
      <div className="flex items-start gap-3 flex-wrap mb-1">
        <div>
          <h1 className="text-[19px] font-semibold tracking-tight">Tasks &amp; Goals</h1>
          <div className="text-[12.5px] text-muted mt-0.5">
            {scope === 'review' ? 'Where everyone stands right now'
              : visible.length ? `${visible.length} task${visible.length === 1 ? '' : 's'} · ${doneCount} done`
              : readOnly ? 'The company goals for this year have not been set yet.'
              : 'Type a task, press Enter. That is it.'}
          </div>
        </div>
        {isSuper && (
          <span className="ml-auto inline-flex items-center gap-1.5 text-[11.5px] text-faint">
            <Users className="w-3.5 h-3.5" /> You see everyone
          </span>
        )}
      </div>

      {/* ── tabs ── */}
      <div className="flex gap-0.5 border-b border-border mb-0">
        {TABS.map(({ k, label }) => (
          <button key={k} onClick={() => setScope(k)}
            className={cn('text-[13px] font-medium px-3.5 py-2.5 -mb-px border-b-2 transition-colors',
              scope === k ? 'text-[#2563EB] border-[#2563EB] font-semibold' : 'text-muted border-transparent hover:text-ink')}>
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-[13px] text-muted">
          <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…
        </div>
      ) : scope === 'review' ? (
        <Review rows={rows} people={people} isSuper={isSuper} me={user.id} nameOf={nameOf} />
      ) : (
        <>
          {/* ── period strip ── */}
          <div className="flex items-center gap-2 flex-wrap py-3">
            <button onClick={() => shift(-1)} className="w-7 h-7 rounded-lg border border-border bg-surface flex items-center justify-center text-muted hover:bg-surface-2">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="min-w-[132px]">
              <div className="text-[14px] font-semibold leading-tight">
                {scope === 'daily' ? `${MONL[curDay.getMonth()]} ${curDay.getFullYear()}`
                  : scope === 'weekly' ? `Week ${weekNo(curWeek)}`
                  : scope === 'monthly' ? `${MONL[curMonth]} ${curYear}` : String(curYear)}
              </div>
              <div className="text-[11.5px] text-faint">
                {scope === 'daily' ? `Week ${weekNo(curDay)}`
                  : scope === 'weekly' ? `${curWeek.getDate()} ${MON[curWeek.getMonth()]} – ${addDays(curWeek, 5).getDate()} ${MON[addDays(curWeek, 5).getMonth()]}`
                  : scope === 'monthly' ? `${new Date(curYear, curMonth + 1, 0).getDate()} days`
                  : 'Company goals'}
              </div>
            </div>
            <button onClick={() => shift(1)} className="w-7 h-7 rounded-lg border border-border bg-surface flex items-center justify-center text-muted hover:bg-surface-2">
              <ChevronRight className="w-4 h-4" />
            </button>

            {(scope === 'daily' || scope === 'weekly') && (
              <div className="flex gap-1.5 ml-1.5 flex-wrap">
                {Array.from({ length: 6 }, (_, i) => addDays(scope === 'daily' ? mondayOf(curDay) : curWeek, i)).map((d) => {
                  const k = ymd(d);
                  const on = scope === 'daily' && k === ymd(curDay);
                  const isToday = k === todayStr;
                  const n = rows.filter((t) => t.scope === 'daily' && t.period_key === k).length;
                  const Tag = scope === 'daily' ? 'button' : 'div';
                  return (
                    <Tag key={k} {...(scope === 'daily' ? { onClick: () => setCurDay(new Date(d)) } : {})}
                      className={cn('min-w-[62px] px-2 py-1.5 rounded-lg border text-center transition-colors',
                        on ? 'bg-[#2563EB] border-[#2563EB] text-white'
                          : isToday ? 'border-[#2563EB] border-[1.5px] bg-surface' : 'border-border bg-surface',
                        scope === 'daily' && !on && 'hover:bg-surface-2 cursor-pointer')}>
                      <div className={cn('text-[10px] font-bold uppercase tracking-wide', on ? 'text-white/80' : 'text-faint')}>
                        {DOW[(d.getDay() + 6) % 7]}
                      </div>
                      <div className="text-[14px] font-semibold leading-tight">{d.getDate()}</div>
                      <div className={cn('text-[9px] mt-px', on ? 'text-white/85' : isToday ? 'text-[#2563EB] font-bold uppercase tracking-wide' : 'text-faint')}>
                        {isToday ? 'Today' : scope === 'daily' ? (n ? `${n} task${n === 1 ? '' : 's'}` : '—') : '\u00A0'}
                      </div>
                    </Tag>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── yearly notice ── */}
          {scope === 'yearly' && (
            <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg mb-2.5 text-[12.5px]"
              style={{ background: '#F5F3FF', border: '1px solid #DDD6FE', color: '#5B21B6' }}>
              <Lock className="w-3.5 h-3.5 flex-shrink-0" />
              {isSuper
                ? 'Company goals. You set these — everyone sees them on their own screen but cannot change them.'
                : 'Company goals, set for the whole team. Read only.'}
            </div>
          )}

          {/* ── people filter ── */}
          {isSuper && scope !== 'yearly' && (
            <div className="flex items-center gap-1.5 flex-wrap pb-2.5">
              {[{ user_id: 'all', full_name: 'Everyone' }, ...people].map((p) => {
                const on = fWho === p.user_id;
                const t = p.user_id === 'all' ? { bg: '#18181B', br: '#18181B', fg: '#fff' } : tintOf(p.user_id);
                const n = p.user_id === 'all'
                  ? rows.filter((x) => x.scope === scope && x.period_key === periodKey).length
                  : rows.filter((x) => x.scope === scope && x.period_key === periodKey && x.user_id === p.user_id).length;
                return (
                  <button key={p.user_id} onClick={() => setFWho(p.user_id)}
                    className={cn('inline-flex items-center gap-1.5 rounded-full text-[12.5px] border transition-colors',
                      p.user_id === 'all' ? 'px-3 py-1.5' : 'pl-1.5 pr-3 py-1.5',
                      on ? 'font-semibold' : 'bg-surface border-border text-ink-2 hover:bg-surface-2')}
                    style={on ? { background: t.bg, borderColor: t.br, color: t.fg } : {}}>
                    {p.user_id !== 'all' && <Avatar name={p.full_name} id={p.user_id} size={20} />}
                    {p.user_id === 'all' ? 'Everyone' : p.full_name.split(' ')[0]}
                    <span className="text-[11px] opacity-70">{n}</span>
                  </button>
                );
              })}
              <button onClick={() => setGrouped((v) => !v)}
                className={cn('ml-auto text-[12.5px] px-3 py-1.5 rounded-lg border transition-colors',
                  grouped ? 'bg-[#EFF6FF] border-[#BFDBFE] text-[#2563EB] font-semibold' : 'bg-surface border-border text-ink-2 hover:bg-surface-2')}>
                Group by person
              </button>
            </div>
          )}

          {/* ── the sheet ── */}
          <div className="rounded-lg border border-border bg-surface overflow-x-auto">
            <table className="w-full border-collapse min-w-[720px]">
              <thead>
                <tr>
                  <th className="w-[44px] bg-surface-2 border-b border-border" />
                  <th className="text-left text-[11.5px] font-semibold text-muted px-3 py-2 bg-surface-2 border-b border-r border-border-2">Task</th>
                  <th className="text-left text-[11.5px] font-semibold text-muted px-3 py-2 bg-surface-2 border-b border-r border-border-2 w-[180px]">Owner</th>
                  <th className="text-left text-[11.5px] font-semibold text-muted px-3 py-2 bg-surface-2 border-b border-border w-[150px]">Status</th>
                  <th className="w-[44px] bg-surface-2 border-b border-border" />
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const render = (t: Row) => (
                    <TaskRow key={t.id} t={t} readOnly={readOnly} nameOf={nameOf}
                      onToggle={() => patch(t.id, { done: !t.done })}
                      onRename={(v) => patch(t.id, { title: v })}
                      onDelete={() => remove(t.id)}
                      onMenu={(kind, e) => {
                        e.stopPropagation();
                        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                        setMenu({ kind, id: t.id, x: r.left, y: r.bottom + 4 });
                      }} />
                  );
                  if (isSuper && grouped && fWho === 'all' && scope !== 'yearly') {
                    return people.flatMap((p) => {
                      const mine = visible.filter((t) => t.user_id === p.user_id);
                      if (!mine.length) return [];
                      const t = tintOf(p.user_id);
                      return [
                        <tr key={`g-${p.user_id}`}>
                          <td colSpan={5} className="px-3 py-1.5 text-[11.5px] font-semibold border-y border-border"
                            style={{ background: t.bg, color: t.fg }}>
                            {p.full_name}
                            <span className="font-normal opacity-70 ml-2">
                              {mine.filter((x) => x.done).length}/{mine.length} done
                            </span>
                          </td>
                        </tr>,
                        ...mine.map(render),
                      ];
                    });
                  }
                  return visible.map(render);
                })()}

                {!readOnly && (
                  <tr>
                    <td className="border-b border-border-2" />
                    <td className="border-b border-r border-border-2 p-0">
                      <input ref={newRef} value={draft} onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && draft.trim()) { void add(draft); }
                          if (e.key === 'Escape') setDraft('');
                        }}
                        placeholder={`+ Add a task for this ${scope === 'yearly' ? 'year' : scope.replace('ly', '')}, press Enter`}
                        className="w-full h-10 px-3 text-[13px] bg-transparent outline-none placeholder:text-[#2563EB] placeholder:opacity-60" />
                    </td>
                    <td colSpan={3} className="border-b border-border-2 p-0">
                      {isSuper ? (
                        <button onClick={(e) => {
                          e.stopPropagation();
                          const r = e.currentTarget.getBoundingClientRect();
                          setMenu({ kind: 'newowner', x: r.left, y: r.bottom + 4 });
                        }}
                          className="inline-flex items-center gap-1.5 h-10 px-3 text-[12.5px] text-muted hover:bg-surface-2 w-full">
                          <Avatar name={nameOf(newOwner)} id={newOwner} size={20} />
                          for {nameOf(newOwner).split(' ')[0]}
                        </button>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 h-10 px-3 text-[12.5px] text-faint">
                          <Avatar name={user.name} id={user.id} size={20} /> for you
                        </span>
                      )}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="text-[11.5px] text-faint py-2.5">
            {readOnly
              ? 'Only the admin can change the company goals.'
              : 'Enter adds the task · click a task to rename it · click Owner or Status to change · hover a row to delete'}
          </div>
        </>
      )}

      {/* ── popup for owner / status ── */}
      {menu && (
        <div className="fixed z-[60] rounded-lg border border-border bg-surface shadow-xl p-1 min-w-[176px]"
          style={{ left: Math.min(menu.x, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 190), top: menu.y }}
          onClick={(e) => e.stopPropagation()}>
          {menu.kind === 'status'
            ? (Object.keys(STATUS) as Status[]).map((k) => (
              <button key={k} onClick={() => { void patch(menu.id!, { status: k, done: k === 'done' }); setMenu(null); }}
                className="w-full text-left px-2.5 py-1.5 rounded-md hover:bg-surface-2">
                <span className="text-[11.5px] font-semibold px-2 py-0.5 rounded"
                  style={{ background: STATUS[k].bg, color: STATUS[k].fg }}>{STATUS[k].label}</span>
              </button>
            ))
            : people.map((p) => (
              <button key={p.user_id}
                onClick={() => {
                  if (menu.kind === 'newowner') { setNewOwner(p.user_id); newRef.current?.focus(); }
                  else void patch(menu.id!, { user_id: p.user_id });
                  setMenu(null);
                }}
                className="w-full flex items-center gap-2 text-left px-2.5 py-1.5 rounded-md hover:bg-surface-2 text-[12.5px]">
                <Avatar name={p.full_name} id={p.user_id} size={20} /> {p.full_name}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}

// ── one row ─────────────────────────────────────────────────────────────────
function TaskRow({ t, readOnly, nameOf, onToggle, onRename, onDelete, onMenu }: {
  t: Row; readOnly: boolean; nameOf: (id: string) => string;
  onToggle: () => void; onRename: (v: string) => void; onDelete: () => void;
  onMenu: (kind: 'owner' | 'status', e: React.MouseEvent) => void;
}) {
  const [val, setVal] = useState(t.title);
  useEffect(() => { setVal(t.title); }, [t.title]);
  const st = STATUS[t.status];

  return (
    <tr className="group hover:bg-[#FCFCFD]">
      <td className="border-b border-border-2 text-center">
        {!readOnly && (
          <button onClick={onToggle}
            className={cn('w-4 h-4 rounded border-[1.5px] flex items-center justify-center mx-auto transition-colors',
              t.done ? 'bg-[#059669] border-[#059669]' : 'border-[#D4D4D8] bg-surface hover:border-[#2563EB]')}>
            {t.done && <Check className="w-2.5 h-2.5 text-white" strokeWidth={4} />}
          </button>
        )}
      </td>
      <td className="border-b border-r border-border-2 p-0">
        <input value={val} readOnly={readOnly}
          onChange={(e) => setVal(e.target.value)}
          onBlur={() => { const v = val.trim(); if (!v) { setVal(t.title); return; } if (v !== t.title) onRename(v); }}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setVal(t.title); }}
          className={cn('w-full h-10 px-3 text-[13px] bg-transparent outline-none focus:bg-[#EFF6FF]',
            t.done && 'line-through text-faint', readOnly && 'cursor-default')} />
      </td>
      <td className="border-b border-r border-border-2 p-0">
        {readOnly ? (
          <span className="inline-flex items-center gap-2 h-10 px-3 text-[12.5px] text-ink-2">
            <Avatar name={nameOf(t.user_id)} id={t.user_id} /> {nameOf(t.user_id)}
          </span>
        ) : (
          <button onClick={(e) => onMenu('owner', e)}
            className="inline-flex items-center gap-2 h-10 px-3 text-[12.5px] text-ink-2 w-full hover:bg-surface-2">
            <Avatar name={nameOf(t.user_id)} id={t.user_id} /> {nameOf(t.user_id)}
          </button>
        )}
      </td>
      <td className="border-b border-border-2 p-0">
        {readOnly ? (
          <span className="inline-flex items-center h-10 px-3">
            <span className="text-[11.5px] font-semibold px-2 py-0.5 rounded" style={{ background: st.bg, color: st.fg }}>{st.label}</span>
          </span>
        ) : (
          <button onClick={(e) => onMenu('status', e)} className="inline-flex items-center h-10 px-3 w-full hover:bg-surface-2">
            <span className="text-[11.5px] font-semibold px-2 py-0.5 rounded" style={{ background: st.bg, color: st.fg }}>{st.label}</span>
          </button>
        )}
      </td>
      <td className="border-b border-border-2 text-center">
        {!readOnly && (
          <button onClick={onDelete}
            className="opacity-0 group-hover:opacity-100 text-faint hover:text-danger transition-opacity p-1">
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </td>
    </tr>
  );
}

// ── review ──────────────────────────────────────────────────────────────────
function Review({ rows, people, isSuper, me, nameOf }: {
  rows: Row[]; people: Member[]; isSuper: boolean; me: string; nameOf: (id: string) => string;
}) {
  const work = rows.filter((t) => t.scope !== 'yearly');
  const done = work.filter((t) => t.done).length;
  const blocked = work.filter((t) => t.status === 'blocked').length;
  const thisWeek = rows.filter((t) => t.scope === 'weekly' && t.period_key === ymd(mondayOf(new Date())));
  const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);

  const CARDS: [string, string | number, string, keyof typeof CARD_TINT][] = [
    ['Open tasks', work.length - done, 'across every period', 'blue'],
    ['Completed', done, `${pct(done, work.length)}% of everything`, 'green'],
    ['Blocked', blocked, blocked ? 'waiting on something' : 'all clear', 'red'],
    ['This week', thisWeek.length, `${thisWeek.filter((t) => t.done).length} done`, 'violet'],
  ];

  const shown = isSuper ? people : people.filter((p) => p.user_id === me);

  return (
    <div className="pt-4">
      <div className="grid gap-3 mb-5" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))' }}>
        {CARDS.map(([label, value, sub, tone]) => {
          const t = CARD_TINT[tone];
          return (
            <div key={label} className="rounded-lg px-4 py-3.5 border"
              style={{ background: t.bg, borderColor: t.br, color: t.fg }}>
              <div className="text-[11.5px] font-semibold">{label}</div>
              <div className="text-[26px] font-bold mt-1 leading-none tracking-tight">{value}</div>
              <div className="text-[11.5px] mt-1 opacity-75">{sub}</div>
            </div>
          );
        })}
      </div>

      <div className="text-[11.5px] font-semibold text-muted mb-2.5">By person</div>
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(300px,1fr))' }}>
        {shown.map((p) => {
          const mine = work.filter((t) => t.user_id === p.user_id);
          const d = mine.filter((t) => t.done).length;
          const pc = pct(d, mine.length);
          const t = tintOf(p.user_id);
          const per = (s: Scope) => {
            const x = mine.filter((r) => r.scope === s);
            return `${x.filter((r) => r.done).length}/${x.length}`;
          };
          return (
            <div key={p.user_id} className="rounded-lg border overflow-hidden" style={{ background: t.bg, borderColor: t.br }}>
              <div className="flex items-center gap-2.5 px-4 py-3" style={{ borderBottom: '1px solid rgba(0,0,0,.06)' }}>
                <Avatar name={p.full_name} id={p.user_id} size={26} />
                <div className="min-w-0">
                  <div className="text-[13.5px] font-semibold truncate" style={{ color: t.fg }}>{p.full_name}</div>
                  <div className="text-[11.5px] opacity-70" style={{ color: t.fg }}>{mine.length} tasks</div>
                </div>
                <span className="ml-auto text-[22px] font-bold" style={{ color: t.fg }}>{pc}%</span>
              </div>
              <div className="px-4 py-2.5 bg-white/65">
                {(['daily', 'weekly', 'monthly'] as Scope[]).map((s) => (
                  <div key={s} className="flex justify-between py-1 text-[12.5px]">
                    <span className="text-muted capitalize">{s}</span>
                    <span className="font-semibold">{per(s)}</span>
                  </div>
                ))}
                <div className="flex justify-between py-1 text-[12.5px]">
                  <span className="text-muted">Blocked</span>
                  <span className="font-semibold" style={mine.filter((r) => r.status === 'blocked').length ? { color: '#DC2626' } : {}}>
                    {mine.filter((r) => r.status === 'blocked').length}
                  </span>
                </div>
                <div className="h-[7px] rounded-full bg-black/5 mt-2 overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${pc}%`, background: t.fg }} />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const CARD_TINT = {
  blue:   { bg: '#EFF6FF', br: '#BFDBFE', fg: '#1D4ED8' },
  green:  { bg: '#ECFDF5', br: '#A7F3D0', fg: '#047857' },
  red:    { bg: '#FEF2F2', br: '#FECACA', fg: '#B91C1C' },
  violet: { bg: '#F5F3FF', br: '#DDD6FE', fg: '#6D28D9' },
} as const;
