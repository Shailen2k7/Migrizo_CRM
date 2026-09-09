'use client';

import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { LayoutDashboard, Users, IndianRupee, Settings, LogOut, ChevronsUpDown, Briefcase, Activity, SquareKanban, CalendarDays, BookOpen, Megaphone, ListChecks, PanelLeftClose, PanelLeftOpen, FileUp, MoreHorizontal, SlidersHorizontal, ChevronDown } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { initials } from '@/lib/utils';
import { toast } from 'sonner';

import { useApp } from '@/components/shared/app-provider';
import { isFollowUpOverdue, isFollowUpToday } from '@/lib/types';
import { applyNavPrefs, clearNavPrefs, loadNavPrefs, saveNavPrefs, EMPTY_PREFS, type NavPrefs } from '@/lib/nav-prefs';
import { NavCustomiser } from '@/components/nav-customiser';

// `newUntil`: show the NEW pill only until this date (YYYY-MM-DD), then it
// disappears automatically. Set it ~4 days ahead whenever a feature ships.
type NavItem = { href: string; label: string; icon: React.ComponentType<{ className?: string }>; badge?: string; newUntil?: string; adminOnly?: boolean };

function isNew(newUntil?: string): boolean {
  if (!newUntil) return false;
  return Date.now() < new Date(newUntil + 'T23:59:59').getTime();
}

const NAV: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/leads', label: 'Leads', icon: Users },
  { href: '/cv-import', label: 'Import CVs', icon: FileUp, newUntil: '2026-09-14' },
  { href: '/pipeline', label: 'Pipeline', icon: SquareKanban },
  { href: '/cases', label: 'Cases', icon: Briefcase },
  { href: '/daily-tracker', label: 'Daily tracker', icon: Activity },
  { href: '/payments', label: 'Payments', icon: IndianRupee },
  { href: '/meetings', label: 'Meetings', icon: CalendarDays, newUntil: '2026-07-18' },
  { href: '/learning', label: 'Learning', icon: BookOpen, newUntil: '2026-07-24' },
  { href: '/tasks', label: 'Tasks & Goals', icon: ListChecks, newUntil: '2026-08-10' },
  // My Queue and Lead Engine are hidden from the menu for now. The pages still
  // exist and remain reachable by URL, so nothing was deleted — restore them by
  // putting these two lines back:
  //   { href: '/my-queue', label: 'My Queue', icon: Target },
  //   { href: '/lead-engine', label: 'Lead Engine', icon: Zap, adminOnly: true },
  { href: '/campaigns', label: 'Campaigns', icon: Megaphone, adminOnly: true, newUntil: '2026-08-08' },
  { href: '/settings', label: 'Settings', icon: Settings },
];

interface Props {
  user: { email: string; name: string };
  workspaceName: string;
  leadsCount: number;
  onAddLead?: () => void;   // no longer used — quick-add button removed
  mobileOpen?: boolean;
  onClose?: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

export function Sidebar({ user, workspaceName, leadsCount, mobileOpen = false, onClose, collapsed = false, onToggleCollapse }: Props) {
  const { cases, followUps, canViewPayments, role } = useApp();
  const casesCount = cases.filter((c) => c.status === 'active' && !c.archived_at).length;
  const urgentFollowUps = followUps.filter((f) => isFollowUpOverdue(f) || isFollowUpToday(f)).length;
  const path = usePathname();
  const router = useRouter();
  const supabase = createClient();
  const [menuOpen, setMenuOpen] = useState(false);
  const [prefs, setPrefs] = useState<NavPrefs>(EMPTY_PREFS);
  const [customising, setCustomising] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  // Read in an effect, not in useState's initialiser: the server renders this
  // too, and localStorage does not exist there. Reading it during the first
  // render would make the server and client disagree and React would throw
  // away the markup.
  useEffect(() => { setPrefs(loadNavPrefs()); }, []);

  const updatePrefs = (next: NavPrefs) => { setPrefs(next); saveNavPrefs(next); };
  const resetPrefs = () => { setPrefs(EMPTY_PREFS); clearNavPrefs(); };


  // Hide the Payments item for team members the admin hasn't granted access to.
  // Payments: hidden unless granted. Cases: admin/owner only.
  const nav = NAV.filter((item) => {
    if (item.href === '/payments' && !canViewPayments) return false;
    if (item.href === '/cases' && role !== 'admin') return false;
    if (item.adminOnly && role !== 'admin') return false;
    return true;
  });

  const { main: mainNav, more: moreNav } = applyNavPrefs(nav, prefs);
  // The same list the sidebar shows, in one flat run — what the customiser
  // edits, so the two can never disagree about the order.
  const orderRank = new Map(prefs.order.map((h, i) => [h, i]));
  const orderedNav = [...mainNav, ...moreNav].sort((a, b) => {
    const ra = orderRank.has(a.href) ? orderRank.get(a.href)! : Number.MAX_SAFE_INTEGER;
    const rb = orderRank.has(b.href) ? orderRank.get(b.href)! : Number.MAX_SAFE_INTEGER;
    return ra !== rb ? ra - rb : nav.indexOf(a) - nav.indexOf(b);
  });

  // Keep "More" open while you are inside one of its pages, so the menu never
  // looks as though the page you are on is not in it.
  const activeInMore = moreNav.some((i) => path === i.href || path.startsWith(i.href + '/'));
  useEffect(() => { if (activeInMore) setMoreOpen(true); }, [activeInMore]);

  const signOut = async () => {
    await supabase.auth.signOut();
    toast.success('Signed out');
    router.push('/login');
    router.refresh();
  };

  return (
    <>
      {/* Mobile backdrop */}
      <div
        onClick={onClose}
        className={`md:hidden fixed inset-0 z-40 bg-black/30 backdrop-blur-[2px] transition-opacity duration-300 ${mobileOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
      />
      <aside className={`group/side fixed left-0 top-0 bottom-0 w-[260px] bg-surface border-r border-border flex flex-col z-50 transition-[transform,width] duration-300 ease-out md:translate-x-0 ${collapsed ? 'md:w-[68px]' : 'md:w-[240px]'} ${mobileOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full'}`}>
      <div className={`pt-5 pb-5 flex items-center gap-2.5 ${collapsed ? 'md:px-0 md:justify-center px-5' : 'px-5'}`}>
        <div className="w-9 h-9 rounded-[10px] flex items-center justify-center text-white font-bold text-[15px] flex-shrink-0" style={{ background: '#4F46E5' }}>M</div>
        <div className={collapsed ? 'md:hidden' : ''}>
          <div className="text-[15px] font-semibold tracking-tight">Migrizo</div>
          <div className="text-[10.5px] text-muted leading-none mt-0.5 truncate max-w-[160px]">{workspaceName}</div>
        </div>
        {/* Collapse toggle. Desktop only — on mobile the whole rail slides away. */}
        {onToggleCollapse && (
          <button
            onClick={onToggleCollapse}
            title={collapsed ? 'Expand menu  (\\)' : 'Collapse menu  (\\)'}
            aria-label={collapsed ? 'Expand menu' : 'Collapse menu'}
            className={`hidden md:flex ml-auto h-7 w-7 items-center justify-center rounded-md text-faint hover:bg-surface-2 hover:text-ink transition ${collapsed ? 'md:hidden' : ''}`}
          >
            <PanelLeftClose className="w-4 h-4" />
          </button>
        )}
      </div>
      {/* When collapsed the toggle moves under the mark, so the rail stays 68px */}
      {collapsed && onToggleCollapse && (
        <button
          onClick={onToggleCollapse}
          title="Expand menu  (\\)"
          aria-label="Expand menu"
          className="hidden md:flex mx-auto mb-2 h-7 w-7 items-center justify-center rounded-md text-faint hover:bg-surface-2 hover:text-ink transition"
        >
          <PanelLeftOpen className="w-4 h-4" />
        </button>
      )}

      <nav className="px-3 flex-1 overflow-y-auto space-y-0.5">
        {/* Collapsed to a 68px rail there are only icons, so a "More" group
            would hide things behind a second click for no gain in space. */}
        {(collapsed ? nav : mainNav).map((item) => {
          const Icon = item.icon;
          const active = path === item.href || path.startsWith(item.href + '/');
          return (
            <Link
              key={item.href} href={item.href} onClick={onClose}
              title={collapsed ? item.label : undefined}
              className={`nav-item relative ${active ? 'active' : ''} ${collapsed ? 'md:justify-center md:px-0' : ''}`}
            >
              <span className="relative flex-shrink-0">
                <Icon className={item.href === '/ai' ? 'w-[17px] h-[17px] text-indigo-600' : 'w-[17px] h-[17px]'} />
              </span>
              <span className={collapsed ? 'md:hidden' : ''}>{item.label}</span>
              {item.href === '/leads' && leadsCount > 0 && (
                <span className={`ml-auto count ${collapsed ? 'md:hidden' : ''}`}>{leadsCount}</span>
              )}
              {item.href === '/cases' && casesCount > 0 && (
                <span className={`ml-auto count ${collapsed ? 'md:hidden' : ''}`}>{casesCount}</span>
              )}
              {item.href === '/daily-tracker' && urgentFollowUps > 0 && (
                <span className={`ml-auto count ${collapsed ? 'md:hidden' : ''}`} style={{ background: '#FEE2E2', color: '#B91C1C' }}>{urgentFollowUps}</span>
              )}
              {isNew(item.newUntil) && (
                <span className={`ml-auto chip ${collapsed ? 'md:hidden' : ''}`} style={{ background: 'hsl(var(--indigo-soft))', color: '#4338CA', border: 'none', fontSize: '9px', padding: '1px 5px' }}>NEW</span>
              )}
            </Link>
          );
        })}

        {/* ── More ─────────────────────────────────────────────────────── */}
        {!collapsed && moreNav.length > 0 && (
          <>
            <button
              onClick={() => setMoreOpen((v) => !v)}
              aria-expanded={moreOpen}
              className={`nav-item w-full ${activeInMore && !moreOpen ? 'active' : ''}`}
            >
              <span className="relative flex-shrink-0"><MoreHorizontal className="h-[17px] w-[17px]" /></span>
              <span>More</span>
              <ChevronDown className={`ml-auto h-3.5 w-3.5 text-faint transition-transform duration-200 ${moreOpen ? 'rotate-180' : ''}`} />
            </button>

            <div
              className="overflow-hidden transition-[max-height,opacity] duration-250 ease-out"
              style={{ maxHeight: moreOpen ? moreNav.length * 40 + 8 : 0, opacity: moreOpen ? 1 : 0 }}
            >
              <div className="space-y-0.5 border-l border-border pl-2 ml-3.5 mt-0.5">
                {moreNav.map((item) => {
                  const Icon = item.icon;
                  const active = path === item.href || path.startsWith(item.href + '/');
                  return (
                    <Link key={item.href} href={item.href} onClick={onClose}
                      className={`nav-item relative ${active ? 'active' : ''}`}>
                      <span className="relative flex-shrink-0"><Icon className="h-[17px] w-[17px]" /></span>
                      <span>{item.label}</span>
                      {item.href === '/leads' && leadsCount > 0 && <span className="ml-auto count">{leadsCount}</span>}
                      {item.href === '/cases' && casesCount > 0 && <span className="ml-auto count">{casesCount}</span>}
                      {item.href === '/daily-tracker' && urgentFollowUps > 0 && (
                        <span className="ml-auto count" style={{ background: '#FEE2E2', color: '#B91C1C' }}>{urgentFollowUps}</span>
                      )}
                      {isNew(item.newUntil) && (
                        <span className="ml-auto chip" style={{ background: 'hsl(var(--indigo-soft))', color: '#4338CA', border: 'none', fontSize: '9px', padding: '1px 5px' }}>NEW</span>
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          </>
        )}

        {/* Quiet until you go looking for it. */}
        {!collapsed && (
          <button
            onClick={() => setCustomising(true)}
            className="mt-1 flex w-full items-center gap-2 rounded-[10px] px-3 py-2 text-[12.2px] text-faint opacity-0 transition hover:bg-surface-2 hover:text-ink group-hover/side:opacity-100 focus:opacity-100"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" /> Customise menu
          </button>
        )}
      </nav>

      <div className="px-3 py-3 relative">
        <button onClick={() => setMenuOpen(!menuOpen)} title={collapsed ? user.name : undefined}
          className={`w-full flex items-center gap-2.5 py-2 rounded-[10px] hover:bg-surface-2 transition ${collapsed ? 'md:justify-center md:px-0 px-2' : 'px-2'}`}>
          <div className="av flex-shrink-0" style={{ background: '#0F1115', width: 30, height: 30, fontSize: 11 }}>{initials(user.name)}</div>
          <div className={`flex-1 text-left min-w-0 ${collapsed ? 'md:hidden' : ''}`}>
            <div className="text-[13px] font-medium leading-tight truncate">{user.name}</div>
            <div className="text-[11px] text-muted leading-tight truncate mt-0.5">{user.email}</div>
          </div>
          <ChevronsUpDown className={`w-3.5 h-3.5 text-faint ${collapsed ? 'md:hidden' : ''}`} />
        </button>
        {menuOpen && (
          <div className="absolute left-3 right-3 bottom-[calc(100%-12px)] mb-2 bg-surface border border-border rounded-[10px] shadow-lg p-1 z-50 animate-fadeIn">
            <button onClick={signOut} className="w-full flex items-center gap-2 px-2.5 py-2 rounded-md text-[13px] hover:bg-surface-2 text-ink-2">
              <LogOut className="w-4 h-4" /> Sign out
            </button>
          </div>
        )}
      </div>

    </aside>

    {customising && (
      <NavCustomiser
        items={orderedNav}
        prefs={prefs}
        onChange={updatePrefs}
        onReset={resetPrefs}
        onClose={() => setCustomising(false)}
      />
    )}
    </>
  );
}
