'use client';

// =============================================================================
// LEAD PANEL — the right-hand contact card, in the unified-inbox language:
// avatar hero, a row of circular quick actions, label/value info rows, and an
// interaction-history-style activity list.
//
// Collapsible: the parent renders it with `collapsed` and the width animates to
// 0. Content sits inside a fixed-width inner div so it clips cleanly instead of
// reflowing on the way out.
// =============================================================================
import { Mail, Phone, Smartphone, Briefcase, MapPin, Crown, Pause, Play, Square, MessageCircle } from 'lucide-react';
import { initials, avatarColor, cn } from '@/lib/utils';
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
  onSeq: (a: 'pause' | 'resume' | 'stop') => void;
  onMail: () => void;
  onCall: () => void;
  collapsed: boolean;
}

const CHIP: Record<string, string> = {
  active: 'bg-[#EDFAF1] text-[#1B7A44] border-[#D7F3E1]',
  paused: 'bg-[#FEF6E6] text-[#A25D07] border-[#F8E2B8]',
  stopped: 'bg-[#EDEFF3] text-[#7A8095] border-[#DDE0E9]',
  none: 'bg-[#EDEFF3] text-[#7A8095] border-[#DDE0E9]',
};

export default function LeadPanel({
  conv, lead, ownerName, tab, onTab, seqState, seqLabel, onSeq, onMail, onCall, collapsed,
}: Props) {
  const w = windowState(conv.last_inbound_at);
  const meta = WINDOW_META[w];
  const leftMs = windowLeftMs(conv.last_inbound_at);
  const pct = w === 'shut' ? 0 : Math.max(3, Math.min(100, (leftMs / (24 * 3600_000)) * 100));

  const role = [lead?.industry, lead?.visa_type?.toUpperCase()].filter(Boolean).join(' · ');
  const email = lead?.email || '';

  return (
    <aside
      className={cn(
        'flex-shrink-0 overflow-y-auto overflow-x-hidden rounded-[14px] border border-[#E8EAF0] bg-white',
        'shadow-[0_1px_2px_rgba(20,24,40,.06)] transition-[width,margin,border-width,opacity] duration-200 ease-out',
        collapsed ? 'w-0 ml-0 border-0 opacity-0' : 'w-[330px] ml-[14px] opacity-100'
      )}
      aria-hidden={collapsed}
    >
      <div className="w-[328px]">
        {/* hero */}
        <div className="px-5 pb-[16px] pt-[24px] text-center">
          <div
            className="mx-auto mb-[12px] flex h-[72px] w-[72px] items-center justify-center rounded-full text-[24px] font-bold text-white shadow-[0_8px_22px_-8px_rgba(20,24,40,.45)]"
            style={{ background: avatarColor(conv.lead_name) }}
          >
            {initials(conv.lead_name)}
          </div>
          <h3 className="m-0 mb-[4px] text-[18px] font-semibold tracking-[-.03em] text-indigo-600">
            {conv.lead_name}
          </h3>
          {role && <div className="text-[13.2px] text-ink-2">{role}</div>}
          <div className="mt-[7px] inline-flex items-center gap-[6px] text-[12.6px] font-medium text-ink">
            <Crown className="h-[14px] w-[14px] text-[#EAB308]" />
            {ownerName}
          </div>

          {/* quick actions — the circular row from the reference design */}
          <div className="mt-[14px] flex items-center justify-center gap-[10px]">
            <Quick title="Call" onClick={onCall}><Phone /></Quick>
            <Quick title="WhatsApp thread" active><MessageCircle /></Quick>
            <Quick title={email ? 'Send email' : 'No email on file'} onClick={email ? onMail : undefined} disabled={!email}><Mail /></Quick>
          </div>

          <button
            onClick={onMail}
            disabled={!email}
            className="mt-[14px] flex w-full items-center justify-center gap-2 rounded-lg bg-[#25A25A] px-3 py-[10px] text-[13.6px] font-semibold text-white transition hover:bg-[#1B7A44] disabled:opacity-40"
          >
            <Mail className="h-[15px] w-[15px]" /> Send Mail
          </button>
        </div>

        <div className="flex gap-[22px] border-b border-[#E8EAF0] px-5">
          {(['info', 'activity'] as const).map((t) => (
            <button
              key={t}
              onClick={() => onTab(t)}
              className={cn(
                '-mb-px border-b-2 pb-3 pt-[10px] text-[13.6px] font-semibold transition',
                tab === t ? 'border-[#25A25A] text-[#1B7A44]' : 'border-transparent text-muted hover:text-ink-2'
              )}
            >
              {t === 'info' ? 'Information' : 'Activity'}
            </button>
          ))}
        </div>

        {tab === 'info' ? (
          <>
            <Section title="Basic Info">
              <Pair icon={<Mail />} label="Email" value={email || 'Not on file'} muted={!email}
                    action={email ? { label: 'Mail', onClick: onMail } : undefined} />
              <Pair icon={<Smartphone />} label="Phone" value={lead?.phone || conv.phone_e164} num
                    action={{ label: 'Call', onClick: onCall }} />
              {role && <Pair icon={<Briefcase />} label="Profile" value={role} />}
              {lead?.source && <Pair icon={<MapPin />} label="Source" value={lead.source} />}
            </Section>

            <Section title="Sequence">
              <div className="rounded-[11px] border border-[#E8EAF0] bg-[#F5F6F9] p-[14px]">
                <div className="mb-[11px] flex items-center justify-between gap-2">
                  <b className="min-w-0 flex-1 truncate text-[13px] font-semibold" title={seqLabel}>{seqLabel}</b>
                  <span className={cn('inline-flex flex-shrink-0 rounded-full border px-[9px] py-[3px] text-[11px] font-semibold', CHIP[seqState])}>
                    {seqState}
                  </span>
                </div>
                <div className="flex gap-2">
                  {seqState === 'active' ? (
                    <SeqBtn onClick={() => onSeq('pause')}><Pause className="h-[13px] w-[13px]" />Pause</SeqBtn>
                  ) : (
                    <SeqBtn onClick={() => onSeq('resume')} disabled={seqState === 'none' || seqState === 'stopped'}>
                      <Play className="h-[13px] w-[13px]" />Resume
                    </SeqBtn>
                  )}
                  <SeqBtn onClick={() => onSeq('stop')} disabled={seqState === 'none' || seqState === 'stopped'}>
                    <Square className="h-[13px] w-[13px]" />Stop
                  </SeqBtn>
                </div>
                <p className="m-0 mt-[11px] text-[11.6px] leading-[1.55] text-muted">
                  A reply never stops the sequence on its own — you decide.
                </p>
              </div>

              <div className="mt-[13px] flex items-start justify-between gap-3 py-[6px] text-[13px]">
                <span className="text-muted">24-hour window</span>
                <span className="text-[12.8px] font-semibold" style={{ color: meta.colour }}>
                  {w === 'shut' ? 'Closed — template only' : formatLeft(leftMs)}
                </span>
              </div>
              <div className="mt-[8px] h-[6px] overflow-hidden rounded-full bg-[#EDEFF3]">
                <span className="block h-full rounded-full transition-[width] duration-500"
                      style={{ width: `${pct}%`, background: meta.colour }} />
              </div>
            </Section>

            {conv.suppressed && (
              <Section title="Opted out">
                <div className="rounded-[9px] border border-[#F8D6D6] bg-[#FEEFEF] p-3 text-[12.6px] leading-[1.6] text-[#B02B2B]">
                  This number replied STOP or NO. It is suppressed permanently and the lead is in Junk.
                  Nothing will ever be sent here again, on WhatsApp or email.
                </div>
              </Section>
            )}
          </>
        ) : (
          <Section title="Interaction history">
            <History
              icon={<MessageCircle />}
              tone={conv.needs_attention ? 'in' : 'out'}
              title={conv.last_direction === 'in' ? 'WhatsApp reply received' : 'Message delivered'}
              sub={conv.needs_attention ? 'Awaiting your reply' : 'Handled'}
              when={conv.last_message_at}
            />
            <History icon={<Play />} tone="plain" title={seqLabel} sub={`Sequence ${seqState}`} when={null} />
            <History icon={<Smartphone />} tone="plain" title="Conversation started"
                     sub={conv.phone_e164} when={conv.last_message_at} />
          </Section>
        )}
      </div>
    </aside>
  );
}

// ── bits ────────────────────────────────────────────────────────────────────
function Quick({ children, title, onClick, disabled, active }: {
  children: React.ReactNode; title: string; onClick?: () => void; disabled?: boolean; active?: boolean;
}) {
  return (
    <button
      onClick={onClick} disabled={disabled} title={title}
      className={cn(
        'flex h-[38px] w-[38px] items-center justify-center rounded-full border transition [&>svg]:h-[15px] [&>svg]:w-[15px]',
        active
          ? 'border-[#D7F3E1] bg-[#EDFAF1] text-[#1B7A44]'
          : 'border-[#E8EAF0] bg-white text-ink-2 hover:border-[#2FB463] hover:bg-[#EDFAF1] hover:text-[#1B7A44]',
        disabled && 'cursor-not-allowed opacity-35 hover:border-[#E8EAF0] hover:bg-white hover:text-ink-2'
      )}
    >
      {children}
    </button>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-[#E8EAF0] px-5 py-[16px] last:border-b-0">
      <h4 className="m-0 mb-[12px] text-[13.6px] font-bold tracking-[-.02em] text-ink">{title}</h4>
      {children}
    </div>
  );
}

/** Label on the left, value on the right — the reference design's info rows. */
function Pair({ icon, label, value, action, muted, num }: {
  icon: React.ReactNode; label: string; value: string; muted?: boolean; num?: boolean;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="flex items-center gap-[10px] border-b border-[#F0F1F5] py-[9px] last:border-b-0">
      <span className="flex w-[18px] flex-shrink-0 justify-center text-ink-2 [&>svg]:h-[15px] [&>svg]:w-[15px]">{icon}</span>
      <span className="w-[52px] flex-shrink-0 text-[12.2px] text-muted">{label}</span>
      <span
        title={value}
        className={cn('min-w-0 flex-1 truncate text-right text-[13px]',
          muted ? 'text-faint' : 'font-medium text-ink', num && 'tabular-nums')}
      >
        {value}
      </span>
      {action && (
        <button
          onClick={action.onClick}
          className="flex-shrink-0 rounded-full border border-[#D7F3E1] bg-[#EDFAF1] px-[10px] py-[3px] text-[11.2px] font-semibold text-[#1B7A44] transition hover:bg-[#D7F3E1]"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

function History({ icon, title, sub, when, tone }: {
  icon: React.ReactNode; title: string; sub: string; when: string | null; tone: 'in' | 'out' | 'plain';
}) {
  return (
    <div className="flex items-start gap-[11px] border-b border-[#F0F1F5] py-[10px] last:border-b-0">
      <span className={cn(
        'mt-[1px] flex h-[30px] w-[30px] flex-shrink-0 items-center justify-center rounded-[9px] border [&>svg]:h-[13px] [&>svg]:w-[13px]',
        tone === 'in' ? 'border-[#D7F3E1] bg-[#EDFAF1] text-[#1B7A44]'
          : tone === 'out' ? 'border-[#DDE5FB] bg-[#EEF2FE] text-[#3B5BDB]'
          : 'border-[#E8EAF0] bg-[#F5F6F9] text-ink-2'
      )}>
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <b className="block truncate text-[12.8px] font-semibold">{title}</b>
        <span className="mt-[1px] block truncate text-[11.4px] text-muted">{sub}</span>
      </span>
      {when && (
        <span className="flex-shrink-0 text-[10.8px] tabular-nums text-faint">
          {new Date(when).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
        </span>
      )}
    </div>
  );
}

function SeqBtn({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex flex-1 items-center justify-center gap-[6px] rounded-lg border border-[#DDE0E9] bg-white px-2 py-2 text-[12.4px] font-semibold text-ink-2 transition hover:border-[#C9CDD9] hover:bg-[#F5F6F9] disabled:opacity-40 disabled:hover:border-[#DDE0E9] disabled:hover:bg-white"
    >
      {children}
    </button>
  );
}
