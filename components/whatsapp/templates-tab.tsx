'use client';

// =============================================================================
// TEMPLATES TAB — the library, with Meta's verdict on every card.
//
// Bodies are read-only ON PURPOSE. The text in this database must stay
// byte-identical to the text Meta approved — a CRM-side edit would make every
// preview a lie and could push variable values into the wrong slots. The copy
// buttons exist so submitting to Interakt is paste-paste-submit, and the
// webhook flips draft -> approved here automatically when Meta decides.
// =============================================================================
import { useMemo, useState } from 'react';
import { Copy, Check, FileText, Clock, XCircle, CheckCircle2, PauseCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import type { WaTemplate } from '@/lib/whatsapp/types';

const META_CHIP: Record<string, { cls: string; icon: React.ReactNode; label: string }> = {
  approved: { cls: 'border-[#D7F3E1] bg-[#EDFAF1] text-[#1B7A44]', icon: <CheckCircle2 className="h-[11px] w-[11px]" />, label: 'Approved' },
  submitted: { cls: 'border-[#DDE5FB] bg-[#EEF2FE] text-[#3B5BDB]', icon: <Clock className="h-[11px] w-[11px]" />, label: 'In review' },
  draft: { cls: 'border-[#F8E2B8] bg-[#FEF6E6] text-[#A25D07]', icon: <Clock className="h-[11px] w-[11px]" />, label: 'Not submitted' },
  rejected: { cls: 'border-[#F8D6D6] bg-[#FEEFEF] text-[#B02B2B]', icon: <XCircle className="h-[11px] w-[11px]" />, label: 'Rejected' },
  paused: { cls: 'border-[#EDEFF3] bg-[#F5F6F9] text-[#7A8095]', icon: <PauseCircle className="h-[11px] w-[11px]" />, label: 'Paused by Meta' },
};

export default function TemplatesTab({ templates }: { templates: WaTemplate[] }) {
  const [track, setTrack] = useState<'all' | 'cold' | 'hot'>('all');
  const [copied, setCopied] = useState<string | null>(null);

  const active = useMemo(() => templates.filter((t) => t.active), [templates]);
  const shown = useMemo(
    () => active.filter((t) => track === 'all' || t.track === track),
    [active, track]
  );
  const counts = useMemo(() => ({
    approved: active.filter((t) => t.meta_status === 'approved').length,
    pending: active.filter((t) => t.meta_status === 'draft' || t.meta_status === 'submitted').length,
    rejected: active.filter((t) => t.meta_status === 'rejected').length,
  }), [active]);

  async function copy(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1400);
    } catch {
      toast.error('Clipboard blocked by the browser — copy manually');
    }
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-[14px]">
      {/* summary strip */}
      <div className="mb-[14px] flex flex-wrap items-center gap-[10px] rounded-[14px] border border-[#E8EAF0] bg-white px-[18px] py-[14px] shadow-[0_1px_2px_rgba(20,24,40,.06)]">
        <FileText className="h-[18px] w-[18px] text-[#1B7A44]" />
        <b className="text-[14px] font-semibold tracking-[-.02em]">{active.length} templates</b>
        <span className="rounded-full border border-[#D7F3E1] bg-[#EDFAF1] px-[10px] py-[4px] text-[11.4px] font-semibold text-[#1B7A44]">{counts.approved} approved</span>
        <span className="rounded-full border border-[#F8E2B8] bg-[#FEF6E6] px-[10px] py-[4px] text-[11.4px] font-semibold text-[#A25D07]">{counts.pending} awaiting Meta</span>
        {counts.rejected > 0 && (
          <span className="rounded-full border border-[#F8D6D6] bg-[#FEEFEF] px-[10px] py-[4px] text-[11.4px] font-semibold text-[#B02B2B]">{counts.rejected} rejected</span>
        )}
        <span className="ml-auto text-[12px] text-muted">
          Submit in Interakt → Templates. Approval updates here automatically via the webhook.
        </span>
      </div>

      {/* track filter */}
      <div className="mb-[12px] flex gap-[6px]">
        {([['all', 'All'], ['cold', 'Cold'], ['hot', 'Hot']] as const).map(([k, l]) => (
          <button key={k} onClick={() => setTrack(k)}
            className={cn(
              'rounded-full border px-[14px] py-[6px] text-[12.6px] font-semibold transition',
              track === k ? 'border-[#25A25A] bg-[#25A25A] text-white' : 'border-[#DDE0E9] bg-white text-ink-2 hover:bg-[#F5F6F9]'
            )}>
            {l} <span className="opacity-60">{active.filter((t) => k === 'all' || t.track === k).length}</span>
          </button>
        ))}
      </div>

      {/* cards */}
      <div className="grid grid-cols-1 gap-[12px] xl:grid-cols-2">
        {shown.map((t) => {
          const meta = META_CHIP[t.meta_status] ?? META_CHIP.draft;
          return (
            <div key={t.id} className="rounded-[14px] border border-[#E8EAF0] bg-white p-[16px] shadow-[0_1px_2px_rgba(20,24,40,.06)]">
              <div className="mb-[9px] flex items-center gap-[8px]">
                <b className="min-w-0 flex-1 truncate text-[13.8px] font-semibold tracking-[-.015em]">{t.name}</b>
                <span className={cn('inline-flex flex-shrink-0 items-center gap-[4px] rounded-full border px-[9px] py-[3px] text-[10.8px] font-bold', meta.cls)}>
                  {meta.icon}{meta.label}
                </span>
                <span className={cn(
                  'flex-shrink-0 rounded-full border px-[8px] py-[3px] text-[10.4px] font-semibold',
                  t.category === 'UTILITY'
                    ? 'border-[#D7F3E1] bg-[#EDFAF1] text-[#1B7A44]'
                    : 'border-indigo-100 bg-indigo-soft text-indigo-700'
                )}>
                  {t.category}
                </span>
              </div>

              <div className="mb-[9px] flex items-center gap-[7px]">
                <code className="rounded-md bg-[#F5F6F9] px-[8px] py-[3px] text-[11.4px] text-ink-2">{t.code}</code>
                <button
                  onClick={() => copy(t.code, `${t.id}-code`)}
                  className="inline-flex items-center gap-[4px] rounded-md border border-[#DDE0E9] px-[8px] py-[3px] text-[11px] font-semibold text-ink-2 transition hover:border-[#2FB463] hover:text-[#1B7A44]"
                >
                  {copied === `${t.id}-code` ? <Check className="h-[11px] w-[11px]" /> : <Copy className="h-[11px] w-[11px]" />}
                  name
                </button>
                <button
                  onClick={() => copy(t.body, `${t.id}-body`)}
                  className="inline-flex items-center gap-[4px] rounded-md border border-[#DDE0E9] px-[8px] py-[3px] text-[11px] font-semibold text-ink-2 transition hover:border-[#2FB463] hover:text-[#1B7A44]"
                >
                  {copied === `${t.id}-body` ? <Check className="h-[11px] w-[11px]" /> : <Copy className="h-[11px] w-[11px]" />}
                  body
                </button>
                {t.meta_reason && (
                  <span className="min-w-0 truncate text-[11.2px] text-[#B02B2B]" title={t.meta_reason}>{t.meta_reason}</span>
                )}
              </div>

              <p className="m-0 whitespace-pre-wrap rounded-[10px] bg-[#F7F8FA] px-[12px] py-[10px] text-[12.4px] leading-[1.6] text-ink-2">
                {t.body}
              </p>

              {(t.variables?.length ?? 0) > 0 && (
                <div className="mt-[8px] flex flex-wrap gap-[6px]">
                  {t.variables.map((v) => (
                    <span key={v.n} className="rounded-md border border-[#D7F3E1] bg-[#EDFAF1] px-[7px] py-[2px] font-mono text-[10.8px] font-semibold text-[#1B7A44]">
                      {`{{${v.n}}}`} {v.label ?? ''}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="mt-[14px] px-1 text-[11.8px] leading-[1.6] text-faint">
        Bodies are read-only here so the CRM always matches what Meta approved —
        an edited copy would make previews lie and could shift variable values
        into the wrong slots. Wording changes ship as a migration, then get
        re-submitted to Meta.
      </p>
    </div>
  );
}
