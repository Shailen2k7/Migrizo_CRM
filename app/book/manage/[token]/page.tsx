'use client';

// =============================================================================
// PUBLIC MANAGE PAGE — /book/manage/<token>
// One-click reschedule (re-uses the booking slot picker via the slug page's
// API) and cancel, reached from every confirmation/reminder email.
// =============================================================================
import { useState, useEffect, useMemo, use } from 'react';

const NAVY = '#16294E'; const BLUE = '#3E56D4'; const GOLD = '#F4C430';

interface Info { title: string; memberName: string; slug: string; startsAt: string; endsAt: string; status: string; clientName: string; clientTz: string | null; meetLink: string | null; }

export default function ManagePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [info, setInfo] = useState<Info | null>(null);
  const [mode, setMode] = useState<'view' | 'reschedule' | 'cancelled' | 'rescheduled'>('view');
  const [slots, setSlots] = useState<Date[]>([]);
  const [weekStart, setWeekStart] = useState(() => new Date());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const tz = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata', []);

  useEffect(() => {
    fetch(`/api/booking/manage?token=${token}`).then((r) => r.json()).then((d) => {
      if (d.ok) setInfo(d.meeting); else setError('This link is invalid or expired.');
      if (d.ok && new URLSearchParams(window.location.search).get('intent') === 'cancel') setMode('view');
    }).catch(() => setError('Could not load your meeting.'));
  }, [token]);

  useEffect(() => {
    if (mode !== 'reschedule' || !info) return;
    fetch(`/api/booking/${info.slug}/slots?from=${weekStart.toISOString()}&days=7`)
      .then((r) => r.json()).then((d) => { if (d.ok) setSlots(d.slots.map((s: string) => new Date(s))); });
  }, [mode, info, weekStart]);

  const fmt = (d: Date) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit', hour12: true }).format(d);
  const fmtShort = (d: Date) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }).format(d);

  async function act(action: 'cancel' | 'reschedule', newStartsAt?: string) {
    setBusy(true); setError('');
    try {
      const res = await fetch('/api/booking/manage', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, action, newStartsAt }),
      });
      const d = await res.json();
      if (!d.ok) setError(d.reason === 'slot_taken' ? 'That time was just taken — pick another.' : 'Could not update the meeting.');
      else setMode(action === 'cancel' ? 'cancelled' : 'rescheduled');
    } catch { setError('Network error — please try again.'); }
    setBusy(false);
  }

  const card = (inner: React.ReactNode) => (
    <div style={{ minHeight: '100vh', background: '#EEF1F8', fontFamily: "-apple-system,'Segoe UI',Roboto,Arial,sans-serif", padding: '32px 14px' }}>
      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        <img src="/migrizo-email-logo.png" alt="Migrizo" style={{ height: 38, marginBottom: 16 }} />
        <div style={{ background: '#fff', borderRadius: 20, boxShadow: '0 8px 32px rgba(22,41,78,.10)', overflow: 'hidden' }}>
          <div style={{ height: 4, background: `linear-gradient(90deg,${GOLD},${BLUE},${NAVY})` }} />
          <div style={{ padding: '30px 28px 34px' }}>{inner}</div>
        </div>
      </div>
    </div>
  );

  if (error && !info) return card(<div style={{ textAlign: 'center', color: '#B91C1C', fontSize: 14 }}>{error}</div>);
  if (!info) return card(<div style={{ textAlign: 'center', color: '#8A90A0', fontSize: 13.5, padding: 30 }}>Loading…</div>);

  if (mode === 'cancelled') return card(
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 34 }}>🗓️</div>
      <h1 style={{ fontSize: 21, color: NAVY, fontWeight: 800, margin: '10px 0 8px' }}>Meeting cancelled</h1>
      <p style={{ fontSize: 13.5, color: '#6B7280', lineHeight: 1.7 }}>No problem, {info.clientName.split(' ')[0]}. If you change your mind, you can always book a fresh time with us.</p>
    </div>
  );
  if (mode === 'rescheduled') return card(
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 34 }}>✅</div>
      <h1 style={{ fontSize: 21, color: NAVY, fontWeight: 800, margin: '10px 0 8px' }}>Meeting rescheduled</h1>
      <p style={{ fontSize: 13.5, color: '#6B7280', lineHeight: 1.7 }}>A fresh confirmation with your new time is on its way to your inbox.</p>
    </div>
  );

  if (mode === 'reschedule') {
    const dayKey = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(d);
    const byDay = new Map<string, Date[]>();
    for (const s of slots) { const k = dayKey(s); if (!byDay.has(k)) byDay.set(k, []); byDay.get(k)!.push(s); }
    return card(
      <>
        <button onClick={() => setMode('view')} style={{ border: 0, background: 'none', color: '#6B7280', fontSize: 12.5, cursor: 'pointer', marginBottom: 12 }}>‹ Back</button>
        <h1 style={{ fontSize: 19, color: NAVY, fontWeight: 800, margin: '0 0 4px' }}>Pick a new time</h1>
        <p style={{ fontSize: 12.5, color: '#6B7280', marginBottom: 14 }}>Times shown in {tz}</p>
        {error && <div style={{ background: '#FDECEC', color: '#B91C1C', borderRadius: 10, padding: '9px 13px', fontSize: 12.5, marginBottom: 12 }}>{error}</div>}
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <button onClick={() => setWeekStart(new Date(Math.max(Date.now(), weekStart.getTime() - 7 * 864e5)))} style={{ border: '1px solid #D9DFF0', background: '#fff', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 12.5 }}>‹ Prev week</button>
          <button onClick={() => setWeekStart(new Date(weekStart.getTime() + 7 * 864e5))} style={{ border: '1px solid #D9DFF0', background: '#fff', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 12.5 }}>Next week ›</button>
        </div>
        {Array.from(byDay.entries()).map(([k, list]) => (
          <div key={k} style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: NAVY, marginBottom: 6 }}>{new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'short' }).format(list[0])}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
              {list.map((s) => (
                <button key={s.toISOString()} disabled={busy} onClick={() => act('reschedule', s.toISOString())}
                  style={{ border: `1.5px solid ${BLUE}55`, color: BLUE, fontWeight: 700, fontSize: 12.5, background: '#fff', borderRadius: 9, padding: '8px 12px', cursor: 'pointer' }}>
                  {new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true }).format(s)}
                </button>
              ))}
            </div>
          </div>
        ))}
        {byDay.size === 0 && <div style={{ color: '#8A90A0', fontSize: 13, padding: 18, textAlign: 'center' }}>No free times this week — try the next one.</div>}
      </>
    );
  }

  // view
  const past = info.status !== 'upcoming';
  return card(
    <>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.4, color: BLUE, textTransform: 'uppercase', marginBottom: 8 }}>Your meeting</div>
      <h1 style={{ fontSize: 21, color: NAVY, fontWeight: 800, margin: '0 0 12px' }}>{info.title} with {info.memberName}</h1>
      <div style={{ background: '#F5F7FC', border: '1px solid #E1E6F2', borderRadius: 14, padding: '16px 20px', fontSize: 14, color: NAVY, lineHeight: 2 }}>
        📅 <b>{fmt(new Date(info.startsAt))}</b><br />
        🌐 Shown in {tz}<br />
        {info.meetLink && <>🔗 <a href={info.meetLink} style={{ color: BLUE }}>{info.meetLink}</a><br /></>}
        Status: <b style={{ textTransform: 'capitalize' }}>{info.status.replace('_', ' ')}</b>
      </div>
      {error && <div style={{ background: '#FDECEC', color: '#B91C1C', borderRadius: 10, padding: '9px 13px', fontSize: 12.5, marginTop: 12 }}>{error}</div>}
      {!past && (
        <div style={{ display: 'flex', gap: 10, marginTop: 18, flexWrap: 'wrap' }}>
          <button onClick={() => setMode('reschedule')} style={{ background: GOLD, color: NAVY, fontWeight: 800, fontSize: 14, border: 0, borderRadius: 10, padding: '13px 22px', cursor: 'pointer' }}>🔄 Reschedule</button>
          <button disabled={busy} onClick={() => { if (confirm('Cancel this meeting?')) void act('cancel'); }} style={{ background: '#fff', color: '#B91C1C', fontWeight: 700, fontSize: 14, border: '1.5px solid #F2C6C6', borderRadius: 10, padding: '13px 22px', cursor: 'pointer' }}>Cancel meeting</button>
        </div>
      )}
      {past && <p style={{ fontSize: 12.5, color: '#8A90A0', marginTop: 14 }}>This meeting can no longer be changed.</p>}
    </>
  );
}
