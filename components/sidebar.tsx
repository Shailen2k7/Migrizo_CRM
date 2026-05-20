'use client';

import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { LayoutDashboard, Users, IndianRupee, Sparkles, Settings, Plus, LogOut, ChevronsUpDown, Briefcase, Activity } from 'lucide-react';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { initials } from '@/lib/utils';
import { toast } from 'sonner';

import { useApp } from '@/components/shared/app-provider';
import { isFollowUpOverdue, isFollowUpToday } from '@/lib/types';

type NavItem = { href: string; label: string; icon: React.ComponentType<{ className?: string }>; badge?: string; new?: boolean };

const NAV: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/leads', label: 'Leads', icon: Users },
  { href: '/cases', label: 'Cases', icon: Briefcase },
  { href: '/daily-tracker', label: 'Daily tracker', icon: Activity, new: true },
  { href: '/payments', label: 'Payments', icon: IndianRupee },
  { href: '/ai', label: 'AI COO', icon: Sparkles },
  { href: '/settings', label: 'Settings', icon: Settings },
];

interface Props {
  user: { email: string; name: string };
  workspaceName: string;
  leadsCount: number;
  onAddLead: () => void;
}

export function Sidebar({ user, workspaceName, leadsCount, onAddLead }: Props) {
  const { cases, followUps } = useApp();
  const casesCount = cases.filter((c) => c.status === 'active').length;
  const urgentFollowUps = followUps.filter((f) => isFollowUpOverdue(f) || isFollowUpToday(f)).length;
  const path = usePathname();
  const router = useRouter();
  const supabase = createClient();
  const [menuOpen, setMenuOpen] = useState(false);

  const signOut = async () => {
    await supabase.auth.signOut();
    toast.success('Signed out');
    router.push('/login');
    router.refresh();
  };

  return (
    <aside className="fixed left-0 top-0 bottom-0 w-[240px] bg-surface border-r border-border flex flex-col z-30">
      <div className="px-5 pt-5 pb-5 flex items-center gap-2.5">
        <div className="w-9 h-9 rounded-[10px] flex items-center justify-center text-white font-bold text-[15px]" style={{ background: '#4F46E5' }}>M</div>
        <div>
          <div className="text-[15px] font-semibold tracking-tight">Migrizo</div>
          <div className="text-[10.5px] text-muted leading-none mt-0.5 truncate max-w-[160px]">{workspaceName}</div>
        </div>
      </div>

      <nav className="px-3 flex-1 overflow-y-auto space-y-0.5">
        {NAV.map((item) => {
          const Icon = item.icon;
          const active = path === item.href || path.startsWith(item.href + '/');
          return (
            <Link key={item.href} href={item.href} className={`nav-item ${active ? 'active' : ''}`}>
              <Icon className={item.href === '/ai' ? 'w-[17px] h-[17px] text-indigo-600' : 'w-[17px] h-[17px]'} />
              <span>{item.label}</span>
              {item.href === '/leads' && leadsCount > 0 && (
                <span className="ml-auto count">{leadsCount}</span>
              )}
              {item.href === '/cases' && casesCount > 0 && (
                <span className="ml-auto count">{casesCount}</span>
              )}
              {item.href === '/daily-tracker' && urgentFollowUps > 0 && (
                <span className="ml-auto count" style={{ background: '#FEE2E2', color: '#B91C1C' }}>{urgentFollowUps}</span>
              )}
              {item.new && (
                <span className="ml-auto chip" style={{ background: 'hsl(var(--indigo-soft))', color: '#4338CA', border: 'none', fontSize: '9px', padding: '1px 5px' }}>NEW</span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="px-3 py-3 relative">
        <button onClick={() => setMenuOpen(!menuOpen)} className="w-full flex items-center gap-2.5 px-2 py-2 rounded-[10px] hover:bg-surface-2 transition">
          <div className="av" style={{ background: '#0F1115', width: 30, height: 30, fontSize: 11 }}>{initials(user.name)}</div>
          <div className="flex-1 text-left min-w-0">
            <div className="text-[13px] font-medium leading-tight truncate">{user.name}</div>
            <div className="text-[11px] text-muted leading-tight truncate mt-0.5">{user.email}</div>
          </div>
          <ChevronsUpDown className="w-3.5 h-3.5 text-faint" />
        </button>
        {menuOpen && (
          <div className="absolute left-3 right-3 bottom-[calc(100%-12px)] mb-2 bg-surface border border-border rounded-[10px] shadow-lg p-1 z-50 animate-fadeIn">
            <button onClick={signOut} className="w-full flex items-center gap-2 px-2.5 py-2 rounded-md text-[13px] hover:bg-surface-2 text-ink-2">
              <LogOut className="w-4 h-4" /> Sign out
            </button>
          </div>
        )}
      </div>

      <div className="px-3 pb-4">
        <button onClick={onAddLead} className="quick-add">
          <div className="qa-icon"><Plus className="w-4 h-4" /></div>
          <div className="flex-1 min-w-0">
            <div className="text-[12.5px] font-semibold leading-tight">Quick Add Lead</div>
            <div className="text-[11px] text-muted leading-tight mt-0.5">Add a new client</div>
          </div>
        </button>
      </div>
    </aside>
  );
}
