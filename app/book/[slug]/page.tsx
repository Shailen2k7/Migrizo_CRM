'use client';

// =============================================================================
// PUBLIC BOOKING PAGE — /book/<slug>
// Premium Calendly-style flow: pick a day → pick a time (shown in the
// visitor's own timezone, auto-detected) → enter details → confirmed.
// =============================================================================
import { useState, useEffect, useMemo, use } from 'react';

interface MemberInfo { name: string; title: string; bio: string | null; slotMinutes: number; timezone: string; }

const NAVY = '#16294E'; const BLUE = '#3E56D4'; const GOLD = '#F4C430';

export default function BookingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const [member, setMember] = useState<MemberInfo | null>(null);
  const [slots, setSlots] = useState<Date[]>([]);
  const [loading, setLoading] = useState(true);
  const [weekStart, setWeekStart] = useState(() => new Date());
  const [day, setDay] = useState<string | null>(null);
  const [slot, setSlot] = useState<Date | null>(null);
  const [form, setForm] = useState({ name: '', email: '', phone: '', note: '' });
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<{ token: string; meetLink: string | null } | null>(null);
  const [error, setError] = useState('');
  const tz = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata', []);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/booking/${slug}/slots?from=${weekStart.toISOString()}&days=7`)
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) { setMember(d.member); setSlots(d.slots.map((s: string) => new Date(s))); }
        else setError('This booking page is not available.');
      })
      .catch(() => setError('Could not load availability.'))
      .finally(() => setLoading(false));
  }, [slug, weekStart]);

  const dayKey = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  const byDay = useMemo(() => {
    const m = new Map<string, Date[]>();
    for (const s of slots) { const k = dayKey(s); if (!m.has(k)) m.set(k, []); m.get(k)!.push(s); }
    return m;
  }, [slots, tz]);
  const days = useMemo(() => {
    const out: { key: string; date: Date }[] = [];
    for (let i = 0; i < 7; i++) { const d = new Date(weekStart.getTime() + i * 864e5); out.push({ key: dayKey(d), date: d }); }
    return out;
  }, [weekStart, tz]);

  const fmtTime = (d: Date) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true }).format(d);
  const fmtDay = (d: Date) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short' }).format(d);

  async function book() {
    if (!slot) return;
    if (!form.name.trim() || !form.email.includes('@')) { setError('Please enter your name and a valid email.'); return; }
    setSubmitting(true); setError('');
    try {
      const res = await fetch(`/api/booking/${slug}/create`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startsAt: slot.toISOString(), name: form.name.trim(), email: form.email.trim(), phone: form.phone.trim(), note: form.note.trim(), tz }),
      });
      const d = await res.json();
      if (!d.ok) { setError(d.reason === 'slot_taken' ? 'That time was just taken — please pick another.' : 'Something went wrong. Please try again.'); if (d.reason === 'slot_taken') { setSlot(null); setWeekStart(new Date(weekStart)); } }
      else setDone({ token: d.token, meetLink: d.meetLink });
    } catch { setError('Network error — please try again.'); }
    setSubmitting(false);
  }

  const shell = (inner: React.ReactNode) => (
    <div style={{ minHeight: '100vh', background: '#EEF1F8', fontFamily: "-apple-system,'Segoe UI',Roboto,Arial,sans-serif", padding: '28px 14px' }}>
      <div style={{ maxWidth: 960, margin: '0 auto' }}>
        <img src="/migrizo-email-logo.png" alt="Migrizo" style={{ height: 40, marginBottom: 18 }} />
        <div style={{ background: '#fff', borderRadius: 20, boxShadow: '0 8px 32px rgba(22,41,78,.10)', overflow: 'hidden' }}>
          <div style={{ height: 4, background: `linear-gradient(90deg,${GOLD},${BLUE},${NAVY})` }} />
          {inner}
        </div>
        <div style={{ textAlign: 'center', fontSize: 11.5, color: '#8A90A0', marginTop: 16 }}>Powered by Migrizo · Smart. Fast. Reliable Visas</div>
      </div>
    </div>
  );

  if (done) return shell(
    <div style={{ padding: '52px 30px', textAlign: 'center' }}>
      <div style={{ width: 62, height: 62, borderRadius: '50%', background: '#E6F7EE', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 30 }}>✅</div>
      <h1 style={{ fontSize: 24, color: NAVY, margin: '16px 0 8px', fontWeight: 800 }}>You&apos;re booked!</h1>
      <p style={{ fontSize: 14.5, color: '#4B5563', lineHeight: 1.7, maxWidth: 460, margin: '0 auto 6px' }}>
        <b>{slot && fmtDay(slot)}, {slot && fmtTime(slot)}</b> ({tz})<br />
        A confirmation email with your meeting details{done.meetLink ? ' and joining link' : ''} is on its way to <b>{form.email}</b>.
      </p>
      <p style={{ fontSize: 12.5, color: '#8A90A0', margin: '10px 0 22px' }}>You&apos;ll also get reminders before the meeting, with one-click reschedule or cancel.</p>
      {done.meetLink && <a href={done.meetLink} style={{ display: 'inline-block', background: GOLD, color: NAVY, fontWeight: 800, fontSize: 14, padding: '13px 26px', borderRadius: 10, textDecoration: 'none' }}>Save the meeting link →</a>}
    </div>
  );

  return shell(
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,300px) 1fr', gap: 0 }} className="mgz-book-grid">
      <style>{`@media(max-width:760px){.mgz-book-grid{display:block !important}}`}</style>
      {/* Left: member */}
      <div style={{ padding: '30px 26px', borderRight: '1px solid #EEF1F8' }}>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.4, color: BLUE, textTransform: 'uppercase', marginBottom: 8 }}>Book a call</div>
        <h1 style={{ fontSize: 22, color: NAVY, fontWeight: 800, margin: '0 0 4px' }}>{member?.name || '…'}</h1>
        <div style={{ fontSize: 14, color: '#4B5563', marginBottom: 12 }}>{member?.title}</div>
        {member?.bio && <p style={{ fontSize: 13, color: '#6B7280', lineHeight: 1.7 }}>{member.bio}</p>}
        <div style={{ marginTop: 16, fontSize: 12.5, color: '#6B7280', lineHeight: 2 }}>
          ⏱ {member?.slotMinutes || 30} minutes<br />
          📹 Online meeting<br />
          🌐 Times shown in <b>{tz}</b>
        </div>
      </div>
      {/* Right: picker */}
      <div style={{ padding: '26px 26px 32px' }}>
        {error && <div style={{ background: '#FDECEC', color: '#B91C1C', borderRadius: 10, padding: '10px 14px', fontSize: 13, marginBottom: 14 }}>{error}</div>}
        {!slot ? (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: NAVY }}>Pick a time</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setWeekStart(new Date(Math.max(Date.now(), weekStart.getTime() - 7 * 864e5)))} style={{ border: '1px solid #D9DFF0', background: '#fff', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 13 }}>‹ Prev</button>
                <button onClick={() => setWeekStart(new Date(weekStart.getTime() + 7 * 864e5))} style={{ border: '1px solid #D9DFF0', background: '#fff', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 13 }}>Next ›</button>
              </div>
            </div>
            {loading ? <div style={{ padding: 60, textAlign: 'center', color: '#8A90A0', fontSize: 13.5 }}>Loading availability…</div> : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(112px,1fr))', gap: 10 }}>
                {days.map(({ key, date }) => {
                  const daySlots = byDay.get(key) || [];
                  const open = day === key;
                  return (
                    <div key={key}>
                      <button
                        onClick={() => setDay(open ? null : key)}
                        disabled={daySlots.length === 0}
                        style={{
                          width: '100%', border: `1.5px solid ${open ? BLUE : '#E1E6F2'}`, background: open ? '#EEF2FF' : daySlots.length ? '#fff' : '#F7F8FA',
                          borderRadius: 12, padding: '12px 6px', cursor: daySlots.length ? 'pointer' : 'default', opacity: daySlots.length ? 1 : 0.5,
                        }}>
                        <div style={{ fontSize: 12.5, fontWeight: 700, color: NAVY }}>{fmtDay(date)}</div>
                        <div style={{ fontSize: 10.5, color: daySlots.length ? BLUE : '#9AA0AC', fontWeight: 700, marginTop: 3 }}>{daySlots.length ? `${daySlots.length} slots` : '—'}</div>
                      </button>
                      {open && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8, maxHeight: 260, overflowY: 'auto' }}>
                          {daySlots.map((s) => (
                            <button key={s.toISOString()} onClick={() => setSlot(s)}
                              style={{ border: `1.5px solid ${BLUE}55`, color: BLUE, fontWeight: 700, fontSize: 12.5, background: '#fff', borderRadius: 9, padding: '9px 4px', cursor: 'pointer' }}>
                              {fmtTime(s)}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        ) : (
          <>
            <button onClick={() => setSlot(null)} style={{ border: 0, background: 'none', color: '#6B7280', fontSize: 12.5, cursor: 'pointer', marginBottom: 12 }}>‹ Pick a different time</button>
            <div style={{ background: '#F5F7FC', border: '1px solid #E1E6F2', borderRadius: 12, padding: '14px 18px', marginBottom: 18, fontSize: 14, color: NAVY }}>
              <b>{fmtDay(slot)}, {fmtTime(slot)}</b> · {member?.slotMinutes} min · {tz}
            </div>
            <div style={{ display: 'grid', gap: 12, maxWidth: 460 }}>
              {([['Your name *', 'name', 'text'], ['Email *', 'email', 'email'], ['Phone (with country code)', 'phone', 'tel']] as const).map(([label, key, type]) => (
                <div key={key}>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#4B5563', marginBottom: 5 }}>{label}</label>
                  <input type={type} value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                    style={{ width: '100%', boxSizing: 'border-box', border: '1.5px solid #D9DFF0', borderRadius: 10, padding: '11px 13px', fontSize: 14, outline: 'none' }} />
                </div>
              ))}
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#4B5563', marginBottom: 5 }}>Anything we should know?</label>
                <textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} rows={3}
                  style={{ width: '100%', boxSizing: 'border-box', border: '1.5px solid #D9DFF0', borderRadius: 10, padding: '11px 13px', fontSize: 14, outline: 'none', resize: 'vertical' }} />
              </div>
              <button onClick={book} disabled={submitting}
                style={{ background: GOLD, color: NAVY, fontWeight: 800, fontSize: 15, border: 0, borderRadius: 12, padding: '15px 20px', cursor: 'pointer', opacity: submitting ? 0.6 : 1 }}>
                {submitting ? 'Booking…' : 'Confirm booking'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
