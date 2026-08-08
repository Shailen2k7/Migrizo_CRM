'use client';

// =============================================================================
// LEAD PANEL — the right-hand contact column, in the approved "Kinetic
// Clarity" language: a soft `#FAFBFC` column holding white sub-cards with
// LABEL-CAPS overlines, an indigo hero, and a real sequence card with a
// progress bar.
//
// Collapsible: the parent renders it with `collapsed` and the width animates to
// 0. Content sits inside a fixed-width inner div so it clips cleanly instead of
// reflowing on the way out.
// =============================================================================
import {
  Mail, Phone, Pause, Play, Square, BadgeCheck, MoreHorizontal, Clock,
  MessageCircle, ShieldOff, ArrowDownLeft, ArrowUpRight,
} from 'lucide-react';
import { initials, cn } from '@/lib/utils';
import { formatLeft, windowLeftMs, windowState, WINDOW_META } from '@/lib/whatsapp/types';
import type { WaConversation } from '@/lib/whatsapp/types';
import type { Lead } from '@/lib/types';

export type SeqState = 'active' | 'paused' | 'stopped' | 'none';

interface Props {
  conv: WaConversation;
  lead: Lead | undefined;
  ownerName: string;
  tab: 'info' | 'activity';
  onTab: (t: 'info' | 'activity') => void;
  seqState: SeqState;
  seqLabel: string;
  seqName?: string | null;
  seqStep?: number | null;
  seqTotal?: number | null;
  onSeq: (a: 'pause' | 'resume' | 'stop') => void;
  onMail: () => void;
  onCall: () => void;
  collapsed: boolean;
}

const CHIP: Record<string, string> = {
  active: 'bg-[#E2F5EA] text-[#119751] border-[#BDE8CD]',
  paused: 'bg-[#FEF6E6] text-[#A25D07] border-[#F8E2B8]',
  stopped: 'bg-[#F4F5F8] text-[#7A8095] border-[#E8EAF0]',
  none: 'bg-[#F4F5F8] text-[#7A8095] border-[#E8EAF0]',
};

export default function LeadPanel({
  conv, lead, ownerName, tab, onTab, seqState, seqName, seqStep, seqTotal,
  onSeq, onMail, onCall, collapsed,
}: Props) {
  const w = windowState(conv.last_inbound_at);
  const meta = WINDOW_META[w];
  const leftMs = windowLeftMs(conv.last_inbound_at);
  const pct = w === 'shut' ? 0 : Math.max(3, Math.min(100, (leftMs / (24 * 3600_000)) * 100));

  const email = lead?.email || '';
  const phone = lead?.phone || conv.phone_e164;
  const seqPct = seqTotal && seqTotal > 0 ? Math.round(((seqStep ?? 0) / seqTotal) * 100) : 0;

  return (
    <aside
      className={cn(
        'flex-shrink-0 overflow-y-auto overflow-x-hidden rounded-[14px] border border-[#E8EAF0] bg-[#FAFBFC]',
        'shadow-[0_1px_2px_rgba(20,24,40,.06)] transition-[width,margin,border-width,opacity] duration-200 ease-out',
        collapsed ? 'w-0 ml-0 border-0 opacity-0' : 'w-[340px] ml-[14px] opacity-100'
      )}
      aria-hidden={collapsed}
    >
      <div className="w-[338px]">
        {/* ── hero ── */}
        <div className="flex flex-col items-center border-b border-[#E8EAF0] bg-white p-6">
          <div className="mb-3 flex h-[68px] w-[68px] items-center justify-center rounded-full bg-[#E9EDFF] text-[24px] font-semibold text-[#3323cc] shadow-[0_1px_2px_rgba(20,24,40,.05)]">
            {initials(conv.lead_name)}
          </div>
          <h3 className="m-0 text-[18px] font-semibold tracking-tight text-[#3323cc]">{conv.lead_name}</h3>
          <span className="mt-1 text-[12px] tabular-nums text-[#7A8095]">{phone}</span>
          <div className="mt-3 flex items-center gap-[10px]">
            <QuickBtn title="Call" onClick={onCall}><Phone /></QuickBtn>
            <QuickBtn title="WhatsApp thread" active><MessageCircle /></QuickBtn>
            <QuickBtn title={email ? 'Send email' : 'No email on file'} onClick={email ? onMail : undefined} disabled={!email}><Mail /></QuickBtn>
          </div>
        </div>

        {/* ── tabs ── */}
        <div className="flex border-b border-[#E8EAF0] bg-white">
          {(['info', 'activity'] as const).map((t) => (
            <button
              key={t}
              onClick={() => onTab(t)}
              className={cn(
                'flex-1 py-3 text-[12px] transition-colors',
                tab === t
                  ? 'border-b-2 border-[#0F1728] font-semibold text-[#0F1728]'
                  : 'font-medium text-[#7A8095] hover:text-[#0F1728]'
              )}
            >
              {t === 'info' ? 'Information' : 'Activity'}
            </button>
          ))}
        </div>

        {tab === 'info' ? (
          <div className="flex flex-col gap-4 p-4">
            {/* ── sequence card ── */}
            <Card>
              <div className="mb-3 flex items-center justify-between">
                <Overline>Active sequence</Overline>
                <MoreHorizontal className="h-4 w-4 text-[#7A8095]" />
              </div>
              {seqName ? (
                <>
                  <div className="mb-2 flex items-center gap-2">
                    <BadgeCheck className="h-[18px] w-[18px] text-[#25A25A]" />
                    <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-[#0F1728]">{seqName}</span>
                    <span className={cn('flex-shrink-0 rounded-full border px-2 py-0.5 text-[10.5px] font-semibold', CHIP[seqState])}>
                      {seqState}
                    </span>
                  </div>
                  <div className="mb-3 text-[11px] text-[#7A8095]">
                    Step {seqStep ?? 0} of {seqTotal ?? '?'}
                  </div>
                  <div className="h-[6px] w-full overflow-hidden rounded-full bg-[#E8EAF0]">
                    <div className="h-full rounded-full bg-[#25A25A] transition-[width] duration-300" style={{ width: `${seqPct}%` }} />
                  </div>
                  <div className="mt-3 flex gap-2">
                    {seqState === 'active' ? (
                      <SeqBtn onClick={() => onSeq('pause')}><Pause className="h-3 w-3" />Pause</SeqBtn>
                    ) : (
                      <SeqBtn onClick={() => onSeq('resume')} disabled={seqState !== 'paused'}>
                        <Play className="h-3 w-3" />Resume
                      </SeqBtn>
                    )}
                    <SeqBtn onClick={() => onSeq('stop')} disabled={seqState === 'none' || seqState === 'stopped'}>
                      <Square className="h-3 w-3" />Stop
                    </SeqBtn>
                  </div>
                  <p className="m-0 mt-2.5 text-[11px] leading-[1.55] text-[#7A8095]">
                    A reply never stops the sequence on its own — you decide.
                  </p>
                </>
              ) : (
                <p className="m-0 text-[12px] leading-[1.6] text-[#7A8095]">
                  Not enrolled in any sequence. Enrol this lead from the
                  Sequences tab to start automated follow-ups.
                </p>
              )}
            </Card>

            {/* ── 24-hour window card ── */}
            <Card>
              <div className="mb-2 flex items-center justify-between">
                <Overline>24-hour window</Overline>
                <span className="inline-flex items-center gap-1 text-[11.5px] font-semibold" style={{ color: meta.colour }}>
                  <Clock className="h-3 w-3" />
                  {w === 'shut' ? 'Closed — template only' : formatLeft(leftMs)}
                </span>
              </div>
              <div className="h-[6px] w-full overflow-hidden rounded-full bg-[#E8EAF0]">
                <span className="block h-full rounded-full transition-[width] duration-500"
                      style={{ width: `${pct}%`, background: meta.colour }} />
              </div>
            </Card>

            {/* ── details card ── */}
            <Card>
              <Overline className="mb-4 block">Details</Overline>
              <div className="flex flex-col gap-3">
                <Field label="Email">
                  {email
                    ? <span className="break-all text-[13px] font-medium text-[#0F1728]">{email}</span>
                    : <span className="text-[13px] text-[#A8ADBF]">Not on file</span>}
                </Field>
                <Field label="Phone">
                  <span className="text-[13px] font-medium tabular-nums text-[#0F1728]">{phone}</span>
                </Field>
                {(lead?.visa_type || lead?.industry) && (
                  <Field label="Profile">
                    <span className="text-[13px] font-medium text-[#0F1728]">
                      {[lead?.visa_type?.toUpperCase(), lead?.industry].filter(Boolean).join(' · ')}
                    </span>
                  </Field>
                )}
                {lead?.source && (
                  <Field label="Source">
                    <span className="text-[13px] font-medium text-[#0F1728]">{lead.source}</span>
                  </Field>
                )}
                <Field label="Assigned agent">
                  <span className="mt-0.5 flex items-center gap-1.5">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#131b2d] text-[9px] font-bold text-white">
                      {initials(ownerName)}
                    </span>
                    <span className="text-[13px] font-medium text-[#0F1728]">{ownerName}</span>
                  </span>
                </Field>
              </div>
            </Card>

            {/* ── tags card — real status, styled as the mock's tags ── */}
            <Card>
              <Overline className="mb-3 block">Tags</Overline>
              <div className="flex flex-wrap gap-2">
                {conv.lead_stage && (
                  <Tag tone={conv.lead_stage === 'hot' ? 'green' : 'grey'}>{conv.lead_stage}</Tag>
                )}
                {conv.visa_type && <Tag tone="green">{conv.visa_type.toUpperCase()}</Tag>}
                <Tag tone="grey">{conv.status === 'open' ? 'Open' : 'Closed'}</Tag>
                {conv.suppressed && <Tag tone="red">Opted out</Tag>}
              </div>
            </Card>

            {conv.suppressed && (
              <div className="rounded-lg border border-[#F8D6D6] bg-[#FEEFEF] p-4">
                <p className="m-0 flex items-start gap-2 text-[12px] leading-[1.6] text-[#B02B2B]">
                  <ShieldOff className="mt-px h-4 w-4 flex-shrink-0" />
                  <span>
                    This number replied STOP or NO. It is suppressed permanently
                    and the lead is in Junk. Nothing will ever be sent here
                    again, on WhatsApp or email.
                  </span>
                </p>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-4 p-4">
            <Card>
              <Overline className="mb-3 block">Interaction history</Overline>
              <History
                icon={conv.last_direction === 'in' ? <ArrowDownLeft /> : <ArrowUpRight />}
                tone={conv.last_direction === 'in' ? 'in' : 'out'}
                title={conv.last_direction === 'in' ? 'WhatsApp reply received' : 'Message delivered'}
                sub={conv.needs_attention ? 'Awaiting your reply' : 'Handled'}
                when={conv.last_message_at}
              />
              <History
                icon={<Play />}
                tone="plain"
                title={seqName ?? 'No sequence'}
                sub={seqName ? `Sequence ${seqState} · step ${seqStep ?? 0}/${seqTotal ?? '?'}` : 'Enrol from the Sequences tab'}
                when={null}
              />
              <History
                icon={<MessageCircle />}
                tone="plain"
                title="Conversation started"
                sub={conv.phone_e164}
                when={conv.last_message_at}
              />
            </Card>
          </div>
        )}
      </div>
    </aside>
  );
}

// ── bits ────────────────────────────────────────────────────────────────────
function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-[#E8EAF0] bg-white p-4 shadow-[0_1px_2px_rgba(20,24,40,.02)]">
      {children}
    </div>
  );
}

function Overline({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn('text-[11px] font-bold uppercase tracking-wider text-[#7A8095]', className)}>
      {children}
    </span>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="mb-0.5 block text-[11px] text-[#7A8095]">{label}</span>
      {children}
    </div>
  );
}

function Tag({ children, tone }: { children: React.ReactNode; tone: 'green' | 'grey' | 'red' }) {
  const skin =
    tone === 'green' ? 'bg-[#E2F5EA] text-[#119751] border-[#BDE8CD]'
      : tone === 'red' ? 'bg-[#FEEFEF] text-[#B02B2B] border-[#F8D6D6]'
      : 'bg-[#F4F5F8] text-[#45464c] border-[#E8EAF0]';
  return (
    <span className={cn('rounded border px-2 py-1 text-[11px] font-medium', skin)}>
      {children}
    </span>
  );
}

function QuickBtn({ children, title, onClick, disabled, active }: {
  children: React.ReactNode; title: string; onClick?: () => void; disabled?: boolean; active?: boolean;
}) {
  return (
    <button
      onClick={onClick} disabled={disabled} title={title}
      className={cn(
        'flex h-8 w-8 items-center justify-center rounded-full border transition-colors [&>svg]:h-[14px] [&>svg]:w-[14px]',
        active
          ? 'border-[#BDE8CD] bg-[#E2F5EA] text-[#119751]'
          : 'border-[#E8EAF0] bg-white text-[#45464c] hover:border-[#25A25A] hover:text-[#119751]',
        disabled && 'cursor-not-allowed opacity-35 hover:border-[#E8EAF0] hover:text-[#45464c]'
      )}
    >
      {children}
    </button>
  );
}

function SeqBtn({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-[#E8EAF0] bg-white px-2 py-1.5 text-[12px] font-medium text-[#45464c] transition-colors hover:bg-[#F4F5F8] hover:text-[#0F1728] disabled:opacity-40 disabled:hover:bg-white"
    >
      {children}
    </button>
  );
}

function History({ icon, title, sub, when, tone }: {
  icon: React.ReactNode; title: string; sub: string; when: string | null; tone: 'in' | 'out' | 'plain';
}) {
  return (
    <div className="flex items-start gap-[10px] border-b border-[#F0F1F5] py-[10px] first:pt-0 last:border-b-0 last:pb-0">
      <span className={cn(
        'mt-px flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-[8px] border [&>svg]:h-3 [&>svg]:w-3',
        tone === 'in' ? 'border-[#BDE8CD] bg-[#E2F5EA] text-[#119751]'
          : tone === 'out' ? 'border-[#DDE5FB] bg-[#EEF2FE] text-[#3B5BDB]'
          : 'border-[#E8EAF0] bg-[#F4F5F8] text-[#45464c]'
      )}>
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <b className="block truncate text-[12.5px] font-semibold text-[#0F1728]">{title}</b>
        <span className="mt-px block truncate text-[11.5px] text-[#7A8095]">{sub}</span>
      </span>
      {when && (
        <span className="flex-shrink-0 text-[10.5px] tabular-nums text-[#A8ADBF]">
          {new Date(when).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
        </span>
      )}
    </div>
  );
}
