'use client';

// =============================================================================
// FOLLOW-UP ALERTS
//
// Mirrors MeetingAlerts, for follow-ups:
//   15 minutes before  → soft two-note chime
//   at the due time    → brighter three-note chime
//
// Every alert fires exactly once, and — importantly — is only recorded as
// delivered once the sound has actually played. If the browser refuses audio
// the alert is retried on the next tick rather than silently lost, which is
// the fault that used to kill meeting alerts.
// =============================================================================

import { useEffect, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { armAudio, playChime, type ChimeName } from '@/lib/chime';

interface Due {
  id: string;
  title: string | null;
  scheduled_at: string;
  lead_id: string | null;
  lead_name?: string | null;
}

const STAGES: { key: string; minutes: number; chime: ChimeName; label: (t: string) => string }[] = [
  { key: 'm15', minutes: 15, chime: 'followupSoon', label: (t) => `${t} in 15 minutes` },
  { key: 'now', minutes: 0,  chime: 'followupNow',  label: (t) => `${t} — due now` },
];

const seenKey = (id: string, stage: string) => `mgz-fu-alert:${id}:${stage}`;

export function FollowUpAlerts({ workspaceId, onOpenLead }: {
  workspaceId: string;
  onOpenLead?: (leadId: string) => void;
}) {
  const dueRef = useRef<Due[]>([]);

  useEffect(() => {
    const supabase = createClient();
    let alive = true;

    armAudio();

    // Drop flags older than a week so localStorage cannot grow without limit.
    try {
      const cutoff = Date.now() - 7 * 86400000;
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (!k || !k.startsWith('mgz-fu-alert:')) continue;
        const stamp = Number(localStorage.getItem(k));
        if (Number.isFinite(stamp) && stamp > 0 && stamp < cutoff) localStorage.removeItem(k);
      }
    } catch { /* no-op */ }

    const fetchDue = async () => {
      const now = Date.now();
      const { data, error } = await supabase
        .from('follow_ups')
        .select('id, title, scheduled_at, lead_id, status')
        .eq('workspace_id', workspaceId)
        .eq('status', 'pending')
        .gte('scheduled_at', new Date(now - 30 * 60000).toISOString())
        .lte('scheduled_at', new Date(now + 3 * 3600 * 1000).toISOString())
        .order('scheduled_at')
        .limit(50);
      if (error) { console.error('[followup-alerts]', error.message); return; }
      if (alive) dueRef.current = (data as Due[]) || [];
    };

    const check = () => {
      const now = Date.now();
      for (const f of dueRef.current) {
        const at = new Date(f.scheduled_at).getTime();
        for (const st of STAGES) {
          const fireAt = at - st.minutes * 60000;
          // Wide window so a throttled background tab cannot step over it.
          if (now < fireAt || now > fireAt + 10 * 60000) continue;
          const key = seenKey(f.id, st.key);
          try { if (localStorage.getItem(key)) continue; } catch { /* still alert */ }

          const title = f.title || 'Follow-up';
          const sounded = playChime(st.chime);
          if (!sounded) continue;                       // retry next tick
          try { localStorage.setItem(key, String(Date.now())); } catch { /* no-op */ }

          try {
            if ('Notification' in window && Notification.permission === 'granted') {
              const n = new Notification(st.label(title), {
                body: new Intl.DateTimeFormat('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true })
                  .format(new Date(f.scheduled_at)),
                tag: key,
                requireInteraction: st.key === 'now',
              });
              n.onclick = () => { window.focus(); if (f.lead_id && onOpenLead) onOpenLead(f.lead_id); n.close(); };
            }
          } catch { /* no-op */ }

          toast(st.label(title), {
            duration: st.key === 'now' ? 20000 : 8000,
            action: f.lead_id && onOpenLead
              ? { label: 'Open lead', onClick: () => onOpenLead(f.lead_id!) }
              : undefined,
          });
        }
      }
    };

    void fetchDue().then(check);
    const fetchTimer = setInterval(() => void fetchDue(), 3 * 60000);
    const checkTimer = setInterval(check, 15000);
    const onVisible = () => { if (!document.hidden) { void fetchDue().then(check); } };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      alive = false;
      clearInterval(fetchTimer);
      clearInterval(checkTimer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [workspaceId, onOpenLead]);

  return null;
}
