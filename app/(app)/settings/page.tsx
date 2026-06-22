'use client';

import { Suspense, useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useApp, type Member } from '@/components/shared/app-provider';
import { Modal } from '@/components/shared/modal';
import { createClient } from '@/lib/supabase/client';
import { cn, initials, avatarColor, timeAgo } from '@/lib/utils';
import { toast } from 'sonner';
import {
  User as UserIcon, Users, Bell, Database, AlertTriangle,
  Trash2, Eraser, Check, X as XIcon, Crown, Pencil,
  BellRing, Volume2, Sparkles, ShieldCheck, ShieldAlert, Pause, Play, UserCheck, UserX,
  Hourglass, PauseCircle, IndianRupee,
} from 'lucide-react';
import {
  getPrefs, setPrefs, requestBrowserPermission, getBrowserPermission, sendBrowserNotification, playAlertSound,
  type NotifPref,
} from '@/lib/notifications';
import { readCoo, writeCoo } from '@/lib/coo';

type Section = 'profile' | 'team' | 'notifications' | 'ai-coo' | 'permissions' | 'sample' | 'danger';

function SettingsInner() {
  const router = useRouter();
  const params = useSearchParams();
  const initial = (params.get('section') as Section) || 'profile';
  const [section, setSection] = useState<Section>(initial);
  const { members, role } = useApp();
  const pendingCount = members.filter((m) => m.status === 'pending').length;

  const NAV = [
    { id: 'profile' as const,       label: 'Profile & Workspace', icon: UserIcon },
    { id: 'team' as const,          label: 'Team',                icon: Users, badge: pendingCount > 0 ? pendingCount : undefined },
    { id: 'notifications' as const, label: 'Notifications',       icon: Bell },
    ...(role === 'admin' ? [{ id: 'ai-coo' as const, label: 'AI COO', icon: Sparkles }] : []),
    ...(role === 'admin' ? [{ id: 'permissions' as const, label: 'Permissions', icon: ShieldCheck }] : []),
    { id: 'sample' as const,        label: 'Sample data',         icon: Database },
    { id: 'danger' as const,        label: 'Danger zone',         icon: AlertTriangle },
  ];

  return (
    <div className="max-w-[1100px] mx-auto px-4 sm:px-6 lg:px-8 pt-5 sm:pt-7 pb-10 animate-pageIn">
      <div className="mb-6">
        <h1 className="text-[28px] font-bold tracking-tight leading-[1.1]">Settings</h1>
        <p className="text-[13.5px] text-muted mt-2">Manage your workspace, team, notifications, and data</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-6">
        <nav className="space-y-0.5 self-start md:sticky md:top-6">
          {NAV.map((n) => {
            const Icon = n.icon;
            const active = section === n.id;
            const danger = n.id === 'danger';
            return (
              <button
                key={n.id}
                onClick={() => { setSection(n.id); router.replace(`/settings?section=${n.id}`, { scroll: false }); }}
                className={cn(
                  'w-full flex items-center gap-2.5 px-3 py-2.5 rounded-md text-[13px] transition-all text-left',
                  active ? 'bg-surface-2 font-semibold text-ink' : 'text-ink-2 hover:bg-surface-2',
                  danger && active && 'text-danger-dark'
                )}
              >
                <Icon className="w-4 h-4" />
                <span className="flex-1">{n.label}</span>
                {n.badge && <span className="bg-danger text-white text-[10px] font-semibold px-1.5 py-0.5 rounded-full leading-none">{n.badge}</span>}
              </button>
            );
          })}
        </nav>

        <div>
          {section === 'profile' && <ProfileSection />}
          {section === 'team' && <TeamSection />}
          {section === 'notifications' && <NotificationsSection />}
          {section === 'ai-coo' && <CooSection />}
          {section === 'permissions' && <PermissionsSection />}
          {section === 'sample' && <SampleDataSection />}
          {section === 'danger' && <DangerSection />}
        </div>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<div className="p-10 text-muted text-sm">Loading…</div>}>
      <SettingsInner />
    </Suspense>
  );
}

// =========================================
// PROFILE & WORKSPACE
// =========================================
function ProfileSection() {
  const { user, workspace, role } = useApp();
  const supabase = useMemo(() => createClient(), []);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState(user.name);
  const [editingWs, setEditingWs] = useState(false);
  const [wsName, setWsName] = useState(workspace.name);
  const [busy, setBusy] = useState(false);

  useEffect(() => { setTheme((localStorage.getItem('migrizo-theme') as 'light' | 'dark') || 'light'); }, []);
  const applyTheme = (next: 'light' | 'dark') => {
    setTheme(next);
    document.documentElement.classList.toggle('dark', next === 'dark');
    localStorage.setItem('migrizo-theme', next);
  };

  const saveName = async () => {
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ data: { full_name: name.trim() } });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success('Name updated. Refresh to see it everywhere.');
    setEditingName(false);
  };

  const saveWsName = async () => {
    setBusy(true);
    const { error } = await supabase.rpc('update_workspace_name', { p_workspace_id: workspace.id, p_new_name: wsName.trim() });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success('Workspace renamed. Refresh to see it everywhere.');
    setEditingWs(false);
  };

  return (
    <div className="space-y-3">
      <Card title="Account">
        <Row label="Display name">
          {editingName ? (
            <div className="flex items-center gap-2">
              <input className="input py-1.5 px-2.5 text-[12.5px] w-48" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
              <button onClick={saveName} disabled={busy} className="btn btn-primary btn-sm">Save</button>
              <button onClick={() => { setEditingName(false); setName(user.name); }} className="btn btn-ghost btn-sm">Cancel</button>
            </div>
          ) : (
            <div className="flex items-center gap-2"><span className="font-medium">{user.name}</span><button onClick={() => setEditingName(true)} className="p-1 hover:bg-surface-2 rounded text-muted hover:text-ink"><Pencil className="w-3 h-3" /></button></div>
          )}
        </Row>
        <Row label="Email"><span className="font-medium">{user.email}</span></Row>
      </Card>

      <Card title="Workspace" subtitle="Shared by everyone on your team">
        <Row label="Workspace name">
          {editingWs && role === 'admin' ? (
            <div className="flex items-center gap-2">
              <input className="input py-1.5 px-2.5 text-[12.5px] w-56" value={wsName} onChange={(e) => setWsName(e.target.value)} autoFocus />
              <button onClick={saveWsName} disabled={busy} className="btn btn-primary btn-sm">Save</button>
              <button onClick={() => { setEditingWs(false); setWsName(workspace.name); }} className="btn btn-ghost btn-sm">Cancel</button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="font-medium">{workspace.name}</span>
              {role === 'admin' && <button onClick={() => setEditingWs(true)} className="p-1 hover:bg-surface-2 rounded text-muted hover:text-ink"><Pencil className="w-3 h-3" /></button>}
            </div>
          )}
        </Row>
        <Row label="Your role">
          <span className="chip" style={{
            background: role === 'admin' ? 'hsl(var(--indigo-soft))' : 'hsl(var(--surface-2))',
            color: role === 'admin' ? '#4338CA' : 'hsl(var(--muted))', border: 'none'
          }}>
            {role === 'admin' && <Crown className="w-3 h-3 mr-1 inline" />}{role}
          </span>
        </Row>
      </Card>

      <Card title="Appearance">
        <Row label="Theme">
          <div className="inline-flex items-center gap-1 p-1 rounded-md bg-surface-2">
            <button onClick={() => applyTheme('light')} className={cn('px-3 py-1.5 rounded text-[12.5px] font-medium', theme === 'light' && 'bg-surface shadow-sm')}>Light</button>
            <button onClick={() => applyTheme('dark')} className={cn('px-3 py-1.5 rounded text-[12.5px] font-medium', theme === 'dark' && 'bg-surface shadow-sm')}>Dark</button>
          </div>
        </Row>
      </Card>
    </div>
  );
}

// =========================================
// TEAM (approval-based)
// =========================================
function TeamSection() {
  const { workspace, role, user, members, refreshMembers, setMemberPaymentAccess } = useApp();
  const supabase = useMemo(() => createClient(), []);

  const pending = members.filter((m) => m.status === 'pending');
  const active = members.filter((m) => m.status === 'active');
  const paused = members.filter((m) => m.status === 'paused');

  const isAdmin = role === 'admin';

  const approve = async (m: Member) => {
    const { error } = await supabase.rpc('approve_member', { p_workspace_id: workspace.id, p_user_id: m.user_id });
    if (error) { toast.error(error.message); return; }
    toast.success(`${m.full_name} approved — they now have access`);
    refreshMembers();
  };

  const reject = async (m: Member) => {
    if (!confirm(`Reject ${m.full_name}'s access request? They will be removed from this workspace.`)) return;
    const { error } = await supabase.rpc('remove_workspace_member', { p_workspace_id: workspace.id, p_user_id: m.user_id });
    if (error) { toast.error(error.message); return; }
    toast.success('Request rejected');
    refreshMembers();
  };

  const pause = async (m: Member) => {
    if (!confirm(`Pause ${m.full_name}'s access? They will be signed out of the workspace until you resume.`)) return;
    const { error } = await supabase.rpc('pause_member', { p_workspace_id: workspace.id, p_user_id: m.user_id });
    if (error) { toast.error(error.message); return; }
    toast.success(`${m.full_name} paused`);
    refreshMembers();
  };

  const resume = async (m: Member) => {
    const { error } = await supabase.rpc('resume_member', { p_workspace_id: workspace.id, p_user_id: m.user_id });
    if (error) { toast.error(error.message); return; }
    toast.success(`${m.full_name} reinstated`);
    refreshMembers();
  };

  const remove = async (m: Member) => {
    if (!confirm(`Permanently remove ${m.full_name} from this workspace? Their account stays but they lose all access.`)) return;
    const { error } = await supabase.rpc('remove_workspace_member', { p_workspace_id: workspace.id, p_user_id: m.user_id });
    if (error) { toast.error(error.message); return; }
    toast.success(`${m.full_name} removed`);
    refreshMembers();
  };

  const changeRole = async (m: Member, newRole: 'admin' | 'member') => {
    const { error } = await supabase.rpc('change_member_role', { p_workspace_id: workspace.id, p_user_id: m.user_id, p_new_role: newRole });
    if (error) { toast.error(error.message); return; }
    toast.success(`${m.full_name} is now ${newRole}`);
    refreshMembers();
  };

  return (
    <div className="space-y-3">
      {/* Pending — ALWAYS visible with helpful empty state */}
      <Card
        title={pending.length > 0 ? `Pending approval · ${pending.length}` : 'Pending approval'}
        subtitle={pending.length > 0 ? 'New signups waiting for your approval' : 'When someone signs up for the CRM, they\'ll appear here for you to approve'}
      >
        {pending.length === 0 ? (
          <div className="py-8 px-4 text-center bg-surface-2 rounded-md">
            <div className="w-12 h-12 rounded-full bg-surface mx-auto mb-3 flex items-center justify-center">
              <Hourglass className="w-5 h-5 text-muted" />
            </div>
            <div className="text-[13px] font-medium text-ink-2 mb-1">No pending requests right now</div>
            <div className="text-[11.5px] text-muted leading-relaxed max-w-[400px] mx-auto">
              Share <span className="font-mono text-ink-2">{typeof window !== 'undefined' ? window.location.origin : ''}/login</span> with your team.
              Anyone who signs up will appear here for you to <span className="font-semibold text-ink-2">Approve</span> or <span className="font-semibold text-ink-2">Reject</span>.
            </div>
          </div>
        ) : (
          <div className="-mx-1">
            {pending.map((m) => (
              <MemberRow key={m.user_id} m={m} isOwner={false} isSelf={false} canManage={isAdmin}>
                {isAdmin && (
                  <>
                    <button onClick={() => approve(m)} className="btn btn-primary btn-sm"><UserCheck className="w-3.5 h-3.5" /> Approve</button>
                    <button onClick={() => reject(m)} className="btn btn-outline btn-sm" title="Reject and remove from workspace"><UserX className="w-3.5 h-3.5" /> Reject</button>
                  </>
                )}
              </MemberRow>
            ))}
          </div>
        )}
      </Card>

      {/* Active */}
      <Card title={`Active members · ${active.length}`} subtitle={pending.length === 0 ? "Everyone who currently has access" : "Currently approved with access"}>
        {active.length === 0 ? (
          <div className="py-6 text-center text-[12.5px] text-muted">No active members</div>
        ) : (
          <div className="-mx-1">
            {active.map((m) => {
              const isOwner = workspace.owner_id === m.user_id;
              const isSelf = user.id === m.user_id;
              return (
                <MemberRow key={m.user_id} m={m} isOwner={isOwner} isSelf={isSelf} canManage={isAdmin}>
                  {isAdmin && !isOwner && !isSelf && (
                    <>
                      {m.role !== 'admin' && (
                        <button
                          onClick={() => setMemberPaymentAccess(m.user_id, !m.can_view_payments)}
                          title={m.can_view_payments ? 'Click to hide payments from this member' : 'Click to let this member see payments'}
                          className="inline-flex items-center gap-1.5 text-[11.5px] py-1 px-2 rounded border transition"
                          style={m.can_view_payments
                            ? { background: 'hsl(var(--green-soft))', color: '#047857', borderColor: 'transparent' }
                            : { background: 'hsl(var(--surface-2))', color: 'hsl(var(--muted))', borderColor: 'hsl(var(--border))' }}
                        >
                          <IndianRupee className="w-3 h-3" />
                          {m.can_view_payments ? 'Payments: On' : 'Payments: Off'}
                        </button>
                      )}
                      <select className="text-[11.5px] py-1 px-2 rounded border border-border bg-surface" value={m.role} onChange={(e) => changeRole(m, e.target.value as 'admin' | 'member')}>
                        <option value="member">Member</option>
                        <option value="admin">Admin</option>
                      </select>
                      <button onClick={() => pause(m)} className="btn btn-outline btn-sm" title="Pause access"><Pause className="w-3.5 h-3.5" /></button>
                      <button onClick={() => remove(m)} className="p-1.5 rounded hover:bg-surface-2 text-muted hover:text-danger" title="Remove from workspace"><Trash2 className="w-3.5 h-3.5" /></button>
                    </>
                  )}
                </MemberRow>
              );
            })}
          </div>
        )}
      </Card>

      {/* Paused */}
      {paused.length > 0 && (
        <Card title={`Paused · ${paused.length}`} subtitle="Access temporarily revoked">
          <div className="-mx-1">
            {paused.map((m) => (
              <MemberRow key={m.user_id} m={m} isOwner={false} isSelf={user.id === m.user_id} canManage={isAdmin}>
                {isAdmin && (
                  <>
                    <button onClick={() => resume(m)} className="btn btn-primary btn-sm"><Play className="w-3.5 h-3.5" /> Resume</button>
                    <button onClick={() => remove(m)} className="p-1.5 rounded hover:bg-surface-2 text-muted hover:text-danger" title="Remove"><Trash2 className="w-3.5 h-3.5" /></button>
                  </>
                )}
              </MemberRow>
            ))}
          </div>
        </Card>
      )}

      {!isAdmin && (
        <div className="rounded-xl border border-border bg-surface-2 p-3.5 flex items-start gap-2.5 text-[12.5px] text-muted">
          <ShieldAlert className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <div>Only the workspace admin can approve new members or change access. Ask <strong className="text-ink-2">{members.find((m) => m.user_id === workspace.owner_id)?.full_name || 'your admin'}</strong> if you need access changes.</div>
        </div>
      )}

      {isAdmin && (
        <div className="rounded-xl border border-border bg-surface-2 p-3.5 flex items-start gap-2.5 text-[12.5px] text-muted">
          <ShieldCheck className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <div>
            <strong className="text-ink-2 block mb-0.5">Anyone can sign up — but they're pending until you approve.</strong>
            New people sign up at <span className="font-mono text-ink-2">{typeof window !== 'undefined' ? window.location.origin : ''}/login</span>. They land on a "Waiting for approval" screen until you click <strong>Approve</strong> above. You can pause or remove anyone anytime.
          </div>
        </div>
      )}
    </div>
  );
}

function MemberRow({ m, isOwner, isSelf, children }: { m: Member; isOwner: boolean; isSelf: boolean; canManage: boolean; children?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-1 py-2.5 border-b border-border last:border-0">
      <div className="av" style={{ background: avatarColor(m.user_id), width: 32, height: 32, fontSize: 12 }}>{initials(m.full_name)}</div>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-medium flex items-center gap-1.5">
          {m.full_name}
          {isSelf && <span className="text-[10px] text-muted font-normal">(you)</span>}
        </div>
        <div className="text-[11.5px] text-muted truncate">{m.email} · joined {timeAgo(m.joined_at)}</div>
      </div>
      <span className="chip" style={{
        background: m.status === 'pending' ? 'hsl(var(--amber-soft))'
          : m.status === 'paused' ? 'hsl(var(--surface-2))'
          : m.role === 'admin' ? 'hsl(var(--indigo-soft))' : 'hsl(var(--green-soft))',
        color: m.status === 'pending' ? '#B45309'
          : m.status === 'paused' ? 'hsl(var(--muted))'
          : m.role === 'admin' ? '#4338CA' : '#047857',
        border: 'none'
      }}>
        {isOwner ? <><Crown className="w-3 h-3 mr-1 inline" />Owner</>
          : m.status === 'pending' ? <><Hourglass className="w-3 h-3 mr-1 inline" />Pending</>
          : m.status === 'paused' ? <><PauseCircle className="w-3 h-3 mr-1 inline" />Paused</>
          : m.role}
      </span>
      <div className="flex items-center gap-1">{children}</div>
    </div>
  );
}

// =========================================
// NOTIFICATIONS
// =========================================
function NotificationsSection() {
  const [prefs, setLocalPrefs] = useState<NotifPref>(getPrefs());
  const [browserPerm, setBrowserPerm] = useState<NotificationPermission | 'unsupported'>('default');

  useEffect(() => {
    setLocalPrefs(getPrefs());
    setBrowserPerm(getBrowserPermission());
  }, []);

  const update = (patch: Partial<NotifPref>) => {
    const next = setPrefs(patch);
    setLocalPrefs(next);
  };

  const requestPerm = async () => {
    const result = await requestBrowserPermission();
    setBrowserPerm(result);
    if (result === 'granted') {
      update({ browserEnabled: true });
      toast.success('Browser notifications enabled');
      setTimeout(() => sendBrowserNotification('Notifications enabled', 'You\'ll get alerts here when leads need follow-up.', { tag: 'welcome' }), 500);
    } else if (result === 'denied') {
      toast.error('Notifications blocked. Enable them in your browser site settings.');
    }
  };

  const test = () => {
    if (browserPerm === 'granted' && prefs.browserEnabled) sendBrowserNotification('Test notification', 'This is what overdue follow-up alerts look like.', { tag: 'test' });
    if (prefs.soundEnabled) playAlertSound();
    toast.success('Test fired — check for the browser alert + sound');
  };

  return (
    <div className="space-y-3">
      <Card title="Browser notifications" subtitle="Pop-up alerts even when this tab isn't focused">
        <Row label="Permission">
          {browserPerm === 'unsupported' ? <span className="text-[12.5px] text-muted">Not supported by this browser</span>
            : browserPerm === 'granted' ? <span className="chip" style={{ background: 'hsl(var(--green-soft))', color: '#047857', border: 'none' }}><Check className="w-3 h-3 mr-1 inline" />Allowed</span>
            : browserPerm === 'denied' ? <span className="text-[12.5px] text-danger">Blocked — change in browser site settings</span>
            : <button onClick={requestPerm} className="btn btn-primary btn-sm"><BellRing className="w-3.5 h-3.5" /> Enable notifications</button>}
        </Row>
        <Row label="Show desktop alerts"><Toggle on={prefs.browserEnabled && browserPerm === 'granted'} disabled={browserPerm !== 'granted'} onChange={(v) => update({ browserEnabled: v })} /></Row>
        <Row label="Sound on alert"><Toggle on={prefs.soundEnabled} onChange={(v) => update({ soundEnabled: v })} /></Row>
        <Row label=" ">
          <button onClick={test} className="btn btn-outline btn-sm"><Volume2 className="w-3.5 h-3.5" /> Send test notification</button>
        </Row>
      </Card>

      <Card title="Alert me about">
        <Row label="Overdue follow-ups"><Toggle on={prefs.overdueFollowups} onChange={(v) => update({ overdueFollowups: v })} /></Row>
        <Row label="Today's follow-ups"><Toggle on={prefs.followupsToday} onChange={(v) => update({ followupsToday: v })} /></Row>
        <Row label="Overdue payments"><Toggle on={prefs.paymentOverdue} onChange={(v) => update({ paymentOverdue: v })} /></Row>
        <Row label="Hot leads going stale"><Toggle on={prefs.hotLeadStale} onChange={(v) => update({ hotLeadStale: v })} /></Row>
      </Card>
    </div>
  );
}

// =========================================
// SAMPLE DATA
// =========================================
function SampleDataSection() {
  const { leads, loadSampleData, resetWorkspace, role } = useApp();
  const sampleCount = leads.filter((l) => l.is_sample).length;
  return (
    <div className="space-y-3">
      <Card title="Sample data" subtitle="Populate your workspace with realistic demo leads to explore the CRM">
        <Row label="Load 25 demo leads">
          <button onClick={() => loadSampleData()} className="btn btn-outline btn-sm">Load sample data</button>
        </Row>
        {sampleCount > 0 && (
          <Row label={`${sampleCount} sample leads loaded`}>
            <button onClick={async () => { if (confirm('Clear all sample leads?')) await resetWorkspace(true); }} disabled={role !== 'admin'} className="btn btn-outline btn-sm disabled:opacity-50">
              <Eraser className="w-3.5 h-3.5" /> Clear samples
            </button>
          </Row>
        )}
      </Card>
    </div>
  );
}

// =========================================
// DANGER ZONE
// =========================================
function DangerSection() {
  const router = useRouter();
  const { workspace, role, leads, resetWorkspace } = useApp();
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);

  const confirmReset = async () => {
    setBusy(true);
    await resetWorkspace(false);
    setBusy(false);
    setOpen(false);
    setConfirmText('');
    router.push('/dashboard');
  };

  return (
    <div className="space-y-3">
      <div className="panel" style={{ borderColor: '#FCC7C7' }}>
        <div className="panel-pad border-b border-border">
          <h2 className="text-[15px] font-semibold text-danger-dark">Danger zone</h2>
          <p className="text-[12.5px] text-muted mt-1">Irreversible actions. Be careful.</p>
        </div>
        <div className="panel-pad">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <div className="text-[13.5px] font-medium">Reset entire workspace</div>
              <div className="text-[12px] text-muted mt-0.5">Permanently delete <span className="num font-semibold">{leads.length}</span> leads, all payments, notes, and activity</div>
            </div>
            <button onClick={() => setOpen(true)} disabled={role !== 'admin'} className="btn btn-danger disabled:opacity-50" title={role !== 'admin' ? 'Admin only' : ''}>
              <Trash2 className="w-3.5 h-3.5" /> Reset workspace
            </button>
          </div>
          {role !== 'admin' && <div className="mt-3 text-[11.5px] text-muted">Only the workspace admin can reset data</div>}
        </div>
      </div>

      <Modal open={open} onClose={() => { setOpen(false); setConfirmText(''); }}
        title="Reset entire workspace?"
        subtitle="This will permanently delete all leads, payments, notes, and activity. Cannot be undone."
        size="sm"
        footer={<>
          <button onClick={() => { setOpen(false); setConfirmText(''); }} className="btn btn-ghost">Cancel</button>
          <button onClick={confirmReset} disabled={busy || confirmText !== 'RESET'} className="btn btn-danger disabled:opacity-50">
            {busy ? 'Deleting…' : 'Yes, reset everything'}
          </button>
        </>}
      >
        <div className="space-y-4">
          <div className="rounded-md p-3.5 flex gap-2.5" style={{ background: 'hsl(var(--rose-soft))' }}>
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: '#B91C1C' }} />
            <div className="text-[12.5px] leading-relaxed" style={{ color: '#B91C1C' }}>
              You will lose <strong className="num">{leads.length}</strong> leads and all associated history. Team members stay, only data inside <strong>{workspace.name}</strong> is removed.
            </div>
          </div>
          <div>
            <label className="input-label">Type <span className="font-mono font-semibold">RESET</span> to confirm</label>
            <input className="input" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder="RESET" autoFocus />
          </div>
        </div>
      </Modal>
    </div>
  );
}

// =========================================
// SHARED PRIMITIVES
// =========================================
function Card({ title, subtitle, action, children }: { title: string; subtitle?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="panel">
      <div className="panel-pad border-b border-border flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold">{title}</h2>
          {subtitle && <p className="text-[12.5px] text-muted mt-1">{subtitle}</p>}
        </div>
        {action && <div className="flex-shrink-0">{action}</div>}
      </div>
      <div className="panel-pad">{children}</div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[140px_1fr] items-center py-2 border-b border-border last:border-0 gap-3">
      <span className="text-[12.5px] text-muted">{label}</span>
      <div className="min-w-0 text-[13px]">{children}</div>
    </div>
  );
}

function Toggle({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      onClick={() => !disabled && onChange(!on)}
      disabled={disabled}
      className={cn(
        'relative inline-flex h-[26px] w-[46px] flex-shrink-0 rounded-full transition-all duration-200 ease-out',
        'focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:ring-offset-2',
        disabled && 'opacity-40 cursor-not-allowed'
      )}
      style={{
        background: on && !disabled
          ? 'linear-gradient(135deg, #6366F1 0%, #4F46E5 100%)'
          : 'hsl(var(--surface-2))',
        boxShadow: on && !disabled ? '0 1px 3px rgba(79,70,229,.35), inset 0 1px 0 rgba(255,255,255,.18)' : 'inset 0 1px 2px rgba(0,0,0,.05)',
      }}
    >
      <span
        className="absolute top-[3px] left-[3px] inline-flex h-5 w-5 items-center justify-center rounded-full bg-white transition-transform duration-200 ease-out"
        style={{
          transform: on ? 'translateX(20px)' : 'translateX(0)',
          boxShadow: '0 2px 6px rgba(0,0,0,.18), 0 0 0 0.5px rgba(0,0,0,.05)',
        }}
      />
    </button>
  );
}

// ===== AI COO settings (admin only) =====
function CooSection() {
  const [s, setS] = useState(() => readCoo());
  const update = (patch: Partial<typeof s>) => { const next = { ...s, ...patch }; setS(next); writeCoo(next); };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-[17px] font-semibold flex items-center gap-2"><Sparkles className="w-4 h-4 text-indigo-600" /> AI COO</h2>
        <p className="text-[13px] text-muted mt-1">A spoken briefing and banner that greets you when you open the CRM \u2014 your last conversion and this month\u2019s tally. Only you (the owner) see and control this.</p>
      </div>

      <div className="panel divide-y divide-border">
        <CooToggle
          label="AI COO briefing"
          desc="Show the briefing banner at the top of the CRM."
          on={s.enabled}
          onClick={() => update({ enabled: !s.enabled })}
        />
        <CooToggle
          label="Voice on open"
          desc="Speak the briefing aloud once when you open the CRM."
          on={s.enabled && s.voice}
          disabled={!s.enabled}
          onClick={() => update({ voice: !s.voice })}
        />
      </div>

      <p className="text-[12px] text-muted">Tip: switch the briefing off to disable both the banner and the voice. Your choice is saved on this device.</p>
    </div>
  );
}

function CooToggle({ label, desc, on, onClick, disabled }: { label: string; desc: string; on: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <div className={cn('flex items-center justify-between gap-4 px-5 py-4', disabled && 'opacity-50')}>
      <div className="min-w-0">
        <div className="text-[13.5px] font-medium">{label}</div>
        <div className="text-[12px] text-muted mt-0.5">{desc}</div>
      </div>
      <button
        onClick={onClick}
        disabled={disabled}
        role="switch"
        aria-checked={on}
        className="relative w-11 h-6 rounded-full transition-colors flex-shrink-0 disabled:cursor-not-allowed"
        style={{ background: on ? '#4F46E5' : 'hsl(var(--border-strong))' }}
      >
        <span className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform" style={{ transform: on ? 'translateX(20px)' : 'translateX(0)' }} />
      </button>
    </div>
  );
}

// ===== Permissions (admin only) =====
function PermissionsSection() {
  const { workspace } = useApp();
  const [on, setOn] = useState(!!workspace.allow_member_task_edit);
  const [busy, setBusy] = useState(false);
  const supabase = createClient();

  const toggle = async () => {
    const next = !on;
    setOn(next); setBusy(true);
    const { error } = await supabase.from('workspaces').update({ allow_member_task_edit: next }).eq('id', workspace.id);
    setBusy(false);
    if (error) { setOn(!next); toast.error(`Couldn't save: ${error.message}`); }
    else toast.success(next ? 'Employees can now edit case tasks' : 'Task editing is now admin-only');
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-[17px] font-semibold flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-indigo-600" /> Permissions</h2>
        <p className="text-[13px] text-muted mt-1">Control what your team can do. Admins and owners always have full access.</p>
      </div>
      <div className="panel divide-y divide-border">
        <CooToggle
          label="Let employees edit case tasks"
          desc="Allow non-admin members to rename, add and delete tasks inside a case journey. Off by default — only owners/admins can edit tasks."
          on={on}
          disabled={busy}
          onClick={toggle}
        />
      </div>
      <p className="text-[12px] text-muted">Editing changes tasks for that one client only; it never affects other cases or the default journey.</p>
    </div>
  );
}
