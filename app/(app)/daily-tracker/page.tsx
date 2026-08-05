'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { DailyTrackerView } from '@/components/daily-tracker/daily-tracker-view';
import { FollowUpsView } from '@/components/daily-tracker/followups-view';
import { GoalsView } from '@/components/daily-tracker/goals-view';
import { Activity, CalendarClock, Target } from 'lucide-react';
import { useApp } from '@/components/shared/app-provider';
import { isFollowUpOverdue, isFollowUpToday } from '@/lib/types';

type Tab = 'daily' | 'followups' | 'goals';

export default function DailyTrackerPage() {
  const [tab, setTab] = useState<Tab>('daily');
  const { followUps } = useApp();
  const urgentFollowUps = followUps.filter((f) => isFollowUpOverdue(f) || isFollowUpToday(f)).length;

  return (
    <div className="max-w-[1480px] mx-auto px-4 sm:px-6 lg:px-8 pt-5 sm:pt-7 pb-10">
      <div className="inline-flex items-center gap-1 p-1 rounded-md bg-surface-2 mb-6">
        <button
          onClick={() => setTab('daily')}
          className={cn('inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-[13px] font-medium transition', tab === 'daily' ? 'bg-surface shadow-sm text-ink' : 'text-muted hover:text-ink')}
        >
          <Activity className="w-3.5 h-3.5" /> Daily tracker
        </button>
        <button
          onClick={() => setTab('followups')}
          className={cn('inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-[13px] font-medium transition', tab === 'followups' ? 'bg-surface shadow-sm text-ink' : 'text-muted hover:text-ink')}
        >
          <CalendarClock className="w-3.5 h-3.5" /> Follow-ups
          {urgentFollowUps > 0 && (
            <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 rounded-full text-[10px] font-semibold" style={{ background: '#FEE2E2', color: '#B91C1C' }}>{urgentFollowUps}</span>
          )}
        </button>
        <button
          onClick={() => setTab('goals')}
          className={cn('inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-[13px] font-medium transition', tab === 'goals' ? 'bg-surface shadow-sm text-ink' : 'text-muted hover:text-ink')}
        >
          <Target className="w-3.5 h-3.5" /> Goals &amp; KPIs
        </button>
      </div>

      {tab === 'daily' ? <DailyTrackerView /> : tab === 'followups' ? <FollowUpsView /> : <GoalsView />}
    </div>
  );
}
