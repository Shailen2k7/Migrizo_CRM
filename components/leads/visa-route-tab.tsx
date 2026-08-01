'use client';

// =============================================================================
// VISA ROUTE TAB — one place that answers "which route is this client on, and
// what does that mean for them?"
//
// Everything downstream already keys off lead.visa_type: which agreement they
// receive, which process email, how their invoice milestones are labelled, and
// which case journey their tasks follow. Before this tab that field was a
// single dropdown buried in Overview, so it was easy to mix the two routes up
// and hard to see the consequences of the setting.
//
// This tab makes the route explicit: the active card states the fee structure
// and the journey in full, and switching is a deliberate, confirmed action.
// =============================================================================

import { useState } from 'react';
import { ArrowRightLeft, Check, FileText, Mail, Receipt, Route, AlertTriangle } from 'lucide-react';
import type { Lead } from '@/lib/types';
import { cn } from '@/lib/utils';

type RouteKey = 'gtv' | 'ifv';

const ROUTES: Record<RouteKey, {
  short: string; full: string; tagline: string;
  accent: string; tint: string; border: string;
  fee: string; milestones: [string, string][];
  gov: string; timeline: string;
  journey: string[];
}> = {
  gtv: {
    short: 'GTV', full: 'Global Talent Visa', tagline: 'For recognised leaders and rising talent in tech, science, academia and the arts.',
    accent: '#4338CA', tint: '#EEF2FF', border: '#C7D0F0',
    fee: '£3,000',
    milestones: [['Kickstart', '£500'], ['Profile Building', '£1,250'], ['Endorsement Submission', '£500'], ['Final Balance', '£750']],
    gov: 'Endorsement £561 · Visa £205 · IHS £1,035/yr · optional PR support',
    timeline: 'Endorsement 3–8 weeks · Visa 3 weeks',
    journey: ['Onboarding', 'Build the Profile', 'Write & Approve', 'Endorsement', 'Visa & Approval'],
  },
  ifv: {
    short: 'IFV', full: 'Innovator Founder Visa', tagline: 'For entrepreneurs establishing or scaling an innovative business in the UK.',
    accent: '#0E7490', tint: '#ECFEFF', border: '#A5E8F5',
    fee: '£3,000',
    milestones: [['Kickstart (Idea)', '£500'], ['Business Plan Stage', '£1,000'], ['Endorsement Submission', '£750'], ['Final Balance', '£750']],
    gov: 'Paid by the client directly to the relevant authority',
    timeline: 'Endorsement 4–6 weeks · Visa 2–3 weeks',
    journey: ['Onboarding', 'Build the Business Case', 'Write & Approve', 'Endorsement', 'Visa & Approval'],
  },
};

/** Resolve any stored visa_type (clean key or legacy free text) to a route. */
export function routeOf(visa: string | null | undefined): RouteKey {
  const v = (visa || '').toLowerCase();
  return v.includes('ifv') || v.includes('innovator') || v.includes('founder') ? 'ifv' : 'gtv';
}

interface Props {
  lead: Lead;
  onSwitch: (next: RouteKey) => Promise<void> | void;
  canEdit: boolean;
}

export function VisaRouteTab({ lead, onSwitch, canEdit }: Props) {
  const current = routeOf(lead.visa_type);
  const other: RouteKey = current === 'gtv' ? 'ifv' : 'gtv';
  const R = ROUTES[current];
  const O = ROUTES[other];
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const doSwitch = async () => {
    setBusy(true);
    await onSwitch(other);
    setBusy(false);
    setConfirming(false);
  };

  return (
    <div className="space-y-4">

      {/* ── the active route ── */}
      <div className="rounded-xl border overflow-hidden" style={{ borderColor: R.border }}>
        <div className="px-4 py-3 flex items-center gap-2.5" style={{ background: R.tint }}>
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-bold"
            style={{ background: '#fff', color: R.accent, border: `1px solid ${R.border}` }}>
            <Check className="w-3 h-3" /> ACTIVE ROUTE
          </span>
          <div className="min-w-0">
            <div className="text-[15px] font-semibold leading-tight" style={{ color: R.accent }}>{R.full}</div>
          </div>
        </div>
        <div className="px-4 py-3.5 bg-surface">
          <p className="text-[12.5px] text-muted leading-relaxed mb-3">{R.tagline}</p>

          <div className="text-[10px] font-extrabold tracking-[0.08em] uppercase text-faint mb-1.5">Professional fee · {R.fee}</div>
          <div className="rounded-lg border border-border overflow-hidden mb-3">
            {R.milestones.map(([label, amt], i) => (
              <div key={label} className={cn('flex items-center justify-between px-3 py-2 text-[12.5px]', i > 0 && 'border-t border-border')}>
                <span className="text-ink-2"><span className="text-faint mr-1.5">{i + 1}</span>{label}</span>
                <span className="font-semibold" style={{ color: R.accent }}>{amt}</span>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-2 mb-3">
            <div className="rounded-lg bg-surface-2 px-3 py-2">
              <div className="text-[10px] font-extrabold tracking-[0.06em] uppercase text-faint">Government costs</div>
              <div className="text-[12px] text-ink-2 mt-0.5 leading-relaxed">{R.gov}</div>
            </div>
            <div className="rounded-lg bg-surface-2 px-3 py-2">
              <div className="text-[10px] font-extrabold tracking-[0.06em] uppercase text-faint">Typical timeline</div>
              <div className="text-[12px] text-ink-2 mt-0.5">{R.timeline}</div>
            </div>
          </div>

          <div className="text-[10px] font-extrabold tracking-[0.08em] uppercase text-faint mb-1.5">Case journey</div>
          <div className="flex flex-wrap items-center gap-1.5">
            {R.journey.map((phase, i) => (
              <span key={phase} className="inline-flex items-center gap-1.5">
                <span className="px-2 py-1 rounded-md text-[11.5px] bg-surface-2 text-ink-2">{phase}</span>
                {i < R.journey.length - 1 && <span className="text-faint text-[10px]">›</span>}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* ── what the route controls ── */}
      <div className="rounded-xl border border-border bg-surface px-4 py-3.5">
        <div className="text-[10px] font-extrabold tracking-[0.08em] uppercase text-faint mb-2.5">This route decides</div>
        <div className="space-y-2.5">
          {[
            [FileText, 'Service Agreement', `The ${R.short} agreement, with its own scope and fee schedule`],
            [Mail, '"How it works" email', `The ${R.short} process document`],
            [Receipt, 'Invoice wording', `Milestones read as ${R.milestones.map((m) => m[0]).slice(0, 2).join(', ')}…`],
            [Route, 'Case journey', `Phase 2 is "${R.journey[1]}"`],
          ].map(([Icon, title, body]) => {
            const I = Icon as typeof FileText;
            return (
              <div key={title as string} className="flex gap-2.5">
                <I className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" style={{ color: R.accent }} />
                <div className="min-w-0">
                  <div className="text-[12.5px] font-medium leading-tight">{title as string}</div>
                  <div className="text-[11.5px] text-muted leading-relaxed mt-0.5">{body as string}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── switch ── */}
      {canEdit && (
        <div className="rounded-xl border border-border bg-surface px-4 py-3.5">
          {!confirming ? (
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="min-w-0 flex-1">
                <div className="text-[12.5px] font-medium">Wrong route for this client?</div>
                <div className="text-[11.5px] text-muted mt-0.5">Move them to the {O.full} and every document follows automatically.</div>
              </div>
              <button
                onClick={() => setConfirming(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12.5px] font-medium border transition-all flex-shrink-0"
                style={{ color: O.accent, borderColor: O.border, background: O.tint }}
              >
                <ArrowRightLeft className="w-3.5 h-3.5" /> Switch to {O.short}
              </button>
            </div>
          ) : (
            <div>
              <div className="flex gap-2.5 mb-3">
                <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                <div className="text-[12.5px] leading-relaxed">
                  <b>Move this client to the {O.full}?</b>
                  <div className="text-muted mt-1">
                    Future agreements, process emails and invoice labels will use {O.short}, and their case journey switches to the {O.short} phases.
                    Documents already sent are unaffected, and any payments recorded keep their amounts.
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 justify-end">
                <button onClick={() => setConfirming(false)} disabled={busy}
                  className="px-3 py-1.5 rounded-lg text-[12.5px] text-muted hover:bg-surface-2 transition-all disabled:opacity-50">Cancel</button>
                <button onClick={() => void doSwitch()} disabled={busy}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-[12.5px] font-semibold text-white transition-all disabled:opacity-50"
                  style={{ background: O.accent }}>
                  <ArrowRightLeft className="w-3.5 h-3.5" /> {busy ? 'Switching…' : `Yes, move to ${O.short}`}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
