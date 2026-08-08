'use client';

// =============================================================================
// LEAD PANEL — the right-hand card.
//
// Collapsible: the parent renders it with `off` and the width animates to 0.
// Content sits inside a fixed-width inner div so it clips cleanly instead of
// reflowing on the way out.
// =============================================================================
import { Mail, Phone, Smartphone, Briefcase, MapPin, Crown, Pause, Play, Square } from 'lucide-react';
import { initials, avatarColor } from '@/lib/utils';
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
      className={[
        'flex-shrink-0 overflow-y-auto overflow-x-hidden rounded-[14px] border border-[#E8EAF0] bg-white',
        'shadow-[0_1px_2px_rgba(20,24,40,.06)] transition-[width,margin,border-width,opacity] duration-200 ease-out',
        collapsed ? 'w-0 ml-0 border-0 opacity-0' : 'w-[330px] ml-[14px] opacity-100',
      ].join(' ')}
      aria-hidden={collapsed}
    >
      <div className="w-[328px]">
        {/* hero */}
        <div className="px-5 pb-[18px] pt-[26px] text-center">
          <div
            className="mx-auto mb-[13px] flex h-[76px] w-[76px] items-center justify-center rounded-full text-[25px] font-bold text-white shadow-[0_8px_22px_-8px_rgba(20,24,40,.45)]"
            style={{ background: avatarColor(conv.lead_name) }}
          >
            {initials(conv.lead_name)}
          </div>
          <h3 className="m-0 mb-[5px] text-[19px] font-semibold tracking-[-.03em] text-indigo-600">
            {conv.lead_name}
          </h3>
          {role && <div className="text-[13.6px] text-ink-2">{role}</div>}
          <div className="mt-[9px] inline-flex items-center gap-[7px] text-[13px] font-medium text-ink">
            <Crown className="h-[15px] w-[15px] text-[#EAB308]" />
            {ownerName}
          </div>
        </div>

        <div className="px-5 pb-[18px]">
          <button
            onClick={onMail}
            disabled={!email}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#25A25A] px-3 py-[11px] text-[14px] font-semibold text-white transition hover:bg-[#1B7A44] disabled:opacity-40"
          >
            <Mail className="h-[15px] w-[15px]" /> Send Mail
          </button>
        </div>

        <div className="flex gap-[22px] border-b border-[#E8EAF0] px-5">
          {(['info', 'activity'] as const).map((t) => (
            <button
              key={t}
              onClick={() => onTab(t)}
              className={[
                '-mb-px border-b-2 pb-3 pt-[11px] text-[13.8px] font-semibold transition',
                tab === t ? 'border-[#25A25A] text-[#1B7A44]' : 'border-transparent text-muted hover:text-ink-2',
              ].join(' ')}
            >
              {t === 'info' ? 'Information' : 'Activity'}
            </button>
          ))}
        </div>

        {tab === 'info' ? (
          <>
            <Section title="Basic Info">
              <Row icon={<Mail />} value={email || 'No email on file'} muted={!email} truncate
                   action={email ? { label: 'Mail', icon: <Mail />, onClick: onMail } : undefined} />
              <Row icon={<Smartphone />} value={lead?.phone || conv.phone_e164} num
                   action={{ label: 'Call', icon: <Phone />, onClick: onCall }} />
              {role && <Row icon={<Briefcase />} value={role} />}
              {lead?.source && <Row icon={<MapPin />} value={lead.source} />}
            </Section>

            <Section title="Sequence">
              <div className="rounded-[11px] border border-[#E8EAF0] bg-[#F5F6F9] p-[14px]">
                <div className="mb-[11px] flex items-center justify-between gap-2">
                  <b className="text-[13.2px] font-semibold">{seqLabel}</b>
                  <span className={`inline-flex rounded-full border px-[9px] py-[3px] text-[11px] font-semibold ${CHIP[seqState]}`}>
                    {seqState}
                  </span>
                </div>
                <div className="flex gap-2">
                  {seqState === 'active' ? (
                    <SeqBtn onClick={() => onSeq('pause')}><Pause className="h-[13px] w-[13px]" />Pause</SeqBtn>
                  ) : (
                    <SeqBtn onClick={() => onSeq('resume')} disabled={seqState === 'none'}>
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

              <div className="mt-[13px] flex items-start justify-between gap-3 py-[6px] text-[13.2px]">
                <span className="text-muted">Email sequence</span>
                <span className="text-[12.8px] font-medium text-muted">Blocked · one channel</span>
              </div>
              <div className="flex items-start justify-between gap-3 py-[6px] text-[13.2px]">
                <span className="text-muted">24-hour window</span>
                <span className="text-[12.8px] font-semibold" style={{ color: meta.colour }}>
                  {w === 'shut' ? 'Closed' : formatLeft(leftMs)}
                </span>
              </div>
              <div className="mt-[10px] h-[6px] overflow-hidden rounded-full bg-[#EDEFF3]">
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
          <Section title="Recent activity">
            <div className="relative pl-[19px] before:absolute before:bottom-[6px] before:left-[4.5px] before:top-[6px] before:w-[1.5px] before:bg-[#DDE0E9] before:content-['']">
              <Dot tone={conv.needs_attention ? 'hi' : 'plain'}
                   title={conv.last_direction === 'in' ? 'WhatsApp reply received' : 'Message delivered'}
                   sub={conv.needs_attention ? 'Awaiting your reply' : 'Handled'} />
              <Dot tone="plain" title={seqLabel} sub={`Sequence ${seqState}`} />
              <Dot tone="plain" title="Conversation started"
                   sub={conv.last_message_at ? new Date(conv.last_message_at).toLocaleDateString() : '—'} />
            </div>
          </Section>
        )}
      </div>
    </aside>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-[#E8EAF0] px-5 py-[18px] last:border-b-0">
      <h4 className="m-0 mb-[14px] text-[14px] font-bold tracking-[-.02em] text-ink">{title}</h4>
      {children}
    </div>
  );
}

function Row({ icon, value, action, muted, num, truncate }: {
  icon: React.ReactNode; value: string; muted?: boolean; num?: boolean; truncate?: boolean;
  action?: { label: string; icon: React.ReactNode; onClick: () => void };
}) {
  return (
    <div className="flex items-start gap-[13px] py-2">
      <span className="flex w-[19px] flex-shrink-0 justify-center pt-px text-ink-2 [&>svg]:h-[17px] [&>svg]:w-[17px]">
        {icon}
      </span>
      <span
        title={value}
        className={[
          'min-w-0 flex-1 text-[13.4px] leading-[1.5]',
          muted ? 'text-faint' : 'text-ink',
          num ? 'tabular-nums' : '',
          truncate ? 'truncate' : 'break-words',
        ].join(' ')}
      >
        {value}
      </span>
      {action && (
        <button
          onClick={action.onClick}
          className="inline-flex flex-shrink-0 items-center gap-[5px] rounded-full border border-[#D7F3E1] bg-[#EDFAF1] px-[10px] py-1 text-[11.4px] font-semibold text-[#1B7A44] transition hover:bg-[#D7F3E1] [&>svg]:h-[11px] [&>svg]:w-[11px]"
        >
          {action.icon}{action.label}
        </button>
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

function Dot({ title, sub, tone }: { title: string; sub: string; tone: 'hi' | 'plain' }) {
  return (
    <div className="relative pb-[15px] last:pb-0">
      <span
        className="absolute left-[-18.5px] top-1 h-[10px] w-[10px] rounded-full border-2"
        style={tone === 'hi'
          ? { borderColor: '#25A25A', background: '#25A25A' }
          : { borderColor: '#DDE0E9', background: '#fff' }}
      />
      <b className="block text-[13px] font-semibold">{title}</b>
      <span className="mt-[2px] block text-[11.6px] text-muted">{sub}</span>
    </div>
  );
}
