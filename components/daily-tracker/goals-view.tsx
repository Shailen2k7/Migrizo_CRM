'use client';

// =============================================================================
// GOALS & KPIs
//
// Three levels: an ANNUAL objective is the destination, MONTHLY KPIs say
// whether you are on track, DAILY tasks are what you actually do. A weekly
// review closes the loop every Monday.
//
// Two access levels, enforced in the database by RLS as well as here:
//   member  sees and manages only their own goals, tasks and reviews
//   admin   sees everyone, and can set goals or assign tasks to anyone
//
// The design bet: goal trackers die when people have to type numbers. So any
// KPI that CAN be computed from CRM data IS computed — revenue from payments,
// calls from the queue, conversions from lead stages. Only genuinely
// unobservable things (partnership conversations) are entered by hand. The
// Monday review is pre-filled from the same computed numbers, so the person
// writes judgement rather than data entry.
// =============================================================================

import { useState, useEffect, useCallback, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useApp } from '@/components/shared/app-provider';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import {
  Target, CalendarDays, ClipboardCheck, Plus, X, ChevronRight, Check,
  Loader2, Trash2, Sparkles, ArrowRight,
} from 'lucide-react';

// ── metric catalogue ────────────────────────────────────────────────────────
// Keys must match public.goal_metrics() in migration 035.
const METRICS: { key: string; label: string; unit: Unit; note: string }[] = [
  { key: 'revenue',    label: 'Revenue booked',        unit: 'gbp', note: 'Payments marked paid, credited to the lead owner' },
  { key: 'invoiced',   label: 'Amount invoiced',       unit: 'gbp', note: 'Payments raised, whether or not collected yet' },
  { key: 'hot_conv',   label: 'Leads converted',       unit: '',    note: 'Leads reaching invoice sent or won' },
  { key: 'new_hot',    label: 'New hot leads',         unit: '',    note: 'Leads promoted to hot' },
  { key: 'calls',      label: 'Calls made',            unit: '',    note: 'Lead queue rows worked' },
  { key: 'connects',   label: 'Connects',              unit: '',    note: 'Calls with any outcome other than no answer' },
  { key: 'interested', label: 'Marked interested',     unit: '',    note: 'Interested-hot plus interested-cold outcomes' },
  { key: 'task_rate',  label: 'Task completion rate',  unit: 'pct', note: 'Share of planned tasks ticked off' },
];

type Unit = '' | 'gbp' | 'pct' | 'hrs';
type Horizon = 'annual' | 'monthly';

interface Area { id: string; user_id: string; name: string; sort_order: number }
interface Goal {
  id: string; user_id: string; area_id: string | null; horizon: Horizon;
  title: string; why: string | null; source: 'auto' | 'manual'; metric_key: string | null;
  target_value: number; current_value: number; unit: Unit;
  period_start: string; period_end: string; status: string;
}
interface Task {
  id: string; user_id: string; goal_id: string | null; title: string;
  task_date: string; done: boolean; rolled_from: string | null;
}
interface Review {
  id?: string; user_id: string; week_start: string;
  wins: string | null; blockers: string | null; next_focus: string | null;
  manager_note: string | null; submitted_at: string | null;
}
interface WeekRow {
  user_id: string; tasks_planned: number; tasks_done: number; tasks_carried: number;
  revenue: number; calls: number; connects: number; interested: number;
  hot_conv: number; review_submitted: boolean;
}

// ── date helpers (local time, no UTC drift) ─────────────────────────────────
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
function mondayOf(d: Date) { const x = new Date(d); const dow = (x.getDay() + 6) % 7; return addDays(x, -dow); }
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function fmt(v: number, unit: Unit) {
  if (unit === 'gbp') return v >= 1000 ? `£${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}k` : `£${Math.round(v)}`;
  if (unit === 'pct') return `${Math.round(v)}%`;
  if (unit === 'hrs') return `${Math.round(v)} hrs`;
  return `${Math.round(v)}`;
}
const pctOf = (a: number, b: number) => (b > 0 ? Math.min(100, Math.round((a / b) * 100)) : 0);
const tone = (p: number) => (p >= 90 ? '#2F9E68' : p >= 60 ? '#B0791B' : '#C9455C');

const AVATAR_COLOURS = ['#4F46E5', '#0E7490', '#B0791B', '#9D174D', '#2F9E68', '#C9455C', '#6D4AC9'];
const colourFor = (id: string) => AVATAR_COLOURS[Math.abs([...id].reduce((a, c) => a + c.charCodeAt(0), 0)) % AVATAR_COLOURS.length];
const initials = (n: string) => n.split(' ').filter(Boolean).map((x) => x[0]).join('').slice(0, 2).toUpperCase();

export function GoalsView() {
  const app = useApp() as unknown as {
    workspace: { id: string };
    user: { id: string; name: string };
    role: 'admin' | 'member';
    members: { user_id: string; full_name: string; role: string; status: string }[];
  };
  const { workspace, user, role, members } = app;
  const isAdmin = role === 'admin';
  const supabase = useMemo(() => createClient(), []);

  const [view, setView] = useState<'week' | 'goals' | 'review'>('week');
  const [weekStart, setWeekStart] = useState<Date>(() => mondayOf(new Date()));
  const [loading, setLoading] = useState(true);

  const [areas, setAreas] = useState<Area[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [summary, setSummary] = useState<WeekRow[]>([]);
  const [autoVals, setAutoVals] = useState<Record<string, Record<string, number>>>({});
  const [review, setReview] = useState<Review | null>(null);

  const [openCell, setOpenCell] = useState<string | null>(null);
  const [goalModal, setGoalModal] = useState(false);
  const [focusUser, setFocusUser] = useState<string>(user.id);

  // A member only ever sees themselves; an admin sees the whole active team.
  const people = useMemo(() => {
    const active = (members || []).filter((m) => m.status !== 'paused');
    const list = isAdmin ? active : active.filter((m) => m.user_id === user.id);
    if (!list.length) return [{ user_id: user.id, full_name: user.name, role, status: 'active' }];
    return list;
  }, [members, isAdmin, user.id, user.name, role]);

  const days = useMemo(() => Array.from({ length: 6 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const todayStr = ymd(new Date());
  const monthStart = useMemo(() => { const d = new Date(); return ymd(new Date(d.getFullYear(), d.getMonth(), 1)); }, []);
  const monthEnd = useMemo(() => { const d = new Date(); return ymd(new Date(d.getFullYear(), d.getMonth() + 1, 0)); }, []);

  // ── load ──────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    const ws = workspace.id;
    const from = ymd(weekStart), to = ymd(addDays(weekStart, 5));

    const [a, g, t, s, m] = await Promise.all([
      supabase.from('goal_areas').select('*').eq('workspace_id', ws).order('sort_order'),
      supabase.from('goals').select('*').eq('workspace_id', ws).eq('status', 'active'),
      supabase.from('goal_tasks').select('*').eq('workspace_id', ws).gte('task_date', from).lte('task_date', to),
      supabase.rpc('goal_week_summary', { p_workspace_id: ws, p_week_start: from }),
      supabase.rpc('goal_metrics', { p_workspace_id: ws, p_from: monthStart, p_to: monthEnd }),
    ]);

    if (a.data) setAreas(a.data as Area[]);
    if (g.data) setGoals(g.data as Goal[]);
    if (t.data) setTasks(t.data as Task[]);
    if (s.data) setSummary(s.data as WeekRow[]);
    if (m.data) {
      const map: Record<string, Record<string, number>> = {};
      for (const r of m.data as { user_id: string; metric_key: string; value: number }[]) {
        (map[r.user_id] = map[r.user_id] || {})[r.metric_key] = Number(r.value);
      }
      setAutoVals(map);
    }
    if (s.error) console.error('[goals] week summary:', s.error.message);
    setLoading(false);
  }, [supabase, workspace.id, weekStart, monthStart, monthEnd]);

  useEffect(() => { void load(); }, [load]);

  // Load the focused person's review whenever the week or person changes.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from('goal_reviews').select('*')
        .eq('workspace_id', workspace.id).eq('user_id', focusUser)
        .eq('week_start', ymd(weekStart)).maybeSingle();
      if (!cancelled) {
        setReview((data as Review) || {
          user_id: focusUser, week_start: ymd(weekStart),
          wins: '', blockers: '', next_focus: '', manager_note: '', submitted_at: null,
        });
      }
    })();
    return () => { cancelled = true; };
  }, [supabase, workspace.id, focusUser, weekStart]);

  // ── mutations ─────────────────────────────────────────────────────────────
  const toggleTask = async (t: Task) => {
    setTasks((prev) => prev.map((x) => (x.id === t.id ? { ...x, done: !x.done } : x)));
    const { error } = await supabase.from('goal_tasks').update({ done: !t.done }).eq('id', t.id);
    if (error) { toast.error('Could not save'); void load(); }
  };

  const addTask = async (uid: string, date: string, title: string, goalId?: string | null) => {
    const clean = title.trim();
    if (!clean) return;
    const { data, error } = await supabase.from('goal_tasks').insert({
      workspace_id: workspace.id, user_id: uid, title: clean, task_date: date,
      goal_id: goalId || null, created_by: user.id,
    }).select().single();
    if (error) { toast.error(`Could not add task: ${error.message}`); return; }
    setTasks((prev) => [...prev, data as Task]);
    toast.success('Task added');
  };

  const deleteTask = async (id: string) => {
    setTasks((prev) => prev.filter((x) => x.id !== id));
    await supabase.from('goal_tasks').delete().eq('id', id);
  };

  const rollOver = async (from: string, to: string) => {
    const { data, error } = await supabase.rpc('goal_tasks_rollover', {
      p_workspace_id: workspace.id, p_from: from, p_to: to,
    });
    if (error) { toast.error('Rollover failed'); return; }
    toast.success(data ? `${data} task${data === 1 ? '' : 's'} carried forward` : 'Nothing left to carry forward');
    void load();
  };

  const saveManual = async (g: Goal, v: number) => {
    setGoals((prev) => prev.map((x) => (x.id === g.id ? { ...x, current_value: v } : x)));
    const { error } = await supabase.from('goals').update({ current_value: v, updated_at: new Date().toISOString() }).eq('id', g.id);
    if (error) toast.error('Could not save');
  };

  const saveReview = async (submit: boolean) => {
    if (!review) return;
    const row = {
      workspace_id: workspace.id, user_id: review.user_id, week_start: review.week_start,
      wins: review.wins, blockers: review.blockers, next_focus: review.next_focus,
      manager_note: review.manager_note,
      submitted_at: submit ? new Date().toISOString() : review.submitted_at,
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase.from('goal_reviews').upsert(row, { onConflict: 'workspace_id,user_id,week_start' });
    if (error) { toast.error(`Could not save: ${error.message}`); return; }
    toast.success(submit ? 'Review submitted' : 'Draft saved');
    void load();
  };

  // ── derived ───────────────────────────────────────────────────────────────
  const goalValue = (g: Goal): number => {
    if (g.source === 'auto' && g.metric_key) return autoVals[g.user_id]?.[g.metric_key] ?? 0;
    return Number(g.current_value) || 0;
  };
  const tasksFor = (uid: string, date: string) => tasks.filter((t) => t.user_id === uid && t.task_date === date);
  const sumFor = (uid: string) => summary.find((s) => s.user_id === uid);
  const nameOf = (uid: string) => people.find((p) => p.user_id === uid)?.full_name || 'Unknown';

  const weekLabel = `${weekStart.getDate()} ${MONTHS[weekStart.getMonth()]} – ${addDays(weekStart, 5).getDate()} ${MONTHS[addDays(weekStart, 5).getMonth()]}`;
  const isThisWeek = ymd(mondayOf(new Date())) === ymd(weekStart);

  return (
    <div>
      {/* ── toolbar ── */}
      <div className="flex items-center gap-2 flex-wrap mb-4">
        <div className="inline-flex gap-0.5 p-0.5 rounded-lg bg-surface-2">
          {([['week', 'Week', CalendarDays], ['goals', 'Goals', Target], ['review', 'Weekly review', ClipboardCheck]] as const).map(([k, label, Icon]) => (
            <button key={k} onClick={() => setView(k)}
              className={cn('inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[13px] font-medium transition',
                view === k ? 'bg-surface shadow-sm text-ink' : 'text-muted hover:text-ink')}>
              <Icon className="w-3.5 h-3.5" /> {label}
            </button>
          ))}
        </div>

        <div className="flex-1" />

        <div className="inline-flex items-center gap-1">
          <button onClick={() => setWeekStart((w) => addDays(w, -7))} className="btn btn-outline btn-sm px-2">‹</button>
          <span className="text-[12.5px] text-muted px-2 whitespace-nowrap">
            {isThisWeek ? 'This week' : weekLabel}
          </span>
          <button onClick={() => setWeekStart((w) => addDays(w, 7))} className="btn btn-outline btn-sm px-2">›</button>
          {!isThisWeek && (
            <button onClick={() => setWeekStart(mondayOf(new Date()))} className="btn btn-outline btn-sm">Today</button>
          )}
        </div>

        <button onClick={() => setGoalModal(true)} className="btn btn-primary btn-sm">
          <Plus className="w-3.5 h-3.5" /> {isAdmin ? 'Set a goal' : 'New goal'}
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-muted text-[13px]">
          <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…
        </div>
      ) : (
        <>
          {view === 'week' && (
            <WeekBoard
              people={people} days={days} todayStr={todayStr} openCell={openCell} setOpenCell={setOpenCell}
              tasksFor={tasksFor} toggleTask={toggleTask} addTask={addTask} deleteTask={deleteTask}
              rollOver={rollOver} sumFor={sumFor} goals={goals} goalValue={goalValue}
              isAdmin={isAdmin} onOpenPerson={(uid) => { setFocusUser(uid); setView('goals'); }}
            />
          )}

          {view === 'goals' && (
            <GoalsPanel
              people={people} focusUser={focusUser} setFocusUser={setFocusUser} isAdmin={isAdmin}
              goals={goals} areas={areas} goalValue={goalValue} saveManual={saveManual}
              onDelete={async (id) => {
                setGoals((p) => p.filter((g) => g.id !== id));
                await supabase.from('goals').delete().eq('id', id);
                toast.success('Goal removed');
              }}
              onAdd={() => setGoalModal(true)}
            />
          )}

          {view === 'review' && (
            <ReviewPanel
              people={people} focusUser={focusUser} setFocusUser={setFocusUser} isAdmin={isAdmin}
              currentUserId={user.id} weekStart={weekStart} weekLabel={weekLabel}
              sum={sumFor(focusUser)} review={review} setReview={setReview} save={saveReview}
              nameOf={nameOf} summary={summary} peopleAll={people}
            />
          )}
        </>
      )}

      {goalModal && (
        <GoalModal
          people={people} isAdmin={isAdmin} defaultUser={focusUser} areas={areas}
          onClose={() => setGoalModal(false)}
          onSaved={() => { setGoalModal(false); void load(); }}
          workspaceId={workspace.id} createdBy={user.id}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// WEEK BOARD — rows are people, columns are days. Click a box to open the day.
// ═══════════════════════════════════════════════════════════════════════════
function WeekBoard({
  people, days, todayStr, openCell, setOpenCell, tasksFor, toggleTask, addTask, deleteTask,
  rollOver, sumFor, goals, goalValue, isAdmin, onOpenPerson,
}: {
  people: { user_id: string; full_name: string }[];
  days: Date[]; todayStr: string;
  openCell: string | null; setOpenCell: (v: string | null) => void;
  tasksFor: (uid: string, d: string) => Task[];
  toggleTask: (t: Task) => void;
  addTask: (uid: string, d: string, title: string) => void;
  deleteTask: (id: string) => void;
  rollOver: (from: string, to: string) => void;
  sumFor: (uid: string) => WeekRow | undefined;
  goals: Goal[]; goalValue: (g: Goal) => number;
  isAdmin: boolean; onOpenPerson: (uid: string) => void;
}) {
  const [draft, setDraft] = useState('');

  const cellTone = (done: number, total: number) =>
    !total ? '#C4C4CC' : done === total ? '#2F9E68' : done === 0 ? '#C9455C' : '#B0791B';

  return (
    <div>
      <div className="card overflow-x-auto">
        <div className="min-w-[760px]">
          {/* header */}
          <div className="flex border-b border-border bg-surface-2 sticky top-0 z-[5]">
            <div className="min-w-[210px] max-w-[210px] px-4 py-2.5 border-r border-border text-[10px] font-extrabold tracking-[0.08em] uppercase text-faint">
              Team
            </div>
            {days.map((d) => {
              const isToday = ymd(d) === todayStr;
              return (
                <div key={ymd(d)} className={cn('flex-1 min-w-[88px] border-r border-border-2 last:border-r-0 py-2 text-center', isToday && 'bg-[#EEF0FF]')}>
                  <div className={cn('text-[10.5px] font-bold tracking-wide uppercase', isToday ? 'text-[#4F46E5]' : 'text-faint')}>{DOW[(d.getDay() + 6) % 7]}</div>
                  <div className={cn('text-[15px] font-semibold', isToday && 'text-[#4F46E5]')}>{d.getDate()}</div>
                </div>
              );
            })}
          </div>

          {/* rows */}
          {people.map((p) => {
            const open = openCell?.startsWith(p.user_id + '|') ? openCell.split('|')[1] : null;
            const s = sumFor(p.user_id);
            return (
              <div key={p.user_id}>
                <div className="flex border-b border-border-2">
                  <button
                    onClick={() => onOpenPerson(p.user_id)}
                    className="min-w-[210px] max-w-[210px] px-4 py-2.5 border-r border-border flex items-center gap-2.5 text-left hover:bg-surface-2 transition-colors"
                  >
                    <div className="w-[30px] h-[30px] rounded-[9px] flex items-center justify-center text-white text-[11px] font-bold flex-shrink-0"
                      style={{ background: colourFor(p.user_id) }}>{initials(p.full_name)}</div>
                    <div className="min-w-0">
                      <div className="text-[13.5px] font-medium truncate">{p.full_name}</div>
                      <div className="text-[10.5px] text-faint">
                        {s ? `${s.tasks_done}/${s.tasks_planned} this week` : 'No tasks yet'}
                      </div>
                    </div>
                  </button>

                  {days.map((d) => {
                    const ds = ymd(d);
                    const list = tasksFor(p.user_id, ds);
                    const done = list.filter((t) => t.done).length;
                    const c = cellTone(done, list.length);
                    const key = `${p.user_id}|${ds}`;
                    const isOpen = openCell === key;
                    return (
                      <button key={ds} onClick={() => setOpenCell(isOpen ? null : key)}
                        className={cn('flex-1 min-w-[88px] border-r border-border-2 last:border-r-0 p-2 text-left transition-colors',
                          ds === todayStr && 'bg-[#F7F8FF]', isOpen && 'bg-[#EEF0FF] shadow-[inset_0_-2px_0_#4F46E5]',
                          !isOpen && 'hover:bg-surface-2')}>
                        <div className="rounded-lg px-2 py-1.5 min-h-[50px] flex flex-col justify-between"
                          style={{ background: list.length ? `${c}14` : 'transparent' }}>
                          <div>
                            <div className="text-[13px] font-bold leading-none" style={{ color: list.length ? c : '#C4C4CC' }}>
                              {list.length ? `${done}/${list.length}` : '—'}
                            </div>
                            <div className="text-[9.5px] text-faint mt-0.5">{list.length ? 'tasks' : 'none set'}</div>
                          </div>
                          {!!list.length && (
                            <div className="flex gap-[2.5px] flex-wrap mt-1.5">
                              {list.map((t) => (
                                <span key={t.id} className="w-[6px] h-[6px] rounded-[2px]"
                                  style={{ background: t.done ? c : '#DCDCE2' }} />
                              ))}
                            </div>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* expanded day */}
                {open && (
                  <div className="bg-[#FBFBFD] border-b border-border">
                    <div className="flex items-center gap-2.5 px-4 pt-3 pb-2">
                      <div className="w-6 h-6 rounded-[7px] flex items-center justify-center text-white text-[10px] font-bold"
                        style={{ background: colourFor(p.user_id) }}>{initials(p.full_name)}</div>
                      <div>
                        <div className="text-[13.5px] font-semibold">
                          {p.full_name.split(' ')[0]} · {new Date(open + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
                        </div>
                        <div className="text-[11.5px] text-faint">
                          {(() => { const l = tasksFor(p.user_id, open); return l.length ? `${l.filter((t) => t.done).length} of ${l.length} done` : 'Nothing planned for this day'; })()}
                        </div>
                      </div>
                      <div className="ml-auto flex items-center gap-1.5">
                        {tasksFor(p.user_id, open).some((t) => !t.done) && (
                          <button onClick={() => rollOver(open, ymd(addDays(new Date(open + 'T00:00:00'), 1)))}
                            className="btn btn-outline btn-sm" title="Move everything unfinished to the next day">
                            <ArrowRight className="w-3.5 h-3.5" /> Carry forward
                          </button>
                        )}
                        <button onClick={() => setOpenCell(null)} className="btn btn-outline btn-sm">Close</button>
                      </div>
                    </div>

                    <div className="px-2 pb-1">
                      {tasksFor(p.user_id, open).map((t) => (
                        <div key={t.id} className="group flex items-start gap-2.5 px-3 py-2 rounded-lg hover:bg-white transition-colors">
                          <button onClick={() => toggleTask(t)}
                            className={cn('w-[17px] h-[17px] rounded-[5px] border-[1.6px] flex items-center justify-center flex-shrink-0 mt-0.5 transition-all',
                              t.done ? 'bg-[#2F9E68] border-[#2F9E68]' : 'border-[#C8C8CE] bg-white hover:border-[#4F46E5]')}>
                            {t.done && <Check className="w-2.5 h-2.5 text-white" strokeWidth={4} />}
                          </button>
                          <div className="flex-1 min-w-0">
                            <div className={cn('text-[13px] leading-snug', t.done && 'line-through text-faint')}>{t.title}</div>
                            {t.rolled_from && (
                              <div className="text-[10.5px] text-[#B0791B] mt-0.5">
                                Carried over from {new Date(t.rolled_from + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                              </div>
                            )}
                          </div>
                          <button onClick={() => deleteTask(t.id)}
                            className="opacity-0 group-hover:opacity-100 p-1 text-faint hover:text-danger transition-opacity">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>

                    <div className="px-4 pb-3.5 pt-1">
                      <input
                        value={openCell === `${p.user_id}|${open}` ? draft : ''}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && draft.trim()) { addTask(p.user_id, open, draft); setDraft(''); }
                        }}
                        placeholder={`Add a task for ${p.full_name.split(' ')[0]} and press Enter`}
                        className="w-full text-[12.5px] px-3 py-2 rounded-lg border border-dashed border-border bg-white outline-none focus:border-[#4F46E5]"
                      />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* legend */}
      <div className="flex items-center gap-4 flex-wrap mt-3 text-[11.5px] text-muted">
        {([['#2F9E68', 'All done'], ['#B0791B', 'In progress'], ['#C9455C', 'Nothing done'], ['#DCDCE2', 'No tasks set']] as const).map(([c, l]) => (
          <span key={l}><i className="inline-block w-2.5 h-2.5 rounded-[3px] mr-1.5 align-[-1px]" style={{ background: c }} />{l}</span>
        ))}
        <span className="ml-auto text-faint">Numbers read: done / planned</span>
      </div>

      {/* monthly KPI strip */}
      <div className="text-[10.5px] font-extrabold tracking-[0.08em] uppercase text-faint mt-6 mb-2.5">This month</div>
      <div className="grid gap-3.5" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(272px,1fr))' }}>
        {people.map((p) => {
          const mine = goals.filter((g) => g.user_id === p.user_id && g.horizon === 'monthly');
          const overall = mine.length ? Math.round(mine.reduce((s, g) => s + pctOf(goalValue(g), g.target_value), 0) / mine.length) : 0;
          return (
            <button key={p.user_id} onClick={() => onOpenPerson(p.user_id)} className="card text-left overflow-hidden hover:shadow-md transition-shadow">
              <div className="flex items-center gap-2.5 px-4 py-3 border-b border-border-2">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center text-white text-[13px] font-bold"
                  style={{ background: colourFor(p.user_id) }}>{initials(p.full_name)}</div>
                <div className="min-w-0">
                  <div className="text-[14px] font-semibold truncate">{p.full_name}</div>
                  <div className="text-[11.5px] text-faint">{mine.length} monthly KPI{mine.length === 1 ? '' : 's'}</div>
                </div>
                {!!mine.length && (
                  <div className="ml-auto text-[17px] font-bold" style={{ color: tone(overall) }}>{overall}%</div>
                )}
              </div>
              {mine.length ? mine.slice(0, 4).map((g) => {
                const v = goalValue(g), p2 = pctOf(v, g.target_value);
                return (
                  <div key={g.id} className="px-4 py-2.5 border-b border-border-2 last:border-b-0">
                    <div className="flex items-baseline gap-2">
                      <span className="text-[12.5px] text-ink-2 truncate">{g.title}</span>
                      <span className="ml-auto text-[13px] font-bold whitespace-nowrap" style={{ color: tone(p2) }}>
                        {fmt(v, g.unit)}<span className="text-[11px] text-faint font-normal"> / {fmt(g.target_value, g.unit)}</span>
                      </span>
                    </div>
                    <div className="h-[5px] rounded bg-surface-2 mt-1.5 overflow-hidden">
                      <div className="h-full rounded transition-all" style={{ width: `${p2}%`, background: tone(p2) }} />
                    </div>
                  </div>
                );
              }) : (
                <div className="px-4 py-4 text-[12px] text-faint">
                  No monthly KPIs set{isAdmin ? ' — click to add one' : ' yet'}.
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// GOALS PANEL — annual objectives and monthly KPIs for one person.
// ═══════════════════════════════════════════════════════════════════════════
function GoalsPanel({
  people, focusUser, setFocusUser, isAdmin, goals, areas, goalValue, saveManual, onDelete, onAdd,
}: {
  people: { user_id: string; full_name: string }[];
  focusUser: string; setFocusUser: (v: string) => void; isAdmin: boolean;
  goals: Goal[]; areas: Area[];
  goalValue: (g: Goal) => number;
  saveManual: (g: Goal, v: number) => void;
  onDelete: (id: string) => void;
  onAdd: () => void;
}) {
  const mine = goals.filter((g) => g.user_id === focusUser);
  const annual = mine.filter((g) => g.horizon === 'annual');
  const monthly = mine.filter((g) => g.horizon === 'monthly');
  const areaName = (id: string | null) => areas.find((a) => a.id === id)?.name;

  const Section = ({ title, list, empty }: { title: string; list: Goal[]; empty: string }) => (
    <>
      <div className="text-[10.5px] font-extrabold tracking-[0.08em] uppercase text-faint mt-6 mb-2.5">{title}</div>
      <div className="card">
        {list.length ? list.map((g) => {
          const v = goalValue(g), p = pctOf(v, g.target_value);
          const metric = METRICS.find((m) => m.key === g.metric_key);
          return (
            <div key={g.id} className="group px-4 py-3.5 border-b border-border-2 last:border-b-0">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px] font-semibold leading-snug">
                    {g.title}
                    <span className={cn('ml-2 text-[9px] font-bold tracking-wide px-1.5 py-0.5 rounded align-[2px]',
                      g.source === 'auto' ? 'bg-[#EEF0FF] text-[#4F46E5]' : 'bg-surface-2 text-muted')}>
                      {g.source === 'auto' ? 'AUTO' : 'MANUAL'}
                    </span>
                  </div>
                  {(g.why || metric || areaName(g.area_id)) && (
                    <div className="text-[12px] text-muted mt-1 leading-relaxed">
                      {g.why || metric?.note}
                      {areaName(g.area_id) && <span className="text-faint"> · {areaName(g.area_id)}</span>}
                    </div>
                  )}
                </div>
                <div className="text-right flex-shrink-0">
                  {g.source === 'manual' ? (
                    <div className="flex items-center gap-1.5">
                      <input type="number" defaultValue={v}
                        onBlur={(e) => { const n = Number(e.target.value); if (n !== v) saveManual(g, n); }}
                        className="w-[74px] text-[13px] font-bold text-right px-2 py-1 rounded-md border border-border bg-surface-2 outline-none focus:border-[#4F46E5] focus:bg-white" />
                      <span className="text-[11px] text-faint">/ {fmt(g.target_value, g.unit)}</span>
                    </div>
                  ) : (
                    <>
                      <div className="text-[16px] font-bold" style={{ color: tone(p) }}>{fmt(v, g.unit)}</div>
                      <div className="text-[11px] text-faint">of {fmt(g.target_value, g.unit)}</div>
                    </>
                  )}
                </div>
                {isAdmin && (
                  <button onClick={() => onDelete(g.id)}
                    className="opacity-0 group-hover:opacity-100 p-1 text-faint hover:text-danger transition-opacity">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <div className="h-[6px] rounded bg-surface-2 mt-2.5 overflow-hidden">
                <div className="h-full rounded transition-all" style={{ width: `${p}%`, background: tone(p) }} />
              </div>
            </div>
          );
        }) : (
          <div className="px-4 py-8 text-center">
            <div className="text-[13px] text-muted">{empty}</div>
            <button onClick={onAdd} className="btn btn-outline btn-sm mt-3"><Plus className="w-3.5 h-3.5" /> Add one</button>
          </div>
        )}
      </div>
    </>
  );

  return (
    <div>
      {isAdmin && people.length > 1 && (
        <div className="inline-flex gap-0.5 p-0.5 rounded-lg bg-surface-2 mb-1 flex-wrap">
          {people.map((p) => (
            <button key={p.user_id} onClick={() => setFocusUser(p.user_id)}
              className={cn('px-3 py-1.5 rounded-md text-[12.5px] font-medium transition',
                focusUser === p.user_id ? 'bg-surface shadow-sm text-ink' : 'text-muted hover:text-ink')}>
              {p.full_name.split(' ')[0]}
            </button>
          ))}
        </div>
      )}
      <Section title={`Annual objective · ${new Date().getFullYear()}`} list={annual} empty="No annual objective set. This is the destination for the year." />
      <Section title={`Monthly KPIs · ${MONTHS[new Date().getMonth()]}`} list={monthly} empty="No monthly KPIs yet. These tell you whether you are on track." />
      <div className="text-[12px] text-muted leading-relaxed mt-4 px-1">
        <Sparkles className="w-3.5 h-3.5 inline mr-1 align-[-2px] text-[#4F46E5]" />
        <b className="text-ink font-medium">AUTO</b> figures are read straight from the CRM, so nobody types them and nobody can inflate them.
        <b className="text-ink font-medium"> MANUAL</b> figures are things the CRM cannot see and need updating by hand.
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// WEEKLY REVIEW — the Monday meeting document.
// ═══════════════════════════════════════════════════════════════════════════
function ReviewPanel({
  people, focusUser, setFocusUser, isAdmin, currentUserId, weekLabel,
  sum, review, setReview, save, summary,
}: {
  people: { user_id: string; full_name: string }[];
  focusUser: string; setFocusUser: (v: string) => void; isAdmin: boolean;
  currentUserId: string; weekStart: Date; weekLabel: string;
  sum: WeekRow | undefined; review: Review | null;
  setReview: (r: Review) => void; save: (submit: boolean) => void;
  nameOf: (id: string) => string; summary: WeekRow[]; peopleAll: { user_id: string; full_name: string }[];
}) {
  const isOwn = focusUser === currentUserId;
  const field = (k: keyof Review, label: string, ph: string, disabled = false) => (
    <div className="card p-4">
      <label className="block text-[10.5px] font-extrabold tracking-[0.06em] uppercase text-faint mb-2">{label}</label>
      <textarea
        value={(review?.[k] as string) || ''} disabled={disabled}
        onChange={(e) => review && setReview({ ...review, [k]: e.target.value })}
        placeholder={ph}
        className="w-full text-[13px] leading-relaxed px-3 py-2.5 rounded-lg border border-border bg-surface-2 outline-none focus:border-[#4F46E5] focus:bg-surface min-h-[86px] resize-y disabled:opacity-60"
      />
    </div>
  );

  return (
    <div>
      {isAdmin && people.length > 1 && (
        <div className="inline-flex gap-0.5 p-0.5 rounded-lg bg-surface-2 mb-4 flex-wrap">
          {people.map((p) => {
            const s = summary.find((x) => x.user_id === p.user_id);
            return (
              <button key={p.user_id} onClick={() => setFocusUser(p.user_id)}
                className={cn('inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12.5px] font-medium transition',
                  focusUser === p.user_id ? 'bg-surface shadow-sm text-ink' : 'text-muted hover:text-ink')}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: s?.review_submitted ? '#2F9E68' : '#D8D8DD' }} />
                {p.full_name.split(' ')[0]}
              </button>
            );
          })}
        </div>
      )}

      {/* what actually happened — computed, not typed */}
      <div className="card p-4">
        <label className="block text-[10.5px] font-extrabold tracking-[0.06em] uppercase text-faint mb-2.5">
          What the system already knows · {weekLabel}
        </label>
        <div className="rounded-xl bg-[#F7F8FF] border border-[#DDE1F5] px-4 py-3">
          {sum ? (
            <div className="grid gap-x-6 gap-y-2 text-[12.5px] text-ink-2" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))' }}>
              <div>Tasks completed: <b className="text-ink">{sum.tasks_done} of {sum.tasks_planned}</b></div>
              <div>Carried over: <b className="text-ink">{sum.tasks_carried}</b></div>
              <div>Revenue booked: <b className="text-ink">{fmt(Number(sum.revenue), 'gbp')}</b></div>
              <div>Leads converted: <b className="text-ink">{sum.hot_conv}</b></div>
              <div>Calls made: <b className="text-ink">{sum.calls}</b></div>
              <div>Connects: <b className="text-ink">{sum.connects}</b></div>
              <div>Marked interested: <b className="text-ink">{sum.interested}</b></div>
              <div>Completion rate: <b className="text-ink">{pctOf(sum.tasks_done, sum.tasks_planned)}%</b></div>
            </div>
          ) : (
            <div className="text-[12.5px] text-muted">No activity recorded for this week yet.</div>
          )}
        </div>
        <div className="text-[11.5px] text-faint mt-2.5 leading-relaxed">
          These numbers are computed from the CRM, not typed in, so they cannot drift from what actually happened. Write the judgement below.
        </div>
      </div>

      <div className="grid gap-3.5 mt-3.5" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))' }}>
        {field('wins', 'Wins this week', 'What actually moved forward?', !isOwn && !isAdmin)}
        {field('blockers', 'Blockers', 'What is in the way, and what do you need?', !isOwn && !isAdmin)}
        {field('next_focus', 'Focus for next week', 'The two or three things that matter most.', !isOwn && !isAdmin)}
        {isAdmin
          ? field('manager_note', 'Manager note — visible to the person', 'Feedback, redirection, recognition.')
          : (review?.manager_note ? (
            <div className="card p-4">
              <label className="block text-[10.5px] font-extrabold tracking-[0.06em] uppercase text-faint mb-2">Manager note</label>
              <div className="text-[13px] leading-relaxed text-ink-2 whitespace-pre-wrap">{review.manager_note}</div>
            </div>
          ) : null)}
      </div>

      <div className="flex items-center gap-2 mt-4 flex-wrap">
        <span className="text-[12px] text-muted">
          {review?.submitted_at
            ? `Submitted ${new Date(review.submitted_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`
            : 'Reviews open every Monday and stay editable through the week.'}
        </span>
        <div className="flex-1" />
        <button onClick={() => save(false)} className="btn btn-outline btn-sm">Save draft</button>
        <button onClick={() => save(true)} className="btn btn-primary btn-sm">
          <ClipboardCheck className="w-3.5 h-3.5" /> {review?.submitted_at ? 'Re-submit' : 'Submit review'}
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SET A GOAL
// ═══════════════════════════════════════════════════════════════════════════
function GoalModal({
  people, isAdmin, defaultUser, areas, onClose, onSaved, workspaceId, createdBy,
}: {
  people: { user_id: string; full_name: string }[];
  isAdmin: boolean; defaultUser: string; areas: Area[];
  onClose: () => void; onSaved: () => void;
  workspaceId: string; createdBy: string;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [uid, setUid] = useState(defaultUser);
  const [horizon, setHorizon] = useState<Horizon>('monthly');
  const [source, setSource] = useState<'auto' | 'manual'>('auto');
  const [metric, setMetric] = useState('revenue');
  const [title, setTitle] = useState('');
  const [why, setWhy] = useState('');
  const [target, setTarget] = useState('30');
  const [unit, setUnit] = useState<Unit>('gbp');
  const [areaId, setAreaId] = useState<string>('');
  const [busy, setBusy] = useState(false);

  const m = METRICS.find((x) => x.key === metric);
  useEffect(() => { if (source === 'auto' && m) setUnit(m.unit); }, [metric, source, m]);
  useEffect(() => { if (source === 'auto' && m && !title) setTitle(m.label); }, [metric, source, m, title]);

  const now = new Date();
  const period = horizon === 'annual'
    ? { start: ymd(new Date(now.getFullYear(), 0, 1)), end: ymd(new Date(now.getFullYear(), 11, 31)), label: `${now.getFullYear()}` }
    : { start: ymd(new Date(now.getFullYear(), now.getMonth(), 1)), end: ymd(new Date(now.getFullYear(), now.getMonth() + 1, 0)), label: `${MONTHS[now.getMonth()]} ${now.getFullYear()}` };

  const save = async () => {
    if (!title.trim()) { toast.error('Give it a title'); return; }
    const tgt = Number(target);
    if (!tgt || tgt <= 0) { toast.error('Set a target above zero'); return; }
    setBusy(true);
    const { error } = await supabase.from('goals').insert({
      workspace_id: workspaceId, user_id: uid, area_id: areaId || null,
      horizon, title: title.trim(), why: why.trim() || null,
      source, metric_key: source === 'auto' ? metric : null,
      target_value: tgt, current_value: 0, unit,
      period_start: period.start, period_end: period.end, created_by: createdBy,
    });
    setBusy(false);
    if (error) { toast.error(`Could not save: ${error.message}`); return; }
    toast.success('Goal set');
    onSaved();
  };

  const whoName = people.find((p) => p.user_id === uid)?.full_name || '';

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center p-3">
      <div className="absolute inset-0 bg-black/45" onClick={onClose} />
      <div className="relative bg-surface rounded-2xl shadow-2xl w-full max-w-[560px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border">
          <div>
            <div className="text-[15.5px] font-semibold">Set a goal</div>
            <div className="text-[11.5px] text-faint mt-0.5">
              {horizon === 'annual' ? 'The destination for the year' : 'A monthly number that says whether you are on track'}
            </div>
          </div>
          <button onClick={onClose} className="ml-auto p-1.5 text-faint hover:text-ink"><X className="w-5 h-5" /></button>
        </div>

        <div className="px-5 py-4 overflow-auto flex-1">
          {isAdmin && people.length > 1 && (
            <div className="mb-4">
              <label className="block text-[10.5px] font-extrabold tracking-[0.07em] uppercase text-faint mb-2">Who is this for?</label>
              <div className="flex gap-1.5 flex-wrap">
                {people.map((p) => (
                  <button key={p.user_id} onClick={() => setUid(p.user_id)}
                    className={cn('px-3 py-2 rounded-lg text-[12.5px] font-medium border transition-all',
                      uid === p.user_id ? 'text-white border-transparent' : 'bg-surface border-border text-ink-2 hover:bg-surface-2')}
                    style={uid === p.user_id ? { background: colourFor(p.user_id) } : {}}>
                    {p.full_name.split(' ')[0]}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="mb-4">
            <label className="block text-[10.5px] font-extrabold tracking-[0.07em] uppercase text-faint mb-2">What level?</label>
            <div className="grid grid-cols-2 gap-2">
              {([['annual', 'Annual objective', 'The destination'], ['monthly', 'Monthly KPI', 'Are we on track']] as const).map(([k, t, d]) => (
                <button key={k} onClick={() => setHorizon(k)}
                  className={cn('text-left px-3 py-2.5 rounded-lg border transition-all',
                    horizon === k ? 'border-[#4F46E5] bg-[#EEF0FF]' : 'border-border bg-surface hover:bg-surface-2')}>
                  <span className={cn('block text-[12.5px] font-semibold', horizon === k && 'text-[#4F46E5]')}>{t}</span>
                  <span className="block text-[10.5px] text-faint mt-0.5">{d}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="mb-4">
            <label className="block text-[10.5px] font-extrabold tracking-[0.07em] uppercase text-faint mb-2">How is it measured?</label>
            <div className="rounded-xl border border-border overflow-hidden">
              {([['auto', 'Automatically, from the CRM', 'The number updates itself. Nobody types it, nobody can inflate it, and it never goes stale.'],
                 ['manual', 'Entered by hand', 'For things the CRM cannot see, like partnership conversations. Someone must remember to update it.']] as const).map(([k, t, d]) => (
                <button key={k} onClick={() => setSource(k)}
                  className={cn('w-full flex gap-2.5 px-3.5 py-3 text-left border-b border-border-2 last:border-b-0 transition-colors',
                    source === k ? 'bg-[#F5F6FF]' : 'hover:bg-surface-2')}>
                  <span className={cn('w-[15px] h-[15px] rounded-full border-[1.6px] flex-shrink-0 mt-0.5 flex items-center justify-center',
                    source === k ? 'border-[#4F46E5]' : 'border-[#C8C8CE]')}>
                    {source === k && <span className="w-[7px] h-[7px] rounded-full bg-[#4F46E5]" />}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[12.5px] font-semibold">{t}</span>
                    <span className="block text-[11px] text-muted mt-0.5 leading-relaxed">{d}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>

          {source === 'auto' && (
            <div className="mb-4">
              <label className="block text-[10.5px] font-extrabold tracking-[0.07em] uppercase text-faint mb-2">Which CRM number?</label>
              <select value={metric} onChange={(e) => setMetric(e.target.value)}
                className="w-full text-[13.5px] px-3 py-2.5 rounded-lg border border-border bg-surface-2 outline-none focus:border-[#4F46E5]">
                {METRICS.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
              </select>
              {m && <div className="text-[11px] text-muted mt-2 leading-relaxed">{m.note}</div>}
            </div>
          )}

          <div className="mb-4">
            <label className="block text-[10.5px] font-extrabold tracking-[0.07em] uppercase text-faint mb-2">Goal</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)}
              placeholder={horizon === 'annual' ? 'Reach £360k booked revenue this year' : 'Revenue booked'}
              className="w-full text-[13.5px] px-3 py-2.5 rounded-lg border border-border bg-surface-2 outline-none focus:border-[#4F46E5] focus:bg-surface" />
          </div>

          <div className="mb-4">
            <label className="block text-[10.5px] font-extrabold tracking-[0.07em] uppercase text-faint mb-2">
              Why it matters <span className="normal-case tracking-normal font-medium text-faint">— optional</span>
            </label>
            <textarea value={why} onChange={(e) => setWhy(e.target.value)}
              placeholder="One line so it still makes sense in six months."
              className="w-full text-[13.5px] px-3 py-2.5 rounded-lg border border-border bg-surface-2 outline-none focus:border-[#4F46E5] focus:bg-surface min-h-[62px] resize-y" />
          </div>

          <div className="grid gap-2.5 mb-4" style={{ gridTemplateColumns: '1fr 140px' }}>
            <div>
              <label className="block text-[10.5px] font-extrabold tracking-[0.07em] uppercase text-faint mb-2">Target</label>
              <input type="number" value={target} onChange={(e) => setTarget(e.target.value)}
                className="w-full text-[13.5px] px-3 py-2.5 rounded-lg border border-border bg-surface-2 outline-none focus:border-[#4F46E5] focus:bg-surface" />
            </div>
            <div>
              <label className="block text-[10.5px] font-extrabold tracking-[0.07em] uppercase text-faint mb-2">Unit</label>
              <select value={unit} onChange={(e) => setUnit(e.target.value as Unit)} disabled={source === 'auto'}
                className="w-full text-[13.5px] px-3 py-2.5 rounded-lg border border-border bg-surface-2 outline-none focus:border-[#4F46E5] disabled:opacity-60">
                <option value="">Count</option><option value="gbp">£</option>
                <option value="pct">Percent</option><option value="hrs">Hours</option>
              </select>
            </div>
          </div>

          {!!areas.filter((a) => a.user_id === uid).length && (
            <div className="mb-4">
              <label className="block text-[10.5px] font-extrabold tracking-[0.07em] uppercase text-faint mb-2">Key result area</label>
              <select value={areaId} onChange={(e) => setAreaId(e.target.value)}
                className="w-full text-[13.5px] px-3 py-2.5 rounded-lg border border-border bg-surface-2 outline-none focus:border-[#4F46E5]">
                <option value="">None</option>
                {areas.filter((a) => a.user_id === uid).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
          )}

          <div className="rounded-xl bg-[#F7F8FF] border border-[#DDE1F5] px-4 py-3">
            <div className="text-[10px] font-extrabold tracking-[0.07em] uppercase text-[#4F46E5] mb-1.5">Preview</div>
            <div className="text-[13px] font-semibold leading-snug">{title || 'Your goal will appear here'}</div>
            <div className="text-[11.5px] text-muted mt-1 leading-relaxed">
              {whoName.split(' ')[0]} · {horizon === 'annual' ? 'annual objective' : 'monthly KPI'} · {period.label} · target {fmt(Number(target) || 0, unit)}
              {source === 'auto' ? ` · tracked automatically from "${m?.label}"` : ' · entered by hand'}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 px-5 py-3.5 border-t border-border bg-surface-2">
          <span className="text-[11.5px] text-faint">
            {horizon === 'annual' ? `Runs all of ${period.label}` : `Resets on the 1st · ${period.label}`}
          </span>
          <div className="flex-1" />
          <button onClick={onClose} className="btn btn-outline btn-sm">Cancel</button>
          <button onClick={() => void save()} disabled={busy} className="btn btn-primary btn-sm">
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ChevronRight className="w-3.5 h-3.5" />}
            {busy ? 'Saving…' : 'Save goal'}
          </button>
        </div>
      </div>
    </div>
  );
}
