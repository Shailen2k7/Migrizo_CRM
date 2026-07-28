'use client';

// =============================================================================
// LEAD ENGINE (admin only)
//
// Two jobs:
//   1. Set who gets how many cold leads each morning, and who owns hot leads.
//   2. Show whether the rotation is actually working — the number that matters
//      is "oldest untouched lead". If that climbs past ~15 days, capacity is
//      too low for the size of the pool.
// =============================================================================
import { useState, useEffect, useCallback } from 'react';
import { useApp } from '@/components/shared/app-provider';
import { createClient } from '@/lib/supabase/client';
import { initials, avatarColor, cn } from '@/lib/utils';
import { toast } from 'sonner';
import { Loader2, Users, Save, Zap, RefreshCw } from 'lucide-react';

interface Rule { user_id: string; cold_per_day: number; takes_hot: boolean; rollover: boolean; active: boolean }
interface Health {
  cold_total: number; fresh_7d: number; aging_14d: number; stale_over_14d: number;
  sleeping: number; oldest_days: number; retired: number; daily_capacity: number;
}

export default function LeadEnginePage() {
  const app = useApp() as ReturnType<typeof useApp> & {
    workspace: { id: string }; role: string;
    members: { user_id: string; full_name: string; role: string; status: string }[];
  };
  const { workspace, role, members } = app;
  const isAdmin = role === 'admin';

  const [rules, setRules] = useState<Record<string, Rule>>({});
  const [health, setHealth] = useState<Health | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [diag, setDiag] = useState<{ check_name: string; status: string; detail: string }[]>([]);
  const [today, setToday] = useState<Record<string, { total: number; pending: number; done: number; manual: number }>>({});
  const [topUp, setTopUp] = useState<Record<string, string>>({});
  const [busyUser, setBusyUser] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!isAdmin) return;
    const supabase = createClient();
    const [{ data: r }, { data: h }, { data: dg }, { data: tq }] = await Promise.all([
      supabase.from('lead_queue_rules').select('*').eq('workspace_id', workspace.id),
      supabase.rpc('lead_pool_health', { p_workspace_id: workspace.id }),
      supabase.rpc('queue_diagnose', { p_workspace_id: workspace.id }),
      supabase.rpc('queue_today_by_person', { p_workspace_id: workspace.id }),
    ]);
    // Diagnose missing entirely means the setup SQL has not been run.
    if (!dg) {
      setDiag([{
        check_name: 'Database setup',
        status: 'BLOCKED',
        detail: 'The queue functions are missing. Run FINAL_SETUP.sql in the Supabase SQL editor, then reload this page. It is safe to run more than once.',
      }]);
    } else {
      setDiag(dg as { check_name: string; status: string; detail: string }[]);
    }
    const tmap: Record<string, { total: number; pending: number; done: number; manual: number }> = {};
    for (const row of (tq as { user_id: string; total: number; pending: number; done: number; manual: number }[]) || []) {
      tmap[row.user_id] = { total: row.total, pending: row.pending, done: row.done, manual: row.manual };
    }
    setToday(tmap);
    const map: Record<string, Rule> = {};
    for (const row of (r as Rule[]) || []) map[row.user_id] = row;
    setRules(map);
    setHealth(Array.isArray(h) ? (h[0] as Health) : (h as Health));
    setLoading(false);
  }, [workspace.id, isAdmin]);

  useEffect(() => { void load(); }, [load]);

  const save = async (userId: string, patch: Partial<Rule>) => {
    setSaving(userId);
    const supabase = createClient();
    const cur = rules[userId] || { user_id: userId, cold_per_day: 0, takes_hot: false, rollover: true, active: true };
    const next = { ...cur, ...patch, workspace_id: workspace.id, user_id: userId, updated_at: new Date().toISOString() };
    const { error } = await supabase.from('lead_queue_rules').upsert(next, { onConflict: 'workspace_id,user_id' });
    if (error) toast.error(error.message);
    else { setRules((p) => ({ ...p, [userId]: next as Rule })); toast.success('Saved'); }
    setSaving(null);
  };

  // Turn Postgres/PostgREST noise into something actionable.
  const explain = (msg: string) => {
    if (/could not find the function|schema cache|does not exist/i.test(msg)) {
      return 'The database is not set up yet. Run FINAL_SETUP.sql in the Supabase SQL editor, then reload this page.';
    }
    return msg;
  };

  // Give one person N more leads right now, taking the next oldest-untouched.
  const assignMore = async (userId: string) => {
    const n = parseInt(topUp[userId] || '', 10);
    if (!n || n < 1) { toast.error('Enter how many leads to assign'); return; }
    setBusyUser(userId);
    const supabase = createClient();
    const { data, error } = await supabase.rpc('assign_leads_manual', {
      p_workspace_id: workspace.id, p_user_id: userId, p_count: n,
    });
    if (error) toast.error(explain(error.message));
    else {
      const res = Array.isArray(data) ? data[0] : data;
      const got = res?.assigned ?? 0;
      if (got === 0) toast.error('No leads available right now — every eligible lead is already assigned today.');
      else if (res?.reason === 'partial') toast.success(`Assigned ${got}. That was every lead still available today.`);
      else toast.success(`Assigned ${got} leads`);
    }
    setTopUp((p) => ({ ...p, [userId]: '' }));
    await load();
    setBusyUser(null);
  };

  // Hand leads back to the pool. Untouched ones simply release; worked ones are
  // rewound to the exact state captured when they were assigned.
  const giveBack = async (userId: string, name: string, includeWorked: boolean) => {
    const t = today[userId];
    if (!t || t.total === 0) { toast.error('Nothing assigned today'); return; }
    if (includeWorked) {
      if (!confirm(`Undo everything for ${name}?\n\nAll ${t.total} leads return to the pool, including the ${t.done} already worked. Those are rewound to exactly how they were before being assigned, so the pool is left untouched.\n\nUse this for testing.`)) return;
    } else if (!confirm(`Return ${t.pending} unworked leads from ${name} to the pool?\n\nAnything already worked is left alone.`)) return;

    setBusyUser(userId);
    const supabase = createClient();
    const { data, error } = await supabase.rpc('return_queue', {
      p_workspace_id: workspace.id, p_user_id: userId, p_include_worked: includeWorked,
    });
    if (error) toast.error(explain(error.message));
    else {
      const res = Array.isArray(data) ? data[0] : data;
      const rel = res?.released ?? 0, rew = res?.rewound ?? 0;
      toast.success(rew > 0 ? `${rel + rew} leads returned, ${rew} rewound to their original state` : `${rel} leads returned to the pool`);
    }
    await load();
    setBusyUser(null);
  };

  const runNow = async () => {
    setGenerating(true);
    const supabase = createClient();
    const { data, error } = await supabase.rpc('generate_daily_queue_v2', { p_workspace_id: workspace.id });
    if (error) {
      toast.error(explain(error.message));
    } else {
      const res = Array.isArray(data) ? data[0] : data;
      const made = res?.created ?? 0;
      const why = res?.reason as string | undefined;
      if (made > 0) {
        toast.success(`${made} leads assigned for today`);
      } else if (why === 'no_quotas') {
        toast.error('Nobody has a daily quota yet. Set a number below and switch them Active.');
      } else if (why === 'no_cold_leads') {
        toast.error('No leads currently qualify as cold, so there is nothing to assign.');
      } else {
        toast('Today\u2019s queues were already generated. Use Rebuild to start them over.');
      }
    }
    await load();
    setGenerating(false);
  };

  // Clears today's UNWORKED assignments and regenerates — for when quotas change
  // mid-day. Anything already worked is left alone.
  const rebuild = async () => {
    if (!confirm('Rebuild today\u2019s queues?\n\nUnworked assignments for today are cleared and handed out again. Leads already worked are untouched.')) return;
    setGenerating(true);
    const supabase = createClient();
    const { data, error } = await supabase.rpc('regenerate_today', { p_workspace_id: workspace.id });
    if (error) toast.error(explain(error.message));
    else {
      const res = Array.isArray(data) ? data[0] : data;
      toast.success(`${res?.created ?? 0} leads assigned for today`);
    }
    await load();
    setGenerating(false);
  };

  if (!isAdmin) {
    return (
      <div className="max-w-[900px] mx-auto px-6 py-20 text-center">
        <Users className="w-8 h-8 mx-auto text-faint mb-3" />
        <div className="text-[15px] font-semibold">Admins only</div>
        <div className="text-[13px] text-muted mt-1">Lead assignment rules are managed by workspace admins.</div>
      </div>
    );
  }

  const activeMembers = (members || []).filter((m) => m.status === 'active');
  const capacity = health?.daily_capacity || 0;
  const cycle = capacity > 0 && health ? (health.cold_total / capacity).toFixed(1) : '—';
  const oldestOk = (health?.oldest_days ?? 0) <= 15;
  const totalBar = health ? Math.max(1, health.fresh_7d + health.aging_14d + health.stale_over_14d + health.sleeping) : 1;

  return (
    <div className="max-w-[1000px] mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight flex items-center gap-2.5">
            <span className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-700 flex items-center justify-center"><Zap className="w-4 h-4" /></span>
            Lead Engine
          </h1>
          <p className="text-[13px] text-muted mt-1">Cold leads are handed out every morning, oldest-untouched first, so none are forgotten.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={rebuild} disabled={generating}
            className="text-[12.5px] font-bold px-4 py-2.5 rounded-xl border border-border text-ink-2 hover:bg-surface-2 disabled:opacity-50">
            Rebuild
          </button>
          <button onClick={runNow} disabled={generating}
            className="text-[12.5px] font-bold px-4 py-2.5 rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-2">
            {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Generate today&rsquo;s queues
          </button>
        </div>
      </div>

      {loading ? (
        <div className="py-16 text-center text-[13px] text-muted"><Loader2 className="w-5 h-5 animate-spin inline mr-2" />Loading…</div>
      ) : (
        <>
          {/* System check — surfaces anything preventing assignment */}
          {diag.length > 0 && (
            <div className="mt-5 rounded-[15px] border overflow-hidden"
              style={diag.some((d) => d.status === 'BLOCKED')
                ? { borderColor: '#FECDD3', background: '#FFF8F9' }
                : { borderColor: 'hsl(var(--border))', background: 'hsl(var(--surface))' }}>
              <div className="px-4 py-3 text-[11px] font-extrabold tracking-[0.09em] uppercase"
                style={{ color: diag.some((d) => d.status === 'BLOCKED') ? '#E11D48' : 'hsl(var(--faint))' }}>
                {diag.some((d) => d.status === 'BLOCKED') ? 'Action needed — leads are not being assigned' : 'System check — all good'}
              </div>
              {diag.map((d) => (
                <div key={d.check_name} className="px-4 py-3 border-t flex gap-3" style={{ borderTopColor: 'hsl(var(--border))' }}>
                  <span className="text-[9.5px] font-extrabold px-2 py-1 rounded-md h-fit whitespace-nowrap"
                    style={d.status === 'OK' ? { background: '#ECFDF5', color: '#059669' }
                      : d.status === 'EMPTY' ? { background: '#FFF8EC', color: '#B45309' }
                      : { background: '#FFF1F3', color: '#E11D48' }}>
                    {d.status}
                  </span>
                  <div className="min-w-0">
                    <div className="text-[12.5px] font-semibold">{d.check_name}</div>
                    <div className="text-[12px] text-muted mt-0.5 leading-relaxed">{d.detail}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {/* health */}
          <div className="text-[11px] font-extrabold tracking-[0.09em] uppercase text-faint mt-6 mb-3">Pool health</div>
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))' }}>
            <div className="rounded-[15px] border border-border bg-surface p-4">
              <div className="text-[10.5px] font-extrabold tracking-wider uppercase text-faint">Oldest untouched</div>
              <div className={cn('text-[26px] font-black mt-1.5 leading-none', oldestOk ? 'text-emerald-600' : 'text-rose-600')}>
                {health?.oldest_days ?? 0}<span className="text-[14px] font-bold"> days</span>
              </div>
              <div className="text-[11.5px] text-muted mt-1.5">{oldestOk ? 'Target under 15 · healthy' : 'Above target — raise quotas'}</div>
            </div>
            <div className="rounded-[15px] border border-border bg-surface p-4">
              <div className="text-[10.5px] font-extrabold tracking-wider uppercase text-faint">Full cycle</div>
              <div className="text-[26px] font-black mt-1.5 leading-none">{cycle}<span className="text-[14px] font-bold"> days</span></div>
              <div className="text-[11.5px] text-muted mt-1.5">{health?.cold_total ?? 0} cold ÷ {capacity}/day</div>
            </div>
            <div className="rounded-[15px] border border-border bg-surface p-4">
              <div className="text-[10.5px] font-extrabold tracking-wider uppercase text-faint">Sleeping</div>
              <div className="text-[26px] font-black mt-1.5 leading-none">{health?.sleeping ?? 0}</div>
              <div className="text-[11.5px] text-muted mt-1.5">Said &ldquo;not now&rdquo; · return in 30 days</div>
            </div>
            <div className="rounded-[15px] border border-border bg-surface p-4">
              <div className="text-[10.5px] font-extrabold tracking-wider uppercase text-faint">Retired</div>
              <div className="text-[26px] font-black mt-1.5 leading-none text-amber-600">{health?.retired ?? 0}</div>
              <div className="text-[11.5px] text-muted mt-1.5">Dead or 6 failed attempts</div>
            </div>
          </div>

          {/* coverage */}
          <div className="text-[11px] font-extrabold tracking-[0.09em] uppercase text-faint mt-6 mb-3">Coverage · {health?.cold_total ?? 0} cold leads</div>
          <div className="rounded-[15px] border border-border bg-surface p-4">
            <div className="flex h-[9px] rounded-full overflow-hidden bg-surface-2">
              <div style={{ width: `${((health?.fresh_7d || 0) / totalBar) * 100}%`, background: '#059669' }} />
              <div style={{ width: `${((health?.aging_14d || 0) / totalBar) * 100}%`, background: '#F59E0B' }} />
              <div style={{ width: `${((health?.stale_over_14d || 0) / totalBar) * 100}%`, background: '#E11D48' }} />
              <div style={{ width: `${((health?.sleeping || 0) / totalBar) * 100}%`, background: '#CBD2E0' }} />
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-3">
              {[['#059669', 'Under 7d', health?.fresh_7d], ['#F59E0B', '7–14d', health?.aging_14d],
                ['#E11D48', 'Over 14d', health?.stale_over_14d], ['#CBD2E0', 'Sleeping', health?.sleeping]].map(([c, l, n]) => (
                <span key={l as string} className="text-[11px] text-muted flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full" style={{ background: c as string }} />{l as string} · <b className="text-ink-2">{(n as number) ?? 0}</b>
                </span>
              ))}
            </div>
          </div>

          {/* today's queues — assign more / hand back */}
          <div className="text-[11px] font-extrabold tracking-[0.09em] uppercase text-faint mt-6 mb-3">Today&rsquo;s queues</div>
          <div className="space-y-2.5">
            {activeMembers.map((m) => {
              const t = today[m.user_id] || { total: 0, pending: 0, done: 0, manual: 0 };
              const busy = busyUser === m.user_id;
              return (
                <div key={m.user_id} className="rounded-[15px] border border-border bg-surface p-4">
                  <div className="flex items-center gap-3 flex-wrap">
                    <div className="av flex-shrink-0" style={{ background: avatarColor(m.user_id), width: 34, height: 34, borderRadius: 10, fontSize: 12 }}>{initials(m.full_name)}</div>
                    <div className="min-w-0">
                      <div className="text-[14px] font-semibold">{m.full_name}</div>
                      <div className="text-[11.5px] text-faint mt-0.5">
                        {t.total === 0 ? 'Nothing assigned today'
                          : <>{t.total} assigned · <b className="text-ink-2">{t.pending} left</b> · {t.done} worked{t.manual > 0 && <> · {t.manual} added by hand</>}</>}
                      </div>
                    </div>
                    <div className="ml-auto flex items-center gap-2 flex-wrap">
                      <input type="number" min={1} max={500} placeholder="30" value={topUp[m.user_id] || ''}
                        onChange={(e) => setTopUp((p) => ({ ...p, [m.user_id]: e.target.value }))}
                        onKeyDown={(e) => { if (e.key === 'Enter') void assignMore(m.user_id); }}
                        disabled={busy}
                        className="w-[70px] text-[13.5px] font-semibold text-center py-2 border border-border rounded-lg bg-surface outline-none focus:border-indigo-400 disabled:opacity-50" />
                      <button onClick={() => void assignMore(m.user_id)} disabled={busy}
                        className="text-[12.5px] font-bold px-3.5 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50">
                        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Assign'}
                      </button>
                      <button onClick={() => void giveBack(m.user_id, m.full_name, false)} disabled={busy || t.pending === 0}
                        title="Return leads they haven't worked yet"
                        className="text-[12.5px] font-bold px-3.5 py-2 rounded-lg border border-border text-ink-2 hover:bg-surface-2 disabled:opacity-40">
                        Return unworked
                      </button>
                      <button onClick={() => void giveBack(m.user_id, m.full_name, true)} disabled={busy || t.total === 0}
                        title="Undo everything, including worked leads — for testing"
                        className="text-[12.5px] font-bold px-3.5 py-2 rounded-lg border border-border text-rose-600 hover:bg-rose-50 hover:border-rose-200 disabled:opacity-40">
                        Undo all
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-2.5 text-[11.5px] text-muted leading-relaxed px-1">
            <b className="text-ink-2">Assign</b> hands over the next oldest-untouched leads, skipping anything already given out today.
            <b className="text-ink-2"> Return unworked</b> releases only leads nobody has touched.
            <b className="text-ink-2"> Undo all</b> also rewinds worked leads to exactly how they were before being assigned, so a test run leaves the pool untouched.
          </div>

          {/* rules */}
          <div className="text-[11px] font-extrabold tracking-[0.09em] uppercase text-faint mt-6 mb-3">Daily assignment rules</div>
          <div className="space-y-2.5">
            {activeMembers.map((m) => {
              const r = rules[m.user_id] || { user_id: m.user_id, cold_per_day: 0, takes_hot: false, rollover: true, active: true };
              return (
                <div key={m.user_id} className="rounded-[15px] border border-border bg-surface p-4">
                  <div className="flex items-center gap-3 flex-wrap">
                    <div className="av flex-shrink-0" style={{ background: avatarColor(m.user_id), width: 34, height: 34, borderRadius: 10, fontSize: 12 }}>{initials(m.full_name)}</div>
                    <div className="min-w-0">
                      <div className="text-[14px] font-semibold">{m.full_name}</div>
                      <div className="text-[11.5px] text-faint">{m.role === 'admin' ? 'Admin' : 'Team member'}</div>
                    </div>
                    <div className="ml-auto flex items-center gap-2">
                      <input type="number" min={0} max={500} defaultValue={r.cold_per_day}
                        onBlur={(e) => { const v = Math.max(0, Number(e.target.value) || 0); if (v !== r.cold_per_day) void save(m.user_id, { cold_per_day: v }); }}
                        className="w-[62px] text-[14px] font-bold text-center py-1.5 border border-border rounded-lg bg-surface outline-none focus:border-indigo-400" />
                      <span className="text-[11px] text-faint">cold / day</span>
                      {saving === m.user_id && <Loader2 className="w-3.5 h-3.5 animate-spin text-faint" />}
                    </div>
                  </div>
                  <div className="flex gap-2 mt-3 pt-3 border-t border-border-2 flex-wrap" style={{ borderTopColor: 'hsl(var(--surface-2))' }}>
                    {([['takes_hot', 'Owns hot leads'], ['rollover', 'Rollover unfinished'], ['active', 'Active']] as const).map(([k, lbl]) => (
                      <button key={k} onClick={() => void save(m.user_id, { [k]: !r[k] } as Partial<Rule>)}
                        className={cn('text-[11.5px] font-semibold px-3 py-1.5 rounded-full border-[1.5px] transition-colors',
                          r[k] ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-surface border-border text-muted hover:text-ink-2')}>
                        {lbl}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-5 rounded-xl border border-border bg-surface-2 p-4 text-[11.5px] text-muted leading-relaxed">
            <b className="text-ink-2">How the rotation works.</b> Each morning every active person is given their quota of cold leads,
            drawn oldest-untouched-first. A lead handed to one person is locked for that day, so nobody gets called twice.
            Unfinished leads roll forward to the next day. A lead is &ldquo;cold&rdquo; when it sits in new, attempted or connected
            and hasn&rsquo;t been touched for 14 days; hot means qualified, consultation, proposal or partial.
            <Save className="w-3 h-3 inline ml-1" /> Changes save instantly and apply from the next generation.
          </div>
        </>
      )}
    </div>
  );
}
