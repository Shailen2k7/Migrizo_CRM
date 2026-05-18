'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/components/shared/app-provider';
import { Modal } from '@/components/shared/modal';
import { formatINRFull, cn } from '@/lib/utils';
import { Trash2, Eraser, AlertTriangle } from 'lucide-react';

export default function SettingsPage() {
  const router = useRouter();
  const { user, workspace, role, leads, payments, resetWorkspace, loadSampleData } = useApp();
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [resetOpen, setResetOpen] = useState(false);
  const [resetConfirm, setResetConfirm] = useState('');
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    const t = (localStorage.getItem('migrizo-theme') as 'light' | 'dark') || 'light';
    setTheme(t);
  }, []);

  const applyTheme = (next: 'light' | 'dark') => {
    setTheme(next);
    document.documentElement.classList.toggle('dark', next === 'dark');
    localStorage.setItem('migrizo-theme', next);
  };

  const totalRevenue = payments.filter((p) => p.status === 'paid').reduce((s, p) => s + p.amount, 0);

  const confirmReset = async () => {
    setResetting(true);
    await resetWorkspace(false);
    setResetting(false);
    setResetOpen(false);
    setResetConfirm('');
    router.push('/dashboard');
  };

  return (
    <div className="max-w-[920px] mx-auto px-8 pt-7 pb-10 animate-pageIn">
      <div className="mb-7">
        <h1 className="text-[28px] font-bold tracking-tight leading-[1.1]">Settings</h1>
        <p className="text-[13.5px] text-muted mt-2">Manage your workspace, data, and preferences</p>
      </div>

      {/* Profile */}
      <div className="panel mb-3">
        <div className="panel-pad border-b border-border"><h2 className="text-[15px] font-semibold">Account</h2></div>
        <div className="panel-pad space-y-2 text-[13px]">
          <Row label="Email"><span className="font-medium">{user.email}</span></Row>
          <Row label="Display name"><span className="font-medium">{user.name}</span></Row>
          <Row label="Workspace"><span className="font-medium">{workspace.name}</span></Row>
          <Row label="Role"><span className={cn('chip', role === 'admin' ? 'bg-indigo-soft' : 'bg-surface-2')} style={{ background: role === 'admin' ? 'hsl(var(--indigo-soft))' : 'hsl(var(--surface-2))', color: role === 'admin' ? '#4338CA' : 'hsl(var(--muted))', border: 'none' }}>{role}</span></Row>
        </div>
      </div>

      {/* Appearance */}
      <div className="panel mb-3">
        <div className="panel-pad border-b border-border">
          <h2 className="text-[15px] font-semibold">Appearance</h2>
          <p className="text-[12.5px] text-muted mt-1">Customize how Migrizo looks</p>
        </div>
        <div className="panel-pad flex items-center justify-between">
          <div>
            <div className="text-[13.5px] font-medium">Theme</div>
            <div className="text-[12px] text-muted mt-0.5">Switch between light and dark mode</div>
          </div>
          <div className="flex items-center gap-1 p-1 rounded-md bg-surface-2">
            <button onClick={() => applyTheme('light')} className={cn('px-3 py-1.5 rounded text-[12.5px] font-medium', theme === 'light' && 'bg-surface shadow-sm')}>Light</button>
            <button onClick={() => applyTheme('dark')} className={cn('px-3 py-1.5 rounded text-[12.5px] font-medium', theme === 'dark' && 'bg-surface shadow-sm')}>Dark</button>
          </div>
        </div>
      </div>

      {/* Sample data */}
      <div className="panel mb-3">
        <div className="panel-pad border-b border-border">
          <h2 className="text-[15px] font-semibold">Sample data</h2>
          <p className="text-[12.5px] text-muted mt-1">Populate your workspace with realistic demo leads to explore the CRM</p>
        </div>
        <div className="panel-pad flex items-center justify-between">
          <div>
            <div className="text-[13.5px] font-medium">Load 25 demo leads</div>
            <div className="text-[12px] text-muted mt-0.5">Realistic visa-consultancy leads across all stages — flagged as samples so you can clear them later</div>
          </div>
          <button onClick={async () => { await loadSampleData(); }} className="btn btn-outline">
            Load sample data
          </button>
        </div>
      </div>

      {/* Danger zone */}
      <div className="panel mb-3" style={{ borderColor: '#FCC7C7' }}>
        <div className="panel-pad border-b border-border">
          <h2 className="text-[15px] font-semibold text-danger-dark">Danger zone</h2>
          <p className="text-[12.5px] text-muted mt-1">Irreversible actions. Be careful.</p>
        </div>
        <div className="panel-pad">
          <div className="flex items-center justify-between mb-3 pb-3 border-b border-border">
            <div>
              <div className="text-[13.5px] font-medium">Delete all dummy / prefilled data</div>
              <div className="text-[12px] text-muted mt-0.5">Remove sample leads, payments, and notes — keep your real imported data intact</div>
            </div>
            <button onClick={async () => { await resetWorkspace(true); }} disabled={role !== 'admin'} className="btn btn-outline disabled:opacity-50" title={role !== 'admin' ? 'Admin only' : ''}>
              <Eraser className="w-3.5 h-3.5" /> Clear samples
            </button>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[13.5px] font-medium">Reset entire workspace</div>
              <div className="text-[12px] text-muted mt-0.5">Permanently delete <span className="num font-semibold">{leads.length}</span> leads, all payments, notes, and activity</div>
            </div>
            <button onClick={() => setResetOpen(true)} disabled={role !== 'admin'} className="btn btn-danger disabled:opacity-50" title={role !== 'admin' ? 'Admin only' : ''}>
              <Trash2 className="w-3.5 h-3.5" /> Reset workspace
            </button>
          </div>
          {role !== 'admin' && <div className="mt-3 text-[11.5px] text-muted">Only workspace admins can reset data</div>}
        </div>
      </div>

      {/* About */}
      <div className="panel">
        <div className="panel-pad border-b border-border"><h2 className="text-[15px] font-semibold">About</h2></div>
        <div className="panel-pad space-y-2 text-[13px]">
          <Row label="Total leads"><span className="num font-medium">{leads.length}</span></Row>
          <Row label="Total revenue tracked"><span className="num font-medium">{formatINRFull(totalRevenue)}</span></Row>
          <Row label="Build"><span className="font-medium">v1.0 · Supabase + Next.js 15</span></Row>
        </div>
      </div>

      {/* Reset confirmation modal */}
      <Modal
        open={resetOpen}
        onClose={() => { setResetOpen(false); setResetConfirm(''); }}
        title="Reset entire workspace?"
        subtitle="This will permanently delete all leads, payments, notes, and activity. Cannot be undone."
        size="sm"
        footer={<>
          <button onClick={() => { setResetOpen(false); setResetConfirm(''); }} className="btn btn-ghost">Cancel</button>
          <button onClick={confirmReset} disabled={resetting || resetConfirm !== 'RESET'} className="btn btn-danger disabled:opacity-50">
            {resetting ? 'Deleting…' : 'Yes, reset everything'}
          </button>
        </>}
      >
        <div className="space-y-4">
          <div className="rounded-md p-3.5 flex gap-2.5" style={{ background: 'hsl(var(--rose-soft))' }}>
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: '#B91C1C' }} />
            <div className="text-[12.5px] leading-relaxed" style={{ color: '#B91C1C' }}>
              You will lose <strong className="num">{leads.length}</strong> leads and all associated history. Your account stays intact — only data inside this workspace is removed.
            </div>
          </div>
          <div>
            <label className="input-label">Type <span className="font-mono font-semibold">RESET</span> to confirm</label>
            <input className="input" value={resetConfirm} onChange={(e) => setResetConfirm(e.target.value)} placeholder="RESET" autoFocus />
          </div>
        </div>
      </Modal>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex justify-between"><span className="text-muted">{label}</span>{children}</div>;
}
