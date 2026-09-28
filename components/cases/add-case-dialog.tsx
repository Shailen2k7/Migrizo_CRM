'use client';

// =============================================================================
// NEW CASE — the "Open a new case" sheet on the Cases page.
// -----------------------------------------------------------------------------
// Drawn in the case page's own palette (lib/case-theme) so opening a case
// feels like part of the same product as the case you land on.
//
//   1  Client      pick a lead (converted ones first) or type a new client
//   2  Visa route  Global Talent / Innovator Founder as cards, others below
//
// A lead that already has a live case is shown but cannot be picked twice.
// Nothing is written until "Open case"; createCase() is unchanged.
// =============================================================================

import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '@/components/shared/app-provider';
import { getStageMeta, type Lead } from '@/lib/types';
import { C } from '@/lib/case-theme';
import { initials, avatarColor } from '@/lib/utils';
import { Search, X, Check, ArrowRight, UserRound, UserPlus, Loader2 } from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
  leads: Lead[];
  onCreated: (caseId: string) => void;
}

const MAIN_ROUTES = [
  { value: 'Global Talent Visa', short: 'GTV', title: 'Global Talent', note: 'Tech, research, arts & culture — endorsement route' },
  { value: 'Innovator Founder Visa', short: 'IFV', title: 'Innovator Founder', note: 'Founders with an endorsed UK business' },
];
const OTHER_ROUTES = ['Skilled Worker Visa', 'High Potential Individual Visa', 'Scale-up Visa'];

// Converted clients are the ones who need a case — they lead the list.
const RANK: Record<string, number> = { won: 0, invoice_sent: 1, mr_coming_soon: 2 };

export function AddCaseDialog({ open, onClose, leads, onCreated }: Props) {
  const { createCase, cases } = useApp();
  const [mode, setMode] = useState<'lead' | 'fresh'>('lead');
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<Lead | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [visa, setVisa] = useState('Global Talent Visa');
  const [busy, setBusy] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setMode('lead'); setSearch(''); setPicked(null);
    setName(''); setEmail(''); setPhone('');
    setVisa('Global Talent Visa'); setBusy(false);
  };
  const close = () => { if (busy) return; reset(); onClose(); };

  // Leads that already have a live case: shown, but not pickable twice.
  const withCase = useMemo(
    () => new Set(cases.filter((c) => !c.archived_at && c.lead_id).map((c) => c.lead_id as string)),
    [cases],
  );

  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    const pool = q
      ? leads.filter((l) => `${l.full_name} ${l.email ?? ''} ${l.phone ?? ''}`.toLowerCase().includes(q))
      : leads.filter((l) => l.stage in RANK);
    return [...pool]
      .sort((a, b) => Number(withCase.has(a.id)) - Number(withCase.has(b.id))
        || (RANK[a.stage] ?? 9) - (RANK[b.stage] ?? 9)
        || (b.updated_at ?? '').localeCompare(a.updated_at ?? ''))
      .slice(0, 30);
  }, [leads, search, withCase]);

  // Picking a lead carries its visa across, so the route is usually already right.
  const pick = (l: Lead) => {
    setPicked(l);
    const v = (l.visa_type || '').toLowerCase();
    if (v.includes('innovator') || v === 'ifv') setVisa('Innovator Founder Visa');
    else if (v.includes('global') || v === 'gtv') setVisa('Global Talent Visa');
  };

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => (mode === 'lead' ? searchRef : nameRef).current?.focus(), 60);
    return () => clearTimeout(t);
  }, [open, mode]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  const clientName = mode === 'lead' ? (picked?.full_name ?? '') : name.trim();
  const canSubmit = !busy && (mode === 'lead' ? !!picked : name.trim().length >= 2);

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    const id = await createCase({
      lead_id: mode === 'lead' ? picked!.id : null,
      client_name: clientName,
      visa_type: visa,
      ...(mode === 'fresh' ? { client_email: email.trim() || null, client_phone: phone.trim() || null } : {}),
    });
    setBusy(false);
    if (id) { reset(); onCreated(id); }
  };

  if (!open) return null;

  const field = 'h-11 w-full rounded-lg border px-3.5 text-[14px] outline-none transition placeholder:text-[#A8B0BB] focus:border-[#16A36B] focus:ring-4 focus:ring-[#16A36B]/10';

  return (
    <div className="fixed inset-0 z-[75] flex items-center justify-center p-3 sm:p-6" style={{ colorScheme: 'light' }}>
      <div className="absolute inset-0 animate-[fadeIn_.15s_ease]" style={{ background: 'rgba(15,31,61,.42)', backdropFilter: 'blur(3px)' }} onClick={close} />

      <div role="dialog" aria-modal="true" aria-labelledby="new-case-title"
        className="relative flex max-h-[min(860px,94vh)] w-full max-w-[640px] flex-col overflow-hidden rounded-2xl"
        style={{ background: C.card, color: C.ink, boxShadow: '0 32px 80px -24px rgba(15,31,61,.45), 0 0 0 1px rgba(15,31,61,.06)' }}>

        {/* Header */}
        <div className="flex items-start gap-4 border-b px-7 pb-5 pt-6" style={{ borderColor: C.line }}>
          <div className="min-w-0">
            <div className="text-[11.5px] font-bold tracking-[0.12em]" style={{ color: C.green }}>NEW CASE</div>
            <h2 id="new-case-title" className="m-0 mt-1 text-[22px] font-extrabold tracking-tight" style={{ color: C.navy }}>Open a new case</h2>
            <p className="m-0 mt-1 text-[14px] leading-relaxed" style={{ color: C.sub }}>
              Choose the client and their visa route. Their lead notes and payments come with them.
            </p>
          </div>
          <button onClick={close} aria-label="Close"
            className="-mr-2 ml-auto flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition hover:bg-[#F1F4F7]" style={{ color: C.sub }}>
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 space-y-7 overflow-y-auto px-7 py-6">

          {/* 1 · Client */}
          <section>
            <StepTitle n={1} title="Client" />
            <div className="mb-4 grid grid-cols-2 gap-1 rounded-lg p-1" style={{ background: '#F1F4F7' }}>
              {([['lead', 'From a lead', UserRound], ['fresh', 'New client', UserPlus]] as const).map(([k, label, Icon]) => {
                const on = mode === k;
                return (
                  <button key={k} onClick={() => setMode(k)}
                    className="flex h-9 items-center justify-center gap-2 rounded-md text-[13.5px] font-semibold transition"
                    style={on ? { background: C.card, color: C.navy, boxShadow: '0 1px 2px rgba(15,31,61,.08), 0 1px 3px rgba(15,31,61,.06)' } : { color: C.sub }}>
                    <Icon className="h-4 w-4" /> {label}
                  </button>
                );
              })}
            </div>

            {mode === 'lead' ? (
              <>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2" style={{ color: C.faint }} />
                  <input ref={searchRef} value={search} onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search by name, email or phone"
                    className={`${field} pl-11`} style={{ borderColor: C.line, color: C.ink }} />
                </div>
                <div className="mb-2 mt-3 flex items-center text-[12px] font-semibold tracking-[0.04em]" style={{ color: C.faint }}>
                  {search.trim() ? `${list.length} MATCH${list.length === 1 ? '' : 'ES'}` : 'READY FOR A CASE — CONVERTED FIRST'}
                </div>
                <div className="max-h-[288px] overflow-y-auto rounded-xl border" style={{ borderColor: C.line }}>
                  {list.length === 0 ? (
                    <div className="px-4 py-10 text-center text-[13.5px]" style={{ color: C.sub }}>
                      No leads match “{search.trim()}”.
                      <button onClick={() => { setMode('fresh'); setName(search.trim()); }}
                        className="ml-1 font-semibold hover:underline" style={{ color: C.greenDark }}>Add as a new client</button>
                    </div>
                  ) : list.map((l) => {
                    const taken = withCase.has(l.id);
                    const on = picked?.id === l.id;
                    const st = getStageMeta(l.stage);
                    return (
                      <button key={l.id} disabled={taken} onClick={() => pick(l)}
                        className="flex w-full items-center gap-3 border-b px-4 py-3 text-left transition last:border-b-0 enabled:hover:bg-[#F7FAF9] disabled:cursor-not-allowed"
                        style={{ borderColor: C.lineSoft, background: on ? C.greenBg : undefined, boxShadow: on ? `inset 3px 0 0 ${C.green}` : undefined }}>
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[12px] font-bold text-white"
                          style={{ background: avatarColor(l.full_name), opacity: taken ? 0.45 : 1 }}>{initials(l.full_name)}</span>
                        <span className="min-w-0 flex-1" style={{ opacity: taken ? 0.55 : 1 }}>
                          <span className="block truncate text-[14px] font-semibold" style={{ color: C.navy }}>{l.full_name}</span>
                          <span className="block truncate text-[12.5px]" style={{ color: C.sub }}>
                            {[l.phone, l.email].filter(Boolean).join(' · ') || 'No contact details'}
                          </span>
                        </span>
                        {taken ? (
                          <span className="shrink-0 rounded-full px-2.5 py-[3px] text-[11.5px] font-semibold" style={{ background: '#EEF1F4', color: C.sub }}>Has a case</span>
                        ) : (
                          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-[3px] text-[11.5px] font-semibold"
                            style={{ background: st.bg, color: st.fg }}>
                            <span className="h-1.5 w-1.5 rounded-full" style={{ background: st.dot }} />{st.label}
                          </span>
                        )}
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition"
                          style={on ? { background: C.green, borderColor: C.green } : { borderColor: taken ? 'transparent' : '#CBD2DB' }}>
                          {on && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="sm:col-span-2">
                  <FieldLabel>Full name</FieldLabel>
                  <input ref={nameRef} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Aditya Sharma"
                    className={field} style={{ borderColor: C.line, color: C.ink }} />
                </label>
                <label>
                  <FieldLabel optional>Email</FieldLabel>
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@email.com"
                    className={field} style={{ borderColor: C.line, color: C.ink }} />
                </label>
                <label>
                  <FieldLabel optional>Phone</FieldLabel>
                  <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+44 7700 900000"
                    className={field} style={{ borderColor: C.line, color: C.ink }} />
                </label>
              </div>
            )}
          </section>

          {/* 2 · Visa route */}
          <section>
            <StepTitle n={2} title="Visa route" />
            <div className="grid gap-3 sm:grid-cols-2">
              {MAIN_ROUTES.map((r) => {
                const on = visa === r.value;
                return (
                  <button key={r.value} onClick={() => setVisa(r.value)}
                    className="flex items-start gap-3 rounded-xl border p-4 text-left transition hover:border-[#9FD9BF]"
                    style={on ? { borderColor: C.green, background: C.greenBg, boxShadow: `0 0 0 1px ${C.green}` } : { borderColor: C.line }}>
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2"
                      style={on ? { borderColor: C.green } : { borderColor: '#CBD2DB' }}>
                      {on && <span className="h-2.5 w-2.5 rounded-full" style={{ background: C.green }} />}
                    </span>
                    <span className="min-w-0">
                      <span className="flex items-center gap-2 text-[14.5px] font-bold" style={{ color: C.navy }}>
                        {r.title}
                        <span className="rounded px-1.5 py-[1px] text-[10.5px] font-bold tracking-[0.06em]"
                          style={on ? { background: C.green, color: '#fff' } : { background: '#EEF1F4', color: C.sub }}>{r.short}</span>
                      </span>
                      <span className="mt-1 block text-[12.5px] leading-snug" style={{ color: C.sub }}>{r.note}</span>
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-[12.5px]" style={{ color: C.faint }}>Other routes</span>
              {OTHER_ROUTES.map((v) => {
                const on = visa === v;
                return (
                  <button key={v} onClick={() => setVisa(v)}
                    className="rounded-full border px-3 py-1 text-[12.5px] font-medium transition hover:border-[#9FD9BF]"
                    style={on ? { borderColor: C.green, background: C.greenBg, color: C.greenDark, fontWeight: 600 } : { borderColor: C.line, color: C.ink }}>
                    {v.replace(' Visa', '')}
                  </button>
                );
              })}
            </div>
          </section>

          <div className="flex gap-3 rounded-xl px-4 py-3.5 text-[13px] leading-relaxed" style={{ background: C.greenBg, color: C.ink }}>
            <span className="mt-[3px] h-2 w-2 shrink-0 rounded-full" style={{ background: C.green }} />
            <span>
              The case starts at <b style={{ color: C.navy }}>Step 1 · Case Created</b>, is assigned to <b style={{ color: C.navy }}>Mansi Behl</b>, and opens straight away
              so you can fill in the case details.
            </span>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center gap-3 border-t px-7 py-4" style={{ borderColor: C.line, background: '#FAFBFC' }}>
          <div className="hidden min-w-0 flex-1 truncate text-[13px] sm:block" style={{ color: C.sub }}>
            {clientName
              ? <>Opening for <b style={{ color: C.navy }}>{clientName}</b> · {visa.replace(' Visa', '')}</>
              : mode === 'lead' ? 'Select a client to continue' : 'Enter the client’s name to continue'}
          </div>
          <button onClick={close}
            className="ml-auto h-10 rounded-lg border px-4 text-[13.5px] font-semibold transition hover:bg-[#F4F6F8]"
            style={{ background: C.card, borderColor: '#D5DBE3', color: C.navy }}>Cancel</button>
          <button onClick={submit} disabled={!canSubmit}
            className="inline-flex h-10 items-center gap-2 rounded-lg px-5 text-[13.5px] font-semibold text-white transition enabled:hover:brightness-95 disabled:cursor-not-allowed"
            style={{ background: canSubmit || busy ? C.green : '#A9D9C2' }}>
            {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> Opening…</> : <>Open case <ArrowRight className="h-4 w-4" /></>}
          </button>
        </div>
      </div>
    </div>
  );
}

function StepTitle({ n, title }: { n: number; title: string }) {
  return (
    <div className="mb-3.5 flex items-center gap-3">
      <span className="flex h-7 w-7 items-center justify-center rounded-full text-[13px] font-bold"
        style={{ background: C.greenSoft, color: C.greenDark }}>{n}</span>
      <h3 className="m-0 text-[16px] font-bold" style={{ color: C.navy }}>{title}</h3>
    </div>
  );
}

function FieldLabel({ children, optional }: { children: React.ReactNode; optional?: boolean }) {
  return (
    <span className="mb-1.5 block text-[13px] font-semibold" style={{ color: C.navy }}>
      {children}{optional && <span className="ml-1 font-normal" style={{ color: C.faint }}>(optional)</span>}
    </span>
  );
}
