'use client';

// =============================================================================
// TEAM ACTIVITY — admin-only dashboard.
//
// Shows, per person: active hours today (or any past day), which sections that
// time went into, when they started, and when they were last seen.
//
// "Active" means the CRM was open AND they were interacting with it. Idle time
// and background tabs are never counted — see components/shared/activity-heartbeat.
// =============================================================================
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useApp } from '@/components/shared/app-provider';
import { createClient } from '@/lib/supabase/client';
import { Loader2, Clock, ChevronLeft, ChevronRight, Users, Info, RefreshCw } from 'lucide-react';
import { initials, avatarColor } from '@/lib/utils';

interface DayRow {
  user_id: string;
  active_minutes: number;
  first_seen: string | null;
  last_seen: string | null;
  by_section: Record<string, number>;
}

const SECTION_LABEL: Record<string, string> = {
  dashboard: 'Dashboard', leads: 'Leads', pipeline: 'Pipeline', cases: 'Cases',
  payments: 'Payments', meetings: 'Meetings', learning: 'Learning',
  settings: 'Settings', ai: 'AI COO', 'daily-tracker': 'Daily tracker', 'follow-ups': 'Follow-ups', campaigns: 'Campaigns', 'team-activity': 'Team activity', other: 'Other',
};
const SECTION_COLOR: Record<string, string> = {
  leads: '#4F46E5', cases: '#EC4899', payments: '#10B981', meetings: '#F59E0B',
  pipeline: '#8B5CF6', learning: '#06B6D4', dashboard: '#6366F1', settings: '#6B7280',
  ai: '#F472B6', 'daily-tracker': '#14B8A6', 'follow-ups': '#F97316', campaigns: '#A855F7', 'team-activity': '#64748B', other: '#94A3B8',
};

const fmtMins = (m: number) => {
  if (!m) return '0m';
  const h = Math.floor(m / 60), mm = m % 60;
  return h ? `${h}h ${mm.toString().padStart(2, '0')}m` : `${mm}m`;
};
const fmtTime = (s: string | null) => s ? new Date(s).toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit' }) : '—';
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export default function ActivityPage() {
  const { workspace, role, members } = useApp() as ReturnType<typeof useApp> & {
    workspace: { id: string }; role: string;
    members: { user_id: string; full_name: string; email: string; role: string; status: string }[];
  };
  const isAdmin = role === 'admin';

  const [offset, setOffset] = useState(0);      // 0 = today, 1 = yesterday…
  const [rows, setRows] = useState<DayRow[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const day = useMemo(() => { const d = new Date(); d.setDate(d.getDate() - offset); return d; }, [offset]);
  const isToday = offset === 0;

  const load = useCallback(async () => {
    if (!isAdmin) return;
    setRefreshing(true);
    const supabase = createClient();
    if (isToday) {
      // Today isn't rolled up yet — read the live view.
      const { data } = await supabase.rpc('activity_today', { p_workspace_id: workspace.id });
      setRows((data as DayRow[]) || []);
    } else {
      const { data } = await supabase
        .from('activity_days')
        .select('user_id, active_minutes, first_seen, last_seen, by_section')
        .eq('workspace_id', workspace.id)
        .eq('day', ymd(day));
      setRows((data as DayRow[]) || []);
    }
    setRefreshing(false);
  }, [isAdmin, isToday, workspace.id, day]);

  useEffect(() => { void load(); }, [load]);

  // Self-maintaining: on first open, fold any un-rolled past days into the
  // summary table (and purge their raw pings). Cheap, idempotent, no cron.
  useEffect(() => {
    if (!isAdmin) return;
    const supabase = createClient();
    void supabase.rpc('rollup_pending').then(() => { /* silent housekeeping */ });
  }, [isAdmin]);

  // Live-ish: refresh today's numbers every 60s while the page is open.
  useEffect(() => {
    if (!isToday) return;
    const t = setInterval(() => { void load(); }, 60_000);
    return () => clearInterval(t);
  }, [isToday, load]);

  if (!isAdmin) {
    return (
      <div className="max-w-[900px] mx-auto px-6 py-20 text-center">
        <Users className="w-8 h-8 mx-auto text-faint mb-3" />
        <div className="text-[15px] font-semibold">Admins only</div>
        <div className="text-[13px] text-muted mt-1">This page is visible to workspace admins.</div>
      </div>
    );
  }

  const byUser = new Map((rows || []).map((r) => [r.user_id, r]));
  const activeMembers = (members || []).filter((m) => m.status === 'active');
  const ranked = [...activeMembers].sort((a, b) => (byUser.get(b.user_id)?.active_minutes || 0) - (byUser.get(a.user_id)?.active_minutes || 0));
  const teamTotal = (rows || []).reduce((s, r) => s + r.active_minutes, 0);
  const now = Date.now();

  return (
    <div className="max-w-[1000px] mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {/* header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight flex items-center gap-2.5">
            <span className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-700 flex items-center justify-center"><Clock className="w-4 h-4" /></span>
            Team Activity
          </h1>
          <p className="text-[13px] text-muted mt-1">Active time in the CRM, by person and section. Only admins can see this page.</p>
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={() => setOffset((o) => o + 1)} className="p-2 rounded-lg border border-border hover:bg-surface-2 text-muted" title="Previous day"><ChevronLeft className="w-4 h-4" /></button>
          <span className="text-[12.5px] font-semibold px-2 min-w-[104px] text-center">
            {isToday ? 'Today' : day.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
          </span>
          <button onClick={() => setOffset((o) => Math.max(0, o - 1))} disabled={isToday} className="p-2 rounded-lg border border-border hover:bg-surface-2 text-muted disabled:opacity-30" title="Next day"><ChevronRight className="w-4 h-4" /></button>
          <button onClick={() => void load()} className="p-2 rounded-lg border border-border hover:bg-surface-2 text-muted ml-1" title="Refresh">
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* team total */}
      <div className="mt-5 rounded-2xl p-5 text-white relative overflow-hidden" style={{ background: 'linear-gradient(135deg,#4F46E5,#6366F1)' }}>
        <div className="absolute -right-8 -top-10 w-40 h-40 rounded-full" style={{ background: 'rgba(255,255,255,.08)' }} />
        <div className="relative flex items-end gap-8 flex-wrap">
          <div>
            <div className="text-[32px] font-extrabold leading-none tracking-tight">{fmtMins(teamTotal)}</div>
            <div className="text-[11.5px] opacity-85 mt-1.5">total active time {isToday ? 'today' : 'that day'}</div>
          </div>
          <div className="pl-8 border-l border-white/20">
            <div className="text-[32px] font-extrabold leading-none tracking-tight">{(rows || []).length}</div>
            <div className="text-[11.5px] opacity-85 mt-1.5">of {activeMembers.length} people active</div>
          </div>
        </div>
      </div>

      {/* people */}
      {rows === null ? (
        <div className="py-16 text-center text-[13px] text-muted"><Loader2 className="w-5 h-5 animate-spin inline mr-2" />Loading…</div>
      ) : (
        <div className="mt-4 space-y-2.5">
          {ranked.map((m) => {
            const r = byUser.get(m.user_id);
            const mins = r?.active_minutes || 0;
            const secs = Object.entries(r?.by_section || {}).sort((a, b) => b[1] - a[1]);
            const online = isToday && r?.last_seen ? (now - new Date(r.last_seen).getTime()) < 3 * 60_000 : false;
            const pct = teamTotal ? Math.round((mins / teamTotal) * 100) : 0;

            return (
              <div key={m.user_id} className="rounded-2xl border border-border bg-surface p-4">
                <div className="flex items-center gap-3">
                  <div className="relative flex-shrink-0">
                    <div className="av" style={{ background: avatarColor(m.user_id), width: 36, height: 36, fontSize: 13 }}>{initials(m.full_name)}</div>
                    {online && <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-500 border-2 border-white" title="Active now" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[14px] font-semibold truncate">{m.full_name}</span>
                      {m.role === 'admin' && <span className="text-[9.5px] font-bold px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700">ADMIN</span>}
                      {online && <span className="text-[10px] font-bold text-emerald-600">● ACTIVE NOW</span>}
                    </div>
                    <div className="text-[11.5px] text-muted mt-0.5">
                      {mins > 0 ? <>Started {fmtTime(r?.first_seen || null)} · last seen {fmtTime(r?.last_seen || null)}</> : 'No activity recorded'}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="text-[18px] font-extrabold tracking-tight num">{fmtMins(mins)}</div>
                    <div className="text-[10.5px] text-faint">{pct}% of team</div>
                  </div>
                </div>

                {/* section split */}
                {secs.length > 0 && (
                  <>
                    <div className="flex h-2 rounded-full overflow-hidden mt-3 bg-surface-2">
                      {secs.map(([k, v]) => (
                        <div key={k} title={`${SECTION_LABEL[k] || k} · ${fmtMins(v)}`}
                          style={{ width: `${(v / mins) * 100}%`, background: SECTION_COLOR[k] || '#94A3B8' }} />
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2.5">
                      {secs.map(([k, v]) => (
                        <span key={k} className="text-[11px] text-muted flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full" style={{ background: SECTION_COLOR[k] || '#94A3B8' }} />
                          {SECTION_LABEL[k] || k} <b className="text-ink-2 font-semibold">{fmtMins(v)}</b>
                        </span>
                      ))}
                    </div>
                  </>
                )}
              </div>
            );
          })}

          {ranked.length === 0 && (
            <div className="py-16 text-center text-[13px] text-muted">No active team members yet.</div>
          )}
        </div>
      )}

      {/* honest note */}
      <div className="mt-5 rounded-xl border border-border bg-surface-2 p-4 flex gap-3">
        <Info className="w-4 h-4 text-muted flex-shrink-0 mt-0.5" />
        <div className="text-[11.5px] text-muted leading-relaxed">
          <b className="text-ink-2">What this measures.</b> Time when the CRM was open <i>and</i> being used — moving, typing, clicking. If there&rsquo;s no input for 5 minutes, or the tab is in the background, the clock stops. Work done outside the CRM (calls, email, documents) isn&rsquo;t counted, so read this as an engagement signal rather than a full record of someone&rsquo;s day. History is kept for 90 days.
        </div>
      </div>
    </div>
  );
}
