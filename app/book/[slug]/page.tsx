'use client';

// =============================================================================
// PUBLIC BOOKING PAGE — /book/<slug>   (Calendly-style)
// Centered brand header → profile + meeting info → month calendar grid with
// available dates highlighted → time list for the picked date → details form
// → confirmation. Times render in the visitor's timezone (changeable).
// =============================================================================
import { useState, useEffect, useMemo, use } from 'react';

interface MemberInfo { name: string; title: string; bio: string | null; slotMinutes: number; timezone: string; }

const NAVY = '#16294E'; const BLUE = '#3E56D4'; const GOLD = '#F4C430';

const COMMON_TZS = ['Asia/Kolkata','Europe/London','Asia/Dubai','America/New_York','America/Los_Angeles','America/Chicago','Europe/Berlin','Asia/Singapore','Australia/Sydney','Asia/Riyadh'];

export default function BookingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const detected = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata', []);
  const [tz, setTz] = useState(detected);
  const [member, setMember] = useState<MemberInfo | null>(null);
  const [slots, setSlots] = useState<Date[]>([]);
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [loading, setLoading] = useState(true);
  const [pickedDay, setPickedDay] = useState<string | null>(null);
  const [slot, setSlot] = useState<Date | null>(null);
  const [step, setStep] = useState<'pick' | 'form' | 'done'>('pick');
  const [form, setForm] = useState({ name: '', email: '', phone: '', note: '' });
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<{ meetLink: string | null } | null>(null);
  const [error, setError] = useState('');

  const tzList = useMemo(() => {
    try { const all = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone'); if (all && all.length) return all; } catch { /* older browsers */ }
    return Array.from(new Set([detected, ...COMMON_TZS]));
  }, [detected]);

  // Fetch availability for the visible month (from today if current month).
  useEffect(() => {
    const now = new Date();
    const monthStart = new Date(month);
    const from = monthStart < now ? now : monthStart;
    const monthEnd = new Date(month.getFullYear(), month.getMonth() + 1, 1);
    const days = Math.max(1, Math.min(31, Math.ceil((monthEnd.getTime() - from.getTime()) / 864e5)));
    if (monthEnd <= now) { setSlots([]); return; }
    setLoading(true);
    fetch(`/api/booking/${slug}/slots?from=${from.toISOString()}&days=${days}`)
      .then((r) => r.json())
      .then((d) => {
        // A paused page is not a broken page. Show the founder's own words.
        if (d.ok && d.paused) { setMember(d.member); setSlots([]); setError(d.message || 'Bookings are paused right now.'); return; }
        if (d.ok) { setMember(d.member); setSlots(d.slots.map((s: string) => new Date(s))); setError(''); }
        else setError('This booking page is not available.');
      })
      .catch(() => setError('Could not load availability.'))
      .finally(() => setLoading(false));
  }, [slug, month]);

  const dayKey = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  const byDay = useMemo(() => {
    const m = new Map<string, Date[]>();
    for (const s of slots) { const k = dayKey(s); if (!m.has(k)) m.set(k, []); m.get(k)!.push(s); }
    return m;
  }, [slots, tz]);

  // Month grid (Mon-first), in the VISITOR's timezone by calendar date.
  const grid = useMemo(() => {
    const y = month.getFullYear(), mo = month.getMonth();
    const first = new Date(y, mo, 1);
    const lead = (first.getDay() + 6) % 7; // Mon=0
    const daysInMonth = new Date(y, mo + 1, 0).getDate();
    const cells: (Date | null)[] = [];
    for (let i = 0; i < lead; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(y, mo, d));
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [month]);

  const keyOfCell = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const fmtTime = (d: Date) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true }).format(d);
  const fmtLong = (d: Date) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(d);
  const tzLabel = useMemo(() => {
    try {
      const name = new Intl.DateTimeFormat('en-GB', { timeZone: tz, timeZoneName: 'long' }).formatToParts(new Date()).find((p) => p.type === 'timeZoneName')?.value || tz;
      const now = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date());
      return `${name} (${now})`;
    } catch { return tz; }
  }, [tz]);

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
      if (!d.ok) {
        setError(d.reason === 'slot_taken' ? 'That time was just taken — please pick another.' : 'Something went wrong. Please try again.');
        if (d.reason === 'slot_taken') { setSlot(null); setStep('pick'); setMonth(new Date(month)); }
      } else { setDone({ meetLink: d.meetLink }); setStep('done'); }
    } catch { setError('Network error — please try again.'); }
    setSubmitting(false);
  }

  const initials = (member?.name || '  ').split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  const monthLabel = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' }).format(month);
  const prevDisabled = month.getFullYear() === new Date().getFullYear() && month.getMonth() <= new Date().getMonth();

  return (
    <div style={{ minHeight: '100vh', background: '#EEF1F8', fontFamily: "-apple-system,'Segoe UI',Roboto,Arial,sans-serif", padding: '26px 14px 40px' }}>
      <style>{`
        .cal-day{width:44px;height:44px;border-radius:50%;border:0;font-size:14px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;transition:.13s;font-family:inherit}
        .cal-day.avail{background:#EEF2FF;color:${BLUE}}
        .cal-day.avail:hover{background:#DDE5FF}
        .cal-day.sel{background:${BLUE} !important;color:#fff !important}
        .cal-day.off{background:transparent;color:#B6BCC8;cursor:default;font-weight:500}
        .tbtn{display:block;width:100%;border:1.5px solid ${BLUE}66;color:${BLUE};font-weight:700;font-size:13.5px;background:#fff;border-radius:9px;padding:12px 6px;cursor:pointer;transition:.12s;font-family:inherit}
        .tbtn:hover{border-color:${BLUE};background:#F7F9FF}
        .mgz-cols{display:grid;grid-template-columns:1fr 240px;gap:26px}
        @media(max-width:720px){.mgz-cols{display:block}.mgz-times{margin-top:18px}}
        input.mgz,textarea.mgz{width:100%;box-sizing:border-box;border:1.5px solid #D9DFF0;border-radius:10px;padding:12px 13px;font-size:14px;outline:none;font-family:inherit}
        input.mgz:focus,textarea.mgz:focus{border-color:${BLUE}}
      `}</style>
      <div style={{ maxWidth: 860, margin: '0 auto' }}>
        <div style={{ background: '#fff', borderRadius: 20, boxShadow: '0 8px 32px rgba(22,41,78,.10)', overflow: 'hidden' }}>
          <div style={{ height: 4, background: `linear-gradient(90deg,${GOLD},${BLUE},${NAVY})` }} />

          {/* Brand header */}
          <div style={{ textAlign: 'center', padding: '26px 20px 20px', borderBottom: '1px solid #EEF1F8' }}>
            <img src="/migrizo-email-logo.png" alt="Migrizo" style={{ height: 44 }} />
          </div>

          {step === 'done' && done ? (
            <div style={{ padding: '48px 26px 56px', textAlign: 'center' }}>
              <div style={{ width: 62, height: 62, borderRadius: '50%', background: '#E6F7EE', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 30 }}>✅</div>
              <h1 style={{ fontSize: 25, color: NAVY, margin: '16px 0 8px', fontWeight: 800 }}>You are scheduled</h1>
              <p style={{ fontSize: 14, color: '#4B5563', margin: '0 0 18px' }}>A calendar invitation and confirmation has been sent to <b>{form.email}</b>.</p>
              <div style={{ display: 'inline-block', textAlign: 'left', background: '#F5F7FC', border: '1px solid #E1E6F2', borderRadius: 14, padding: '18px 24px', fontSize: 14, color: NAVY, lineHeight: 2 }}>
                <b style={{ fontSize: 15 }}>{member?.title}</b><br />
                🧑‍💼 {member?.name}<br />
                📅 {slot && fmtLong(slot)}<br />
                ⏰ {slot && fmtTime(slot)} · {member?.slotMinutes} min<br />
                🌐 {tzLabel}
              </div>
              <div style={{ marginTop: 20 }}>
                {done.meetLink && <a href={done.meetLink} style={{ display: 'inline-block', background: GOLD, color: NAVY, fontWeight: 800, fontSize: 14, padding: '13px 26px', borderRadius: 10, textDecoration: 'none' }}>Open meeting link →</a>}
              </div>
              <p style={{ fontSize: 12, color: '#8A90A0', marginTop: 16 }}>Reminders with one-click reschedule &amp; cancel will arrive before the meeting.</p>
            </div>
          ) : (
            <>
              {/* Profile / meeting info */}
              <div style={{ textAlign: 'center', padding: '26px 20px 22px', borderBottom: '1px solid #EEF1F8' }}>
                <div style={{ width: 74, height: 74, borderRadius: '50%', margin: '0 auto 12px', background: `linear-gradient(135deg,${BLUE},${NAVY})`, color: '#fff', fontSize: 26, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', letterSpacing: 1 }}>{initials}</div>
                <div style={{ fontSize: 14, color: '#8A90A0', fontWeight: 600 }}>{member?.name || '…'}</div>
                <h1 style={{ fontSize: 27, color: NAVY, fontWeight: 800, margin: '4px 0 12px' }}>{member?.title || 'Consultation'}</h1>
                <div style={{ display: 'inline-flex', gap: 22, flexWrap: 'wrap', justifyContent: 'center', fontSize: 13.5, color: '#4B5563', fontWeight: 600 }}>
                  <span>🕐 {member?.slotMinutes || 30} min</span>
                  <span>📹 Web conferencing details provided upon confirmation</span>
                </div>
              </div>

              {step === 'pick' && (
                <div style={{ padding: '26px 26px 32px' }}>
                  <h2 style={{ fontSize: 19, color: NAVY, fontWeight: 800, textAlign: 'center', margin: '0 0 18px' }}>Select a Date &amp; Time</h2>
                  {error && <div style={{ background: '#FDECEC', color: '#B91C1C', borderRadius: 10, padding: '10px 14px', fontSize: 13, marginBottom: 14, textAlign: 'center' }}>{error}</div>}
                  <div className="mgz-cols">
                    {/* Calendar */}
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 18, marginBottom: 14 }}>
                        <button onClick={() => !prevDisabled && setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
                          style={{ border: 0, background: prevDisabled ? 'transparent' : '#EEF2FF', color: prevDisabled ? '#C7CDD9' : BLUE, width: 34, height: 34, borderRadius: '50%', fontSize: 16, cursor: prevDisabled ? 'default' : 'pointer' }}>‹</button>
                        <div style={{ fontSize: 15.5, fontWeight: 700, color: NAVY, minWidth: 150, textAlign: 'center' }}>{monthLabel}</div>
                        <button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
                          style={{ border: 0, background: '#EEF2FF', color: BLUE, width: 34, height: 34, borderRadius: '50%', fontSize: 16, cursor: 'pointer' }}>›</button>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 4, textAlign: 'center' }}>
                        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d} style={{ fontSize: 11.5, fontWeight: 700, color: '#8A90A0', padding: '4px 0 8px' }}>{d}</div>)}
                        {grid.map((cell, i) => {
                          if (!cell) return <div key={i} />;
                          const k = keyOfCell(cell);
                          const has = (byDay.get(k) || []).length > 0;
                          const sel = pickedDay === k;
                          return (
                            <div key={i} style={{ display: 'flex', justifyContent: 'center', padding: '2px 0' }}>
                              <button className={`cal-day ${sel ? 'sel' : has ? 'avail' : 'off'}`} disabled={!has}
                                onClick={() => { setPickedDay(k); setSlot(null); }}>
                                {cell.getDate()}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                      {loading && <div style={{ textAlign: 'center', fontSize: 12.5, color: '#8A90A0', marginTop: 10 }}>Loading availability…</div>}
                      {/* Timezone */}
                      <div style={{ marginTop: 20 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 700, color: NAVY, marginBottom: 6 }}>Time zone</div>
                        <select value={tz} onChange={(e) => { setTz(e.target.value); setPickedDay(null); setSlot(null); }}
                          style={{ width: '100%', maxWidth: 340, border: '1.5px solid #D9DFF0', borderRadius: 10, padding: '10px 12px', fontSize: 13.5, color: NAVY, fontWeight: 600, outline: 'none', background: '#fff' }}>
                          {tzList.map((z) => <option key={z} value={z}>{z.replace(/_/g, ' ')}{z === detected ? ' (detected)' : ''}</option>)}
                        </select>
                        <div style={{ fontSize: 11.5, color: '#8A90A0', marginTop: 5 }}>🌐 {tzLabel}</div>
                      </div>
                    </div>
                    {/* Times for the picked day */}
                    <div className="mgz-times">
                      {pickedDay ? (
                        <>
                          <div style={{ fontSize: 13.5, fontWeight: 700, color: NAVY, marginBottom: 10 }}>
                            {(() => { const list = byDay.get(pickedDay) || []; return list.length ? new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long' }).format(list[0]) : ''; })()}
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 360, overflowY: 'auto', paddingRight: 4 }}>
                            {(byDay.get(pickedDay) || []).map((s) => (
                              <button key={s.toISOString()} className="tbtn" onClick={() => { setSlot(s); setStep('form'); }}>{fmtTime(s)}</button>
                            ))}
                          </div>
                        </>
                      ) : (
                        <div style={{ border: '1.5px dashed #D9DFF0', borderRadius: 12, padding: '34px 16px', textAlign: 'center', fontSize: 12.5, color: '#8A90A0' }}>
                          Select an available date to see times
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {step === 'form' && slot && (
                <div style={{ padding: '26px 26px 34px', maxWidth: 560, margin: '0 auto' }}>
                  <button onClick={() => setStep('pick')} style={{ border: 0, background: 'none', color: '#6B7280', fontSize: 12.5, cursor: 'pointer', marginBottom: 12, fontFamily: 'inherit' }}>‹ Change time</button>
                  <div style={{ background: '#F5F7FC', border: '1px solid #E1E6F2', borderRadius: 12, padding: '14px 18px', marginBottom: 18, fontSize: 14, color: NAVY }}>
                    📅 <b>{fmtLong(slot)}</b><br />⏰ <b>{fmtTime(slot)}</b> · {member?.slotMinutes} min · {tzLabel}
                  </div>
                  <h2 style={{ fontSize: 17, color: NAVY, fontWeight: 800, margin: '0 0 14px' }}>Enter your details</h2>
                  {error && <div style={{ background: '#FDECEC', color: '#B91C1C', borderRadius: 10, padding: '10px 14px', fontSize: 13, marginBottom: 12 }}>{error}</div>}
                  <div style={{ display: 'grid', gap: 12 }}>
                    <div><label style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: '#4B5563', marginBottom: 5 }}>Name *</label>
                      <input className="mgz" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
                    <div><label style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: '#4B5563', marginBottom: 5 }}>Email *</label>
                      <input className="mgz" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
                    <div><label style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: '#4B5563', marginBottom: 5 }}>Phone (with country code)</label>
                      <input className="mgz" type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
                    <div><label style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: '#4B5563', marginBottom: 5 }}>Please share anything that will help prepare for our meeting</label>
                      <textarea className="mgz" rows={3} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} style={{ resize: 'vertical' }} /></div>
                    <button onClick={book} disabled={submitting}
                      style={{ background: BLUE, color: '#fff', fontWeight: 800, fontSize: 15, border: 0, borderRadius: 999, padding: '15px 20px', cursor: 'pointer', opacity: submitting ? 0.6 : 1, fontFamily: 'inherit' }}>
                      {submitting ? 'Scheduling…' : 'Schedule Event'}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
        <div style={{ textAlign: 'center', fontSize: 11.5, color: '#8A90A0', marginTop: 16 }}>Powered by Migrizo · Smart. Fast. Reliable Visas</div>
      </div>
    </div>
  );
}
