'use client';

// =============================================================================
// AI COO BANNER — a silent, at-a-glance briefing at the top of the CRM.
// Shows the owner their last conversion and this month's tally. Admin-only.
//
// Deliberately silent: no speech, no audio. The only sound in the CRM is the
// meeting alert chime, so when you hear something, it always means one thing.
// =============================================================================
import { useEffect, useMemo, useState } from 'react';
import { Sparkles, X } from 'lucide-react';
import type { Lead } from '@/lib/types';
import { readCoo, COO_EVENT } from '@/lib/coo';
import { useApp } from '@/components/shared/app-provider';

function daysSince(iso: string): number {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  return d < 0 ? 0 : d;
}

// Build the COO briefing from the leads snapshot.
function buildBriefing(leads: Lead[], userName: string) {
  const won = leads.filter((l) => l.stage === 'won');
  const dates = won.map((l) => l.won_at || l.updated_at).filter(Boolean) as string[];
  dates.sort((a, b) => new Date(b).getTime() - new Date(a).getTime());

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const thisMonth = dates.filter((d) => new Date(d).getTime() >= monthStart).length;

  const firstName = (userName || '').split(' ')[0] || 'there';
  const hour = now.getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  if (dates.length === 0) {
    return {
      headline: `${greet}, ${firstName}. No conversions logged yet.`,
      detail: 'Let\u2019s land the first win \u2014 your pipeline is waiting.',
      lastDays: null as number | null,
      thisMonth,
    };
  }

  const lastDays = daysSince(dates[0]);
  const ago = lastDays === 0 ? 'today' : lastDays === 1 ? 'yesterday' : `${lastDays} days ago`;
  const nudge = lastDays >= 7 ? 'It\u2019s been a while \u2014 time to close the next one.' : thisMonth >= 3 ? 'Strong momentum \u2014 keep it going.' : 'Keep the pipeline moving.';

  return {
    headline: `${greet}, ${firstName}. Last lead converted ${ago}.`,
    detail: `${thisMonth === 0 ? 'No conversions yet this month.' : `${thisMonth} converted this month.`} ${nudge}`,
    lastDays,
    thisMonth,
  };
}

export function CooBanner({ leads: initialLeads, isAdmin, userName = '' }: { leads: Lead[]; isAdmin: boolean; userName?: string }) {
  // Read LIVE leads from the provider so the briefing always matches the rest of
  // the app (a conversion made this session is reflected immediately).
  const { leads: liveLeads } = useApp();
  const leads = liveLeads && liveLeads.length ? liveLeads : initialLeads;
  const [settings, setSettings] = useState(() => readCoo());
  const [dismissed, setDismissed] = useState(false);

  // React to settings changes from the Settings page.
  useEffect(() => {
    const onChange = () => setSettings(readCoo());
    window.addEventListener(COO_EVENT, onChange);
    return () => window.removeEventListener(COO_EVENT, onChange);
  }, []);

  const briefing = useMemo(() => buildBriefing(leads, userName), [leads, userName]);

  if (!isAdmin || !settings.enabled || dismissed) return null;

  return (
    <div className="max-w-[1480px] mx-auto px-4 sm:px-6 lg:px-8 pt-4">
      <div className="coo-banner relative overflow-hidden rounded-2xl px-4 sm:px-5 py-3.5 flex items-center gap-3.5">
        {/* orb */}
        <div className="relative flex-shrink-0">
          <div className="coo-orb w-10 h-10 rounded-full flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <div className="text-[13.5px] sm:text-[14px] font-semibold text-white leading-tight truncate">{briefing.headline}</div>
          <div className="text-[11.5px] sm:text-[12.5px] text-white/80 leading-tight mt-0.5 truncate">{briefing.detail}</div>
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          <button onClick={() => setDismissed(true)} title="Dismiss" className="p-2 rounded-lg text-white/85 hover:text-white hover:bg-white/15 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
