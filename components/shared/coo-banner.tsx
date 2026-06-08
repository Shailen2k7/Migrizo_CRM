'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Sparkles, Volume2, VolumeX, X } from 'lucide-react';
import type { Lead } from '@/lib/types';
import { readCoo, COO_EVENT } from '@/lib/coo';

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
      speech: `${greet} ${firstName}. I\u2019m your AI C O O. No leads have converted yet. Let\u2019s land the first win today.`,
      lastDays: null as number | null,
      thisMonth,
    };
  }

  const lastDays = daysSince(dates[0]);
  const ago = lastDays === 0 ? 'today' : lastDays === 1 ? 'yesterday' : `${lastDays} days ago`;
  const monthPhrase = thisMonth === 0 ? 'no conversions yet this month' : thisMonth === 1 ? '1 conversion this month' : `${thisMonth} conversions this month`;
  const nudge = lastDays >= 7 ? 'It\u2019s been a while \u2014 time to close the next one.' : thisMonth >= 3 ? 'Strong momentum \u2014 keep it going.' : 'Keep the pipeline moving.';

  return {
    headline: `${greet}, ${firstName}. Last lead converted ${ago}.`,
    detail: `${thisMonth === 0 ? 'No conversions yet this month.' : `${thisMonth} converted this month.`} ${nudge}`,
    speech: `${greet} ${firstName}. I\u2019m your AI C O O. Your last lead converted ${ago}. You have ${monthPhrase}. ${nudge}`,
    lastDays,
    thisMonth,
  };
}

function speak(text: string) {
  try {
    const synth = window.speechSynthesis;
    if (!synth) return;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 0.98; u.pitch = 1.0; u.volume = 1.0;
    const pick = () => {
      const voices = synth.getVoices();
      // Prefer a natural-sounding English voice if available.
      const pref = voices.find((v) => /Google UK English Female|Samantha|Google US English|Microsoft Aria|Daniel/i.test(v.name))
        || voices.find((v) => v.lang?.startsWith('en') && /female|aria|samantha|google/i.test(v.name))
        || voices.find((v) => v.lang?.startsWith('en'));
      if (pref) u.voice = pref;
      synth.speak(u);
    };
    if (synth.getVoices().length === 0) {
      synth.addEventListener('voiceschanged', pick, { once: true });
      // Safari sometimes never fires voiceschanged; nudge after a tick.
      setTimeout(pick, 350);
    } else {
      pick();
    }
  } catch { /* speech not available */ }
}

export function CooBanner({ leads, isAdmin, userName = '' }: { leads: Lead[]; isAdmin: boolean; userName?: string }) {
  const [settings, setSettings] = useState(() => readCoo());
  const [dismissed, setDismissed] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const spokenRef = useRef(false);

  // React to settings changes from the Settings page.
  useEffect(() => {
    const onChange = () => setSettings(readCoo());
    window.addEventListener(COO_EVENT, onChange);
    return () => window.removeEventListener(COO_EVENT, onChange);
  }, []);

  const briefing = useMemo(() => buildBriefing(leads, userName), [leads, userName]);

  // Speak once per browser session, right after open.
  useEffect(() => {
    if (!isAdmin || !settings.enabled || !settings.voice) return;
    if (spokenRef.current) return;
    if (typeof window === 'undefined') return;
    if (sessionStorage.getItem('migrizo_coo_spoken') === '1') return;
    spokenRef.current = true;
    const t = setTimeout(() => {
      setSpeaking(true);
      speak(briefing.speech);
      sessionStorage.setItem('migrizo_coo_spoken', '1');
      // rough end-of-speech reset
      setTimeout(() => setSpeaking(false), Math.min(12000, 2600 + briefing.speech.length * 55));
    }, 900);
    return () => clearTimeout(t);
  }, [isAdmin, settings.enabled, settings.voice, briefing.speech]);

  const replay = () => {
    if (speaking) { window.speechSynthesis?.cancel(); setSpeaking(false); return; }
    setSpeaking(true);
    speak(briefing.speech);
    setTimeout(() => setSpeaking(false), Math.min(12000, 2600 + briefing.speech.length * 55));
  };

  if (!isAdmin || !settings.enabled || dismissed) return null;

  return (
    <div className="max-w-[1480px] mx-auto px-4 sm:px-6 lg:px-8 pt-4">
      <div className="coo-banner relative overflow-hidden rounded-2xl px-4 sm:px-5 py-3.5 flex items-center gap-3.5">
        {/* animated orb */}
        <div className="relative flex-shrink-0">
          <div className={`coo-orb w-10 h-10 rounded-full flex items-center justify-center ${speaking ? 'coo-orb-live' : ''}`}>
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          {speaking && <span className="coo-ring" />}
        </div>

        <div className="min-w-0 flex-1">
          <div className="text-[13.5px] sm:text-[14px] font-semibold text-white leading-tight truncate">{briefing.headline}</div>
          <div className="text-[11.5px] sm:text-[12.5px] text-white/80 leading-tight mt-0.5 truncate">{briefing.detail}</div>
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          <button onClick={replay} title={speaking ? 'Stop' : 'Play briefing'} className="p-2 rounded-lg text-white/85 hover:text-white hover:bg-white/15 transition-colors">
            {speaking ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>
          <button onClick={() => setDismissed(true)} title="Dismiss" className="p-2 rounded-lg text-white/85 hover:text-white hover:bg-white/15 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
