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

  const load = useCallback(async () => {
    if (!isAdmin) return;
    const supabase = createClient();
    const [{ data: r }, { data: h }] = await Promise.all([
      supabase.from('lead_queue_rules').select('*').eq('workspace_id', workspace.id),
      supabase.rpc('lead_pool_health', { p_workspace_id: workspace.id }),
    ]);
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

  const runNow = async () => {
    setGenerating(true);
    const supabase = createClient();
    const { data, error } = await supabase.rpc('generate_daily_queue', { p_workspace_id: workspace.id });
    if (error) toast.error(error.message);
    else toast.success(`${data ?? 0} leads assigned for today`);
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
        <button onClick={runNow} disabled={generating}
          className="text-[12.5px] font-bold px-4 py-2.5 rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-2">
          {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          Generate today&rsquo;s queues
        </button>
      </div>

      {loading ? (
        <div className="py-16 text-center text-[13px] text-muted"><Loader2 className="w-5 h-5 animate-spin inline mr-2" />Loading…</div>
      ) : (
        <>
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
