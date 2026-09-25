'use client';

// =============================================================================
// CVs FROM WHATSAPP — the popup on the Leads page.
// -----------------------------------------------------------------------------
// Answers three questions at a glance, for today or the last 7 days:
//   how many people sent us a CV on WhatsApp, how many CVs are saved on the
//   lead, and how many are NOT saved and need a person.
//
// Nobody is allowed to fall through silently. Every person whose CV was not
// saved is listed with the reason and a one-click way to finish the job:
//   probably a CV      → Save as CV / Not a CV
//   no matching lead   → find the lead, save
//   couldn't read file → open the file, open the lead, mark done
//
// It flashes while anyone is waiting, and updates live as CVs arrive.
// Self-contained: reads relay_cv_captures (written by the WhatsApp webhook)
// and resolves items through /api/cv-captures/[id].
// =============================================================================
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createClient } from '@/lib/supabase/client';

type Status = 'saved' | 'review' | 'unmatched' | 'unreadable' | 'not_cv' | 'approved' | 'dismissed';

interface Capture {
  id: string;
  conversation_id: string;
  lead_id: string | null;
  phone_e164: string | null;
  status: Status;
  reason: string | null;
  cv_score: number | null;
  file_name: string | null;
  received_at: string;
}

interface Person {
  key: string;
  day: string;
  leadId: string | null;
  phone: string | null;
  outcome: 'saved' | 'needs_you' | 'handled' | 'not_cv';
  /** The capture a person should act on first. */
  lead: Capture;
  pending: Capture[];
  files: Capture[];
  receivedAt: string;
}

const PENDING: Status[] = ['review', 'unmatched', 'unreadable'];
const RANK: Record<Status, number> = { saved: 6, approved: 6, review: 5, unmatched: 4, unreadable: 3, dismissed: 2, not_cv: 1 };

const istDay = (iso: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(iso));
const istTime = (iso: string) =>
  new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' }).format(new Date(iso));

function groupPeople(rows: Capture[]): Person[] {
  const map = new Map<string, Capture[]>();
  for (const r of rows) {
    const key = `${r.conversation_id}|${istDay(r.received_at)}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(r);
  }
  return [...map.entries()].map(([key, files]) => {
    const best = [...files].sort((a, b) => RANK[b.status] - RANK[a.status])[0];
    const pending = files.filter((f) => PENDING.includes(f.status));
    const saved = files.some((f) => f.status === 'saved' || f.status === 'approved');
    const outcome: Person['outcome'] = saved ? 'saved'
      : pending.length ? 'needs_you'
      : files.some((f) => f.status === 'dismissed') ? 'handled'
      : 'not_cv';
    const lead = pending.sort((a, b) => RANK[b.status] - RANK[a.status])[0] || best;
    return {
      key, day: istDay(best.received_at),
      leadId: files.find((f) => f.lead_id)?.lead_id ?? null,
      phone: best.phone_e164,
      outcome, lead, pending, files,
      receivedAt: files.map((f) => f.received_at).sort().pop()!,
    };
  }).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
}

export function CvInboxPopup({ onOpenLead }: { onOpenLead?: (leadId: string) => void }) {
  const supabase = useMemo(() => createClient(), []);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [range, setRange] = useState<'today' | 'week'>('today');
  const [rows, setRows] = useState<Capture[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searchFor, setSearchFor] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<{ id: string; full_name: string | null; phone: string | null; email: string | null }[]>([]);
  const [tableMissing, setTableMissing] = useState(false);
  const autoOpened = useRef(false);
  const knownNames = useRef<Record<string, string>>({});

  // ---- who am I ----------------------------------------------------------------
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase.from('workspace_members').select('workspace_id').eq('user_id', user.id).maybeSingle();
      if (data?.workspace_id) setWorkspaceId(data.workspace_id as string);
    })();
  }, [supabase]);

  // ---- load ------------------------------------------------------------------
  const load = useCallback(async () => {
    if (!workspaceId) return;
    const since = range === 'today'
      ? new Date(`${istDay(new Date().toISOString())}T00:00:00+05:30`).toISOString()
      : new Date(Date.now() - 7 * 86_400_000).toISOString();
    const { data, error: err } = await supabase
      .from('relay_cv_captures')
      .select('id, conversation_id, lead_id, phone_e164, status, reason, cv_score, file_name, received_at')
      .eq('workspace_id', workspaceId).gte('received_at', since)
      .order('received_at', { ascending: false }).limit(1000);
    if (err) { setTableMissing(/relation|does not exist|schema cache/i.test(err.message)); return; }
    setTableMissing(false);
    const list = (data || []) as Capture[];
    setRows(list);

    const ids = [...new Set(list.map((r) => r.lead_id).filter(Boolean) as string[])].filter((id) => !(id in knownNames.current));
    if (ids.length) {
      const { data: leads } = await supabase.from('leads').select('id, full_name').in('id', ids);
      if (leads?.length) {
        knownNames.current = { ...knownNames.current, ...Object.fromEntries(leads.map((l) => [l.id, l.full_name || 'Unnamed lead'])) };
        setNames(knownNames.current);
      }
    }
  }, [supabase, workspaceId, range]);

  useEffect(() => { load(); }, [load]);

  // ---- live ------------------------------------------------------------------
  useEffect(() => {
    if (!workspaceId) return;
    const ch = supabase
      .channel(`cv-captures-${workspaceId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'relay_cv_captures', filter: `workspace_id=eq.${workspaceId}` },
        () => { load(); })
      .subscribe();
    const t = setInterval(() => load(), 60_000);   // backstop if the socket sleeps
    return () => { supabase.removeChannel(ch); clearInterval(t); };
  }, [supabase, workspaceId, load]);

  // ---- numbers ---------------------------------------------------------------
  const people = useMemo(() => groupPeople(rows), [rows]);
  const received = people.filter((p) => p.outcome !== 'not_cv');
  const saved = people.filter((p) => p.outcome === 'saved');
  const needsYou = people.filter((p) => p.outcome === 'needs_you');
  const notCv = people.filter((p) => p.outcome === 'not_cv').length;

  // Open by itself once, the first time someone is waiting.
  useEffect(() => {
    if (!autoOpened.current && needsYou.length > 0) { autoOpened.current = true; setOpen(true); }
  }, [needsYou.length]);

  // ---- actions ---------------------------------------------------------------
  async function act(captureIds: string[], action: 'approve' | 'dismiss', leadId?: string) {
    setBusy(captureIds[0]); setError(null);
    try {
      for (const id of captureIds) {
        const res = await fetch(`/api/cv-captures/${id}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, leadId }),
        });
        const j = await res.json().catch(() => ({ ok: false, error: `Error ${res.status}` }));
        if (!j.ok) { setError(j.error || 'That did not work.'); break; }
        if (action === 'approve') break;   // one CV per person is enough
      }
      setSearchFor(null); setQuery(''); setResults([]);
      await load();
    } finally { setBusy(null); }
  }

  useEffect(() => {
    if (!searchFor || query.trim().length < 2 || !workspaceId) { setResults([]); return; }
    const q = query.trim().replace(/[%,()]/g, '');
    const t = setTimeout(async () => {
      const { data } = await supabase.from('leads').select('id, full_name, phone, email')
        .eq('workspace_id', workspaceId)
        .or(`full_name.ilike.%${q}%,email.ilike.%${q}%,phone.ilike.%${q}%`)
        .limit(6);
      setResults(data || []);
    }, 250);
    return () => clearTimeout(t);
  }, [query, searchFor, supabase, workspaceId]);

  if (!workspaceId || tableMissing) return null;

  const flashing = needsYou.length > 0;
  const label = (p: Person) => (p.leadId && names[p.leadId]) || p.phone || 'Unknown sender';

  // ---- collapsed pill --------------------------------------------------------
  if (!open) {
    return (
      <>
        <style>{KEYFRAMES}</style>
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-5 right-5 z-50 flex items-center gap-2.5 rounded-full border border-border bg-surface px-4 py-2.5 text-[13px] font-semibold text-ink shadow-lg"
          style={flashing ? { animation: 'cvRing 1.6s ease-out infinite' } : undefined}
        >
          <span className="relative flex h-2.5 w-2.5">
            {flashing && <span className="absolute inline-flex h-full w-full rounded-full" style={{ background: '#e5484d', animation: 'cvPing 1.2s cubic-bezier(0,0,.2,1) infinite' }} />}
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full" style={{ background: flashing ? '#e5484d' : '#30a46c' }} />
          </span>
          CVs from WhatsApp
          <span className="text-muted font-medium">
            {flashing ? `· ${needsYou.length} need${needsYou.length === 1 ? 's' : ''} you` : `· ${saved.length} saved`}
          </span>
        </button>
      </>
    );
  }

  // ---- open card -------------------------------------------------------------
  const Stat = ({ n, label: l, tone }: { n: number; label: string; tone: string }) => (
    <div className="flex-1 rounded-xl bg-surface-2 px-3 py-2.5">
      <div className="text-[22px] font-bold leading-none" style={{ color: tone }}>{n}</div>
      <div className="mt-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-faint">{l}</div>
    </div>
  );

  const groups: { title: string; hint: string; items: Person[] }[] = [
    { title: 'Probably a CV — confirm', hint: 'Readable and CV-like, but not certain enough to save on its own.', items: needsYou.filter((p) => p.lead.status === 'review') },
    { title: 'No matching lead', hint: 'Looks like a CV, but the number, form and CV match no lead.', items: needsYou.filter((p) => p.lead.status === 'unmatched') },
    { title: 'Could not read the file', hint: 'Scans, photos, old .doc files or garbled PDFs — open and check.', items: needsYou.filter((p) => p.lead.status === 'unreadable') },
  ];

  return (
    <>
      <style>{KEYFRAMES}</style>
      <div
        className="fixed bottom-5 right-5 z-50 flex w-[400px] max-w-[calc(100vw-2.5rem)] flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl"
        style={{ maxHeight: '72vh', ...(flashing ? { animation: 'cvRing 1.6s ease-out infinite' } : {}) }}
      >
        {/* header */}
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2.5 w-2.5">
              {flashing && <span className="absolute inline-flex h-full w-full rounded-full" style={{ background: '#e5484d', animation: 'cvPing 1.2s cubic-bezier(0,0,.2,1) infinite' }} />}
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full" style={{ background: flashing ? '#e5484d' : '#30a46c' }} />
            </span>
            <span className="text-[14px] font-bold text-ink">CVs from WhatsApp</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="flex rounded-lg bg-surface-2 p-0.5 text-[11.5px] font-semibold">
              {(['today', 'week'] as const).map((r) => (
                <button key={r} onClick={() => setRange(r)}
                  className={`rounded-md px-2.5 py-1 ${range === r ? 'bg-surface text-ink shadow-sm' : 'text-muted'}`}>
                  {r === 'today' ? 'Today' : '7 days'}
                </button>
              ))}
            </div>
            <button onClick={() => setOpen(false)} aria-label="Minimise"
              className="rounded-md px-2 py-1 text-[16px] leading-none text-muted hover:text-ink">–</button>
          </div>
        </div>

        {/* numbers */}
        <div className="flex gap-2 px-4 pt-3">
          <Stat n={received.length} label="Received" tone="hsl(var(--ink))" />
          <Stat n={saved.length} label="Saved" tone="#30a46c" />
          <Stat n={needsYou.length} label="Not saved" tone={needsYou.length ? '#e5484d' : 'hsl(var(--faint))'} />
        </div>
        <div className="px-4 pb-2 pt-1.5 text-[11.5px] text-muted">
          People, not files{notCv ? ` · ${notCv} sent documents that were not CVs` : ''}.
        </div>

        {error && <div className="mx-4 mb-2 rounded-lg px-3 py-2 text-[12px]" style={{ background: 'rgba(229,72,77,.1)', color: '#e5484d' }}>{error}</div>}

        {/* who needs you */}
        <div className="overflow-y-auto px-4 pb-4">
          {needsYou.length === 0 ? (
            <div className="rounded-xl bg-surface-2 px-3 py-4 text-center text-[12.5px] text-muted">
              {received.length ? 'Every CV is saved on its lead. Nobody is waiting.' : 'No CVs have arrived on WhatsApp yet.'}
            </div>
          ) : groups.filter((g) => g.items.length).map((g) => (
            <div key={g.title} className="mt-2">
              <div className="text-[10.5px] font-extrabold uppercase tracking-[0.07em] text-faint">{g.title} · {g.items.length}</div>
              <div className="mb-1 text-[11.5px] text-muted">{g.hint}</div>
              {g.items.map((p) => (
                <div key={p.key} className="mb-2 rounded-xl border border-border px-3 py-2.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-[13px] font-semibold text-ink">{label(p)}</span>
                    <span className="shrink-0 text-[11px] text-faint">{istTime(p.receivedAt)}</span>
                  </div>
                  <div className="mt-0.5 text-[12px] text-ink-2">
                    {p.lead.reason}{p.files.length > 1 ? ` · ${p.files.length} files` : ''}
                  </div>

                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {p.lead.status === 'review' && (
                      <Btn primary disabled={busy === p.lead.id} onClick={() => act([p.lead.id], 'approve')}>Save as CV</Btn>
                    )}
                    {p.lead.status === 'unmatched' && (
                      <Btn primary onClick={() => { setSearchFor(p.key); setQuery(''); }}>Find lead</Btn>
                    )}
                    <Btn onClick={() => window.open(`/api/cv-captures/${p.lead.id}`, '_blank')}>
                      Open file{p.files.length > 1 ? ` (1 of ${p.files.length})` : ''}
                    </Btn>
                    {p.leadId && onOpenLead && <Btn onClick={() => onOpenLead(p.leadId!)}>Open lead</Btn>}
                    <Btn disabled={busy === p.lead.id} onClick={() => act(p.pending.map((c) => c.id), 'dismiss')}>
                      {p.lead.status === 'review' ? 'Not a CV' : 'Done'}
                    </Btn>
                  </div>

                  {searchFor === p.key && (
                    <div className="mt-2">
                      <input
                        autoFocus value={query} onChange={(e) => setQuery(e.target.value)}
                        placeholder="Search lead by name, email or phone"
                        className="w-full rounded-lg border border-border bg-bg px-2.5 py-1.5 text-[12.5px] text-ink outline-none"
                      />
                      {results.map((l) => (
                        <button key={l.id} onClick={() => act([p.lead.id], 'approve', l.id)}
                          className="mt-1 flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-[12.5px] hover:bg-surface-2">
                          <span className="truncate text-ink">{l.full_name || 'Unnamed lead'}</span>
                          <span className="ml-2 shrink-0 text-[11px] text-faint">{l.phone || l.email}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function Btn({ children, onClick, primary, disabled }: { children: ReactNode; onClick: () => void; primary?: boolean; disabled?: boolean }) {
  return (
    <button
      onClick={onClick} disabled={disabled}
      className={`rounded-lg px-2.5 py-1 text-[12px] font-semibold disabled:opacity-50 ${primary ? 'text-white' : 'border border-border bg-surface text-ink'}`}
      style={primary ? { background: '#30a46c' } : undefined}
    >
      {children}
    </button>
  );
}

const KEYFRAMES = `
@keyframes cvPing { 75%, 100% { transform: scale(2.2); opacity: 0; } }
@keyframes cvRing {
  0%   { box-shadow: 0 0 0 0 rgba(229,72,77,.45), 0 10px 30px rgba(0,0,0,.12); }
  70%  { box-shadow: 0 0 0 10px rgba(229,72,77,0), 0 10px 30px rgba(0,0,0,.12); }
  100% { box-shadow: 0 0 0 0 rgba(229,72,77,0), 0 10px 30px rgba(0,0,0,.12); }
}
@media (prefers-reduced-motion: reduce) { [style*="cvRing"], [style*="cvPing"] { animation: none !important; } }
`;
