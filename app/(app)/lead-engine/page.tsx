'use client';

// =============================================================================
// LEAD ENGINE — admin only.
//
// Cold leads are handed out every morning, oldest-untouched first. Only leads
// at stage "Cold" with a phone or email are ever assigned; junk, won, invoiced
// and coming-soon are excluded outright.
// =============================================================================
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useApp } from '@/components/shared/app-provider';
import { createClient } from '@/lib/supabase/client';
import { initials, avatarColor, cn } from '@/lib/utils';
import { toast } from 'sonner';
import {
  Loader2, Users, Zap, RefreshCw, Check, ChevronDown, AlertCircle, Undo2,
} from 'lucide-react';

interface Rule { user_id: string; cold_per_day: number; takes_hot: boolean; rollover: boolean; active: boolean }
interface Health {
  cold_total: number; fresh_7d: number; aging_14d: number; stale_over_14d: number;
  sleeping: number; oldest_days: number; retired: number; daily_capacity: number;
}
interface Diag { check_name: string; status: string; detail: string }
interface DayCount { total: number; pending: number; done: number; manual: number }

export default function LeadEnginePage() {
  const app = useApp() as ReturnType<typeof useApp> & {
    workspace: { id: string }; role: string;
    members: { user_id: string; full_name: string; role: string; status: string }[];
  };
  const { workspace, role, members } = app;
  const isAdmin = role === 'admin';

  const [rules, setRules] = useState<Record<string, Rule>>({});
  const [health, setHealth] = useState<Health | null>(null);
  const [diag, setDiag] = useState<Diag[]>([]);
  const [today, setToday] = useState<Record<string, DayCount>>({});
  const [topUp, setTopUp] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [busyUser, setBusyUser] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [showChecks, setShowChecks] = useState(false);

  const explain = (msg: string) =>
    /could not find the function|schema cache|does not exist/i.test(msg)
      ? 'Database not set up yet. Run FINAL_SETUP.sql in Supabase, then reload.'
      : msg;

  const load = useCallback(async () => {
    if (!isAdmin) return;
    const sb = createClient();
    const [{ data: r }, { data: h }, { data: dg }, { data: tq }] = await Promise.all([
      sb.from('lead_queue_rules').select('*').eq('workspace_id', workspace.id),
      sb.rpc('lead_pool_health', { p_workspace_id: workspace.id }),
      sb.rpc('queue_diagnose', { p_workspace_id: workspace.id }),
      sb.rpc('queue_today_by_person', { p_workspace_id: workspace.id }),
    ]);
    const map: Record<string, Rule> = {};
    for (const row of (r as Rule[]) || []) map[row.user_id] = row;
    setRules(map);
    setHealth(Array.isArray(h) ? (h[0] as Health) : (h as Health));
    setDiag(dg ? (dg as Diag[]) : [{
      check_name: 'Database setup', status: 'BLOCKED',
      detail: 'Queue functions are missing. Run FINAL_SETUP.sql in Supabase, then reload this page.',
    }]);
    const t: Record<string, DayCount> = {};
    for (const row of (tq as (DayCount & { user_id: string })[]) || []) {
      t[row.user_id] = { total: row.total, pending: row.pending, done: row.done, manual: row.manual };
    }
    setToday(t);
    setLoading(false);
  }, [workspace.id, isAdmin]);

  useEffect(() => { void load(); }, [load]);

  const save = async (userId: string, patch: Partial<Rule>) => {
    setSaving(userId);
    const sb = createClient();
    const cur = rules[userId] || { user_id: userId, cold_per_day: 0, takes_hot: false, rollover: true, active: true };
    const next = { ...cur, ...patch, workspace_id: workspace.id, user_id: userId, updated_at: new Date().toISOString() };
    const { error } = await sb.from('lead_queue_rules').upsert(next, { onConflict: 'workspace_id,user_id' });
    if (error) toast.error(explain(error.message));
    else { setRules((p) => ({ ...p, [userId]: next as Rule })); toast.success('Saved'); void load(); }
    setSaving(null);
  };

  const generate = async (rebuild = false) => {
    setGenerating(true);
    const sb = createClient();
    const fn = rebuild ? 'regenerate_today' : 'generate_daily_queue_v2';
    const { data, error } = await sb.rpc(fn, { p_workspace_id: workspace.id });
    if (error) toast.error(explain(error.message));
    else {
      const res = Array.isArray(data) ? data[0] : data;
      const made = res?.created ?? 0;
      if (made > 0) toast.success(`${made} leads assigned`);
      else if (res?.reason === 'no_quotas') toast.error('Nobody has a daily quota yet');
      else if (res?.reason === 'no_cold_leads') toast.error('No workable cold leads available');
      else toast('Already generated for today. Use Rebuild to start over.');
    }
    await load();
    setGenerating(false);
  };

  const assignMore = async (userId: string) => {
    const n = parseInt(topUp[userId] || '', 10);
    if (!n || n < 1) { toast.error('Enter a number first'); return; }
    setBusyUser(userId);
    const sb = createClient();
    const { data, error } = await sb.rpc('assign_leads_manual', {
      p_workspace_id: workspace.id, p_user_id: userId, p_count: n,
    });
    if (error) toast.error(explain(error.message));
    else {
      const res = Array.isArray(data) ? data[0] : data;
      const got = res?.assigned ?? 0;
      if (got === 0) toast.error('No cold leads available right now');
      else if (res?.reason === 'partial') toast.success(`Assigned ${got}, all that were left`);
      else toast.success(`Assigned ${got} leads`);
    }
    setTopUp((p) => ({ ...p, [userId]: '' }));
    await load();
    setBusyUser(null);
  };

  const giveBack = async (userId: string, name: string, includeWorked: boolean) => {
    const t = today[userId];
    if (!t?.total) { toast.error('Nothing assigned today'); return; }
    const msg = includeWorked
      ? `Undo everything for ${name}?\n\nAll ${t.total} leads return to the pool, including the ${t.done} already worked. Those are rewound to exactly how they were before being assigned.`
      : `Return ${t.pending} unworked leads from ${name}?\n\nAnything already worked is left alone.`;
    if (!confirm(msg)) return;
    setBusyUser(userId);
    const sb = createClient();
    const { data, error } = await sb.rpc('return_queue', {
      p_workspace_id: workspace.id, p_user_id: userId, p_include_worked: includeWorked,
    });
    if (error) toast.error(explain(error.message));
    else {
      const res = Array.isArray(data) ? data[0] : data;
      const rel = res?.released ?? 0, rew = res?.rewound ?? 0;
      toast.success(rew ? `${rel + rew} returned, ${rew} rewound` : `${rel} returned to the pool`);
    }
    await load();
    setBusyUser(null);
  };

  if (!isAdmin) {
    return (
      <div className="max-w-[560px] mx-auto px-6 py-24 text-center">
        <Users className="w-7 h-7 mx-auto text-faint mb-3" />
        <div className="text-[15px] font-medium">Admins only</div>
      </div>
    );
  }

  const blocked = diag.filter((d) => d.status === 'BLOCKED');
  const capacity = health?.daily_capacity || 0;
  const cycle = capacity > 0 && health ? (health.cold_total / capacity).toFixed(1) : null;
  const oldestOk = (health?.oldest_days ?? 0) <= 15;
  const activeMembers = (members || []).filter((m) => m.status === 'active');
  const bar = health ? Math.max(1, health.fresh_7d + health.aging_14d + health.stale_over_14d + health.sleeping) : 1;

  return (
    <div className="max-w-[820px] mx-auto px-5 sm:px-7 py-8">
      <style>{`
        @keyframes le-rise { from { opacity:0; transform:translateY(8px);} to { opacity:1; transform:none;} }
        @keyframes le-grow { from { transform:scaleX(0);} to { transform:scaleX(1);} }
        .le-in { animation: le-rise .4s cubic-bezier(.22,.9,.3,1) both; }
        .le-bar > i { transform-origin:left; animation: le-grow .7s cubic-bezier(.22,.9,.3,1) both; }
        @media (prefers-reduced-motion: reduce) { .le-in,.le-bar > i { animation:none; } }
      `}</style>

      {/* header */}
      <div className="flex items-start gap-4 flex-wrap le-in">
        <div className="flex-1 min-w-[240px]">
          <h1 className="text-[25px] font-semibold tracking-[-0.024em]">Lead Engine</h1>
          <p className="text-[13.5px] text-muted mt-1.5 leading-relaxed">
            Cold leads are handed out each morning, oldest first. Only leads marked <b className="font-medium text-ink-2">Cold</b> are ever assigned.
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => generate(true)} disabled={generating}
            className="text-[13px] font-medium px-3.5 py-2 rounded-full border border-border text-ink-2 hover:bg-surface-2 transition-colors disabled:opacity-40">
            Rebuild
          </button>
          <button onClick={() => generate(false)} disabled={generating}
            className="text-[13px] font-medium px-4 py-2 rounded-full bg-indigo-600 text-white hover:bg-indigo-700 transition-colors disabled:opacity-40 flex items-center gap-1.5">
            {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Generate
          </button>
        </div>
      </div>

      {loading ? (
        <div className="py-24 text-center text-[13.5px] text-muted"><Loader2 className="w-5 h-5 animate-spin inline mr-2" />Loading</div>
      ) : (
        <>
          {/* compact status strip — expands only if you want detail */}
          <button onClick={() => setShowChecks((v) => !v)}
            className={cn('w-full mt-5 rounded-[14px] border px-4 py-3 flex items-center gap-3 text-left transition-colors le-in',
              blocked.length ? 'border-amber-200 bg-amber-50/50 hover:bg-amber-50' : 'border-border bg-surface hover:bg-surface-2')}>
            <span className={cn('w-2 h-2 rounded-full flex-shrink-0', blocked.length ? 'bg-amber-500' : 'bg-emerald-500')} />
            <span className="text-[13px] flex-1 min-w-0">
              {blocked.length
                ? <><b className="font-medium">{blocked[0].check_name}</b> <span className="text-muted">— {blocked[0].detail}</span></>
                : <span className="text-muted">All checks passing. Queues generate nightly at 00:01.</span>}
            </span>
            <ChevronDown className={cn('w-4 h-4 text-faint flex-shrink-0 transition-transform', showChecks && 'rotate-180')} />
          </button>

          {showChecks && (
            <div className="mt-2 rounded-[14px] border border-border bg-surface divide-y divide-border le-in">
              {diag.map((d) => (
                <div key={d.check_name} className="px-4 py-3 flex gap-3">
                  <span className={cn('mt-0.5 flex-shrink-0', d.status === 'OK' ? 'text-emerald-600' : d.status === 'EMPTY' ? 'text-faint' : 'text-amber-600')}>
                    {d.status === 'OK' ? <Check className="w-3.5 h-3.5" strokeWidth={2.5} /> : <AlertCircle className="w-3.5 h-3.5" />}
                  </span>
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium">{d.check_name}</div>
                    <div className="text-[12.5px] text-muted mt-0.5 leading-relaxed">{d.detail}</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* pool */}
          <div className="grid gap-3 mt-6 le-in" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))' }}>
            {[
              { l: 'Oldest untouched', v: `${health?.oldest_days ?? 0}`, u: 'days', s: oldestOk ? 'Within target' : 'Above 15 days', good: oldestOk },
              { l: 'Cold pool', v: `${health?.cold_total ?? 0}`, u: '', s: capacity ? `${capacity} handed out daily` : 'No quotas set' },
              { l: 'Full cycle', v: cycle ?? '—', u: cycle ? 'days' : '', s: 'To reach every lead' },
              { l: 'Sleeping', v: `${health?.sleeping ?? 0}`, u: '', s: 'Return after 30 days' },
            ].map((c) => (
              <div key={c.l} className="rounded-[14px] border border-border bg-surface px-4 py-3.5">
                <div className="text-[11.5px] text-faint">{c.l}</div>
                <div className={cn('text-[23px] font-semibold tracking-[-0.02em] mt-1.5 leading-none',
                  c.good === true ? 'text-emerald-600' : c.good === false ? 'text-amber-600' : '')}>
                  {c.v}{c.u && <span className="text-[13px] font-medium ml-1 text-muted">{c.u}</span>}
                </div>
                <div className="text-[11.5px] text-muted mt-1.5">{c.s}</div>
              </div>
            ))}
          </div>

          {/* coverage */}
          <div className="rounded-[14px] border border-border bg-surface px-4 py-4 mt-3 le-in">
            <div className="flex h-1.5 rounded-full overflow-hidden bg-surface-2 le-bar">
              <i style={{ width: `${((health?.fresh_7d || 0) / bar) * 100}%`, background: '#34D399', animationDelay: '0ms' }} />
              <i style={{ width: `${((health?.aging_14d || 0) / bar) * 100}%`, background: '#FBBF24', animationDelay: '80ms' }} />
              <i style={{ width: `${((health?.stale_over_14d || 0) / bar) * 100}%`, background: '#FB7185', animationDelay: '160ms' }} />
              <i style={{ width: `${((health?.sleeping || 0) / bar) * 100}%`, background: '#D4D4D8', animationDelay: '240ms' }} />
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-1.5 mt-3">
              {[['#34D399', 'Under 7 days', health?.fresh_7d], ['#FBBF24', '7 to 14', health?.aging_14d],
                ['#FB7185', 'Over 14', health?.stale_over_14d], ['#D4D4D8', 'Sleeping', health?.sleeping]].map(([c, l, n]) => (
                <span key={l as string} className="text-[12px] text-muted flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: c as string }} />
                  {l as string} <b className="font-medium text-ink-2">{(n as number) ?? 0}</b>
                </span>
              ))}
            </div>
          </div>

          {/* people */}
          <div className="text-[12px] font-medium text-faint uppercase tracking-wide mt-8 mb-3 ml-1">Team</div>
          <div className="rounded-[16px] border border-border bg-surface overflow-hidden le-in">
            {activeMembers.map((m, i) => {
              const r = rules[m.user_id] || { user_id: m.user_id, cold_per_day: 0, takes_hot: false, rollover: true, active: true };
              const t = today[m.user_id] || { total: 0, pending: 0, done: 0, manual: 0 };
              const busy = busyUser === m.user_id;
              const pct = t.total ? Math.round((t.done / t.total) * 100) : 0;
              return (
                <div key={m.user_id} className={cn('px-4 py-4', i > 0 && 'border-t border-border')}>
                  <div className="flex items-center gap-3 flex-wrap">
                    <div className="av flex-shrink-0" style={{ background: avatarColor(m.user_id), width: 34, height: 34, borderRadius: '50%', fontSize: 12 }}>{initials(m.full_name)}</div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[14.5px] font-medium">{m.full_name}</div>
                      <div className="text-[12px] text-muted mt-0.5">
                        {t.total === 0 ? 'Nothing assigned today'
                          : <>{t.done} of {t.total} worked{t.manual > 0 && <span className="text-faint"> · {t.manual} added by hand</span>}</>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <input type="number" min={0} max={500} defaultValue={r.cold_per_day}
                        onBlur={(e) => { const v = Math.max(0, Number(e.target.value) || 0); if (v !== r.cold_per_day) void save(m.user_id, { cold_per_day: v }); }}
                        className="w-[58px] text-[14px] font-medium text-center py-1.5 border border-border rounded-lg bg-surface outline-none focus:border-indigo-400 transition-colors" />
                      <span className="text-[11.5px] text-faint whitespace-nowrap">per day</span>
                      {saving === m.user_id && <Loader2 className="w-3.5 h-3.5 animate-spin text-faint" />}
                    </div>
                  </div>

                  {t.total > 0 && (
                    <div className="h-1 rounded-full bg-surface-2 mt-3 overflow-hidden le-bar">
                      <i className="block h-full rounded-full" style={{ width: `${pct}%`, background: '#818CF8' }} />
                    </div>
                  )}

                  <div className="flex items-center gap-2 mt-3 flex-wrap">
                    {([['takes_hot', 'Hot leads'], ['rollover', 'Rollover'], ['active', 'Active']] as const).map(([k, lbl]) => (
                      <button key={k} onClick={() => void save(m.user_id, { [k]: !r[k] } as Partial<Rule>)}
                        className={cn('text-[11.5px] font-medium px-2.5 py-1 rounded-full border transition-colors',
                          r[k] ? 'bg-ink border-ink text-white' : 'border-border text-faint hover:text-ink-2')}>
                        {lbl}
                      </button>
                    ))}
                    <div className="ml-auto flex items-center gap-1.5">
                      <input type="number" min={1} placeholder="30" value={topUp[m.user_id] || ''}
                        onChange={(e) => setTopUp((p) => ({ ...p, [m.user_id]: e.target.value }))}
                        onKeyDown={(e) => { if (e.key === 'Enter') void assignMore(m.user_id); }}
                        disabled={busy}
                        className="w-[54px] text-[12.5px] text-center py-1.5 border border-border rounded-lg bg-surface outline-none focus:border-indigo-400 disabled:opacity-50" />
                      <button onClick={() => void assignMore(m.user_id)} disabled={busy}
                        className="text-[12px] font-medium px-3 py-1.5 rounded-full bg-indigo-600 text-white hover:bg-indigo-700 transition-colors disabled:opacity-40">
                        {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Assign'}
                      </button>
                      <button onClick={() => void giveBack(m.user_id, m.full_name, false)} disabled={busy || !t.pending}
                        title="Return leads they have not worked"
                        className="text-[12px] font-medium px-2.5 py-1.5 rounded-full border border-border text-ink-2 hover:bg-surface-2 transition-colors disabled:opacity-30">
                        Return
                      </button>
                      <button onClick={() => void giveBack(m.user_id, m.full_name, true)} disabled={busy || !t.total}
                        title="Undo everything, including worked leads"
                        className="p-1.5 rounded-full border border-border text-faint hover:text-rose-600 hover:border-rose-200 transition-colors disabled:opacity-30">
                        <Undo2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <p className="text-[12px] text-muted mt-3 ml-1 leading-relaxed">
            <b className="font-medium text-ink-2">Assign</b> hands over the next oldest cold leads, skipping anything already given out today.
            <b className="font-medium text-ink-2"> Return</b> releases untouched ones.
            <b className="font-medium text-ink-2"> Undo</b> also rewinds worked leads to exactly how they were, so testing leaves no trace.
          </p>

          <div className="rounded-[14px] border border-border bg-surface-2 px-4 py-3.5 mt-5 flex gap-3 le-in">
            <Zap className="w-3.5 h-3.5 text-faint flex-shrink-0 mt-0.5" />
            <p className="text-[12px] text-muted leading-relaxed">
              Only leads at stage <b className="font-medium text-ink-2">Cold</b> with a phone number or email are assigned.
              Junk, Won, Invoice Sent and Mr Coming Soon are never touched. Hot leads stay with whoever has Hot leads switched on.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
