// SLA milestone plans. "Standard" mirrors lib/email/branded.ts exactly; the
// 3-instalment preset merges the two Profile Building phases (500/1000/500,
// net £2,000 — the agreement shows the £1,000 difference as a discount).
// Rows stay fully editable, so any structure the client agreed is 30 seconds away.
//
// Lives in lib (not the drawer) so the server can use the same labels when it
// rebuilds an agreement that was sent before copies were kept.
import type { SlaMilestone } from '@/lib/email/branded';

export interface PlanRow { label: string; amount: string }

export const SLA_PLANS: Record<'gtv' | 'ifv', { standard: PlanRow[]; three: PlanRow[] }> = {
  gtv: {
    standard: [
      { label: 'Kickstart — Eligibility assessment, endorsing-body strategy and your personalised roadmap', amount: '500' },
      { label: 'Profile Building — Phase 1 — UK-style CV, LinkedIn, personal statement and the first evidence required', amount: '1000' },
      { label: 'Profile Building — Phase 2 — Recommendation letters, PR coordination and the criteria-mapped evidence portfolio', amount: '1000' },
      { label: 'Endorsement Submission — Final review and submission of the endorsement application. Payable before submission', amount: '500' },
    ],
    three: [
      { label: 'Kickstart — Eligibility assessment, endorsing-body strategy and your personalised roadmap', amount: '500' },
      { label: 'Profile Building — UK-style CV, LinkedIn, personal statement, recommendation letters, PR coordination and the criteria-mapped evidence portfolio', amount: '1000' },
      { label: 'Endorsement Submission — Final review and submission of the endorsement application. Payable before submission', amount: '500' },
    ],
  },
  ifv: {
    standard: [
      { label: 'Kickstart Fee (Idea) — Engagement commencement, founder profile and business idea development', amount: '500' },
      { label: 'Business Plan Stage — Due when business plan work starts: business structuring plan, business plan and financials', amount: '1000' },
      { label: 'All Document Delivery — Due on delivery of the complete document pack: business plan, financial forecast, pitch deck and founder statement', amount: '1000' },
      { label: 'Endorsement Application Submission — Due at the time of submission to the endorsing body', amount: '500' },
    ],
    three: [
      { label: 'Kickstart Fee (Idea) — Engagement commencement, founder profile and business idea development', amount: '500' },
      { label: 'Business Plan & Document Delivery — business structuring plan, business plan, financials, pitch deck and founder statement', amount: '1000' },
      { label: 'Endorsement Application Submission — Due at the time of submission to the endorsing body', amount: '500' },
    ],
  },
};

/**
 * Old SLA sends logged only the instalment amounts, not their labels. Put the
 * preset labels back when the amounts match a preset; otherwise number them.
 */
export function planFromAmounts(amounts: number[], kind: 'gtv' | 'ifv'): SlaMilestone[] {
  for (const preset of [SLA_PLANS[kind].standard, SLA_PLANS[kind].three]) {
    if (preset.length === amounts.length && preset.every((r, i) => Number(r.amount) === amounts[i])) {
      return preset.map((r, i) => ({ label: r.label, amount: amounts[i] }));
    }
  }
  return amounts.map((a, i) => ({ label: `Instalment ${i + 1}`, amount: a }));
}
