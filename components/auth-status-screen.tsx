'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Hourglass, PauseCircle, LogOut, RefreshCw } from 'lucide-react';

interface Props {
  status: 'pending' | 'paused';
  userEmail: string;
  userName: string;
}

export function AuthStatusScreen({ status, userEmail, userName }: Props) {
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  const [polling, setPolling] = useState(true);
  const [checking, setChecking] = useState(false);

  // Poll every 10 seconds for status change
  useEffect(() => {
    if (!polling) return;
    const check = async () => {
      setChecking(true);
      const { data } = await supabase.rpc('my_membership');
      setChecking(false);
      const m = Array.isArray(data) && data.length > 0 ? data[0] : null;
      if (m && m.status === 'active') {
        // Approved! Refresh server data and navigate to dashboard
        router.refresh();
      } else if (m && m.status !== status) {
        // Status changed (pending → paused or vice versa) — refresh to render the new screen
        router.refresh();
      }
    };
    const interval = setInterval(check, 10000);
    return () => clearInterval(interval);
  }, [polling, supabase, router, status]);

  const manualCheck = async () => {
    setChecking(true);
    const { data } = await supabase.rpc('my_membership');
    setChecking(false);
    const m = Array.isArray(data) && data.length > 0 ? data[0] : null;
    if (m && m.status === 'active') {
      router.refresh();
    }
  };

  const signOut = async () => {
    setPolling(false);
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  };

  const isPending = status === 'pending';
  const Icon = isPending ? Hourglass : PauseCircle;
  const title = isPending ? 'Waiting for approval' : 'Access paused';
  const accent = isPending ? '#F59E0B' : '#7A7A82';
  const accentBg = isPending ? 'hsl(var(--amber-soft))' : 'hsl(var(--surface-2))';

  return (
    <div className="min-h-screen flex items-center justify-center px-6 py-12" style={{ background: 'hsl(var(--bg))' }}>
      <div className="w-full max-w-[460px]">
        {/* Brand */}
        <div className="flex items-center justify-center gap-2.5 mb-8">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold text-base" style={{ background: '#4F46E5' }}>M</div>
          <div className="text-xl font-bold tracking-tight">Migrizo</div>
        </div>

        <div className="panel p-8 text-center">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-5" style={{ background: accentBg, color: accent }}>
            <Icon className="w-8 h-8" />
          </div>

          <h1 className="text-[22px] font-bold tracking-tight mb-2">{title}</h1>

          {isPending ? (
            <p className="text-[13.5px] text-muted leading-relaxed mb-6">
              Hi <span className="font-semibold text-ink">{userName}</span>, your account is signed up but waiting for the workspace admin to approve access.
              <br /><br />
              We'll redirect you automatically as soon as you're approved — no need to refresh.
            </p>
          ) : (
            <p className="text-[13.5px] text-muted leading-relaxed mb-6">
              Your access to this workspace has been temporarily paused by the admin.
              <br /><br />
              Contact the workspace admin if you think this is a mistake. We'll redirect you automatically once your access is restored.
            </p>
          )}

          <div className="rounded-md border border-border bg-surface-2 p-3 mb-5 text-left text-[12px] space-y-1">
            <div className="flex justify-between"><span className="text-muted">Signed in as:</span><span className="font-medium truncate ml-2">{userEmail}</span></div>
            <div className="flex justify-between">
              <span className="text-muted">Status:</span>
              <span className="chip" style={{ background: accentBg, color: accent, border: 'none' }}>{status}</span>
            </div>
          </div>

          <div className="flex items-center gap-2 justify-center">
            <button onClick={manualCheck} disabled={checking} className="btn btn-outline btn-sm disabled:opacity-50">
              <RefreshCw className={`w-3.5 h-3.5 ${checking ? 'animate-spin' : ''}`} /> {checking ? 'Checking…' : 'Check status'}
            </button>
            <button onClick={signOut} className="btn btn-ghost btn-sm">
              <LogOut className="w-3.5 h-3.5" /> Sign out
            </button>
          </div>

          <p className="text-[10.5px] text-faint mt-5">
            {polling ? 'Auto-checking every 10 seconds' : 'Auto-check paused'}
          </p>
        </div>

        <p className="text-[11.5px] text-muted text-center mt-6">
          Need help? Contact your workspace admin.
        </p>
      </div>
    </div>
  );
}
