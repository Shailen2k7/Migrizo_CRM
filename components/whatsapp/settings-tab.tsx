'use client';

// =============================================================================
// SETTINGS TAB — every safety knob in one place, with the state it protects.
//
// The layout is four cards in risk order: Connection (is the pipe alive),
// Sending (dry-run + cap + window), Engine (run the drain by hand, see what it
// did), Health (suppressions + the full diagnostic). Each card shows the LIVE
// value next to its control — a settings screen that hides current state is
// how 3 AM sends happen.
// =============================================================================
import { useMemo, useState } from 'react';
import {
  Loader2, Zap, ShieldCheck, Clock, Gauge, PlugZap, RefreshCw, Bot,
  ExternalLink, AlertTriangle, CheckCircle2, PlayCircle,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import type { WaSettings, WaStats } from '@/lib/whatsapp/types';
import { FIELD } from '@/components/whatsapp/ui';

interface Props {
  workspaceId: string;
  settings: WaSettings | null;
  stats: WaStats | null;
  onSettingsChanged: () => Promise<void>;
}

interface DrainResult {
  ok: boolean;
  claimed?: number; sent?: number; failed?: number; dryRun?: boolean;
  skipped?: string; reason?: string;
  results?: Array<{ lead: string; step: number; ok: boolean; detail?: string }>;
}

// Settings rows carry these two even though the base type predates 047.
type WindowSettings = WaSettings & { send_window_start?: string; send_window_end?: string };

export default function SettingsTab({ workspaceId, settings, stats, onSettingsChanged }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const s = settings as WindowSettings | null;

  const [cap, setCap] = useState<string>(s ? String(s.daily_cap) : '100');
  const [winStart, setWinStart] = useState<string>(s?.send_window_start?.slice(0, 5) ?? '10:00');
  const [winEnd, setWinEnd] = useState<string>(s?.send_window_end?.slice(0, 5) ?? '19:00');
  const [savingSend, setSavingSend] = useState(false);
  const [testing, setTesting] = useState(false);
  const [draining, setDraining] = useState(false);
  const [drainResult, setDrainResult] = useState<DrainResult | null>(null);

  const connected = Boolean(s?.connected);
  const dryRun = s?.dry_run !== false;

  async function saveSending() {
    setSavingSend(true);
    try {
      const capN = Math.max(1, Math.min(1000, parseInt(cap, 10) || 100));
      if (!/^\d{2}:\d{2}$/.test(winStart) || !/^\d{2}:\d{2}$/.test(winEnd)) {
        throw new Error('Window times must look like 10:00');
      }
      if (winStart >= winEnd) throw new Error('The window must open before it closes');
      const { error } = await supabase.from('whatsapp_settings').update({
        daily_cap: capN,
        send_window_start: winStart,
        send_window_end: winEnd,
        updated_at: new Date().toISOString(),
      }).eq('workspace_id', workspaceId);
      if (error) throw new Error(error.message);
      await onSettingsChanged();
      toast.success(`Saved — cap ${capN}/day, window ${winStart}–${winEnd} IST`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSavingSend(false);
    }
  }

  async function toggleDryRun() {
    const next = !dryRun;
    if (next === false && !window.confirm(
      'Turn OFF dry-run? From the next send, messages really reach people on WhatsApp.')) return;
    const { error } = await supabase.from('whatsapp_settings')
      .update({ dry_run: next, updated_at: new Date().toISOString() })
      .eq('workspace_id', workspaceId);
    if (error) { toast.error(error.message); return; }
    await onSettingsChanged();
    toast.success(next ? 'Dry-run ON — everything is simulated' : 'Dry-run OFF — sends are live now');
  }

  async function resumeSending() {
    const { error } = await supabase.from('whatsapp_settings')
      .update({ sending_paused: false, pause_reason: null, updated_at: new Date().toISOString() })
      .eq('workspace_id', workspaceId);
    if (error) { toast.error(error.message); return; }
    await onSettingsChanged();
    toast.success('Sending resumed');
  }

  async function testConnection() {
    setTesting(true);
    try {
      const res = await fetch('/api/whatsapp/test-connection', { method: 'POST' });
      const json = await res.json();
      if (json.ok) toast.success('Interakt credential is valid');
      else toast.error(json.detail || json.reason || 'Test failed');
      await onSettingsChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setTesting(false);
    }
  }

  async function runDrain() {
    setDraining(true);
    setDrainResult(null);
    try {
      const res = await fetch('/api/whatsapp/sequences/drain', { method: 'POST' });
      const json = (await res.json()) as DrainResult;
      setDrainResult(json);
      if (!json.ok) toast.error(json.reason || 'Drain failed');
      else if (json.skipped) toast(`Nothing sent — ${json.skipped}`);
      else toast.success(`${json.sent ?? 0} sent${json.dryRun ? ' (dry-run)' : ''}, ${json.failed ?? 0} failed`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setDraining(false);
    }
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-[14px]">
      <div className="mx-auto grid max-w-[1380px] grid-cols-1 gap-[14px] lg:grid-cols-2 xl:grid-cols-3">

        {/* ── connection ── */}
        <Card icon={<PlugZap />} title="Connection" sub="The Interakt credential and your number">
          <Row label="Status">
            <span className={cn('inline-flex items-center gap-[6px] rounded-full border px-[10px] py-[4px] text-[11.6px] font-semibold',
              connected ? 'border-[#D7F3E1] bg-[#EDFAF1] text-[#1B7A44]' : 'border-[#F8E2B8] bg-[#FEF6E6] text-[#A25D07]')}>
              <span className={cn('h-[6px] w-[6px] rounded-full', connected ? 'bg-[#2FB463]' : 'bg-[#F0A020]')} />
              {connected ? 'Connected' : 'Not verified'}
            </span>
          </Row>
          <Row label="Number"><b className="tabular-nums">{s?.display_number ?? '—'}</b></Row>
          <Row label="Quality rating">
            <span className={cn('font-semibold', s?.quality_rating === 'LOW' ? 'text-[#B02B2B]' : s?.quality_rating === 'MEDIUM' ? 'text-[#A25D07]' : 'text-[#1B7A44]')}>
              {s?.quality_rating ?? 'Not reported yet'}
            </span>
          </Row>
          <Row label="Last tested">{s?.last_tested_at ? new Date(s.last_tested_at).toLocaleString() : 'Never'}</Row>
          {s?.last_test_error && (
            <p className="m-0 mt-[6px] rounded-[9px] border border-[#F8D6D6] bg-[#FEEFEF] px-[10px] py-[8px] text-[11.8px] text-[#B02B2B]">{s.last_test_error}</p>
          )}
          <div className="mt-[12px]">
            <button onClick={testConnection} disabled={testing}
              className="inline-flex items-center gap-[7px] rounded-[9px] border border-[#DDE0E9] bg-white px-[14px] py-[8px] text-[13px] font-semibold text-ink-2 transition hover:border-[#2FB463] hover:bg-[#EDFAF1] hover:text-[#1B7A44] disabled:opacity-50">
              {testing ? <Loader2 className="h-[13px] w-[13px] animate-spin" /> : <RefreshCw className="h-[13px] w-[13px]" />}
              Test connection
            </button>
          </div>
        </Card>

        {/* ── sending ── */}
        <Card icon={<Gauge />} title="Sending" sub="The three knobs that protect the number">
          <div className="mb-[12px] flex items-center justify-between gap-3 rounded-[11px] border border-[#E8EAF0] bg-[#F9FAFB] px-[13px] py-[11px]">
            <span className="flex items-center gap-[9px]">
              <Bot className={cn('h-[16px] w-[16px]', dryRun ? 'text-[#A25D07]' : 'text-faint')} />
              <span>
                <b className="block text-[13px] font-semibold">Dry-run</b>
                <span className="text-[11.6px] text-muted">{dryRun ? 'Messages are logged, nothing reaches WhatsApp' : 'OFF — sends are live'}</span>
              </span>
            </span>
            <button onClick={toggleDryRun}
              className={cn('relative h-[24px] w-[44px] flex-shrink-0 rounded-full transition', dryRun ? 'bg-[#F0A020]' : 'bg-[#DDE0E9]')}>
              <span className={cn('absolute top-[3px] h-[18px] w-[18px] rounded-full bg-white shadow transition-all', dryRun ? 'left-[23px]' : 'left-[3px]')} />
            </button>
          </div>

          {s?.sending_paused && (
            <div className="mb-[12px] rounded-[11px] border border-[#F8D6D6] bg-[#FEEFEF] px-[13px] py-[11px]">
              <p className="m-0 flex items-center gap-2 text-[12.6px] font-semibold text-[#B02B2B]">
                <AlertTriangle className="h-[14px] w-[14px]" /> Sending is paused
              </p>
              <p className="m-0 mt-[4px] text-[11.8px] text-[#8E2A2A]">{s.pause_reason ?? 'Paused manually.'}</p>
              <button onClick={resumeSending}
                className="mt-[8px] rounded-[8px] border border-[#E8B4B4] bg-white px-[12px] py-[6px] text-[12px] font-semibold text-[#B02B2B] transition hover:bg-[#FEEFEF]">
                Resume sending
              </button>
            </div>
          )}

          <Row label="Daily cap (all sends)">
            <span className="flex items-center gap-[8px]">
              <input type="number" min={1} max={1000} value={cap} onChange={(e) => setCap(e.target.value)}
                className={`${FIELD} w-[80px] text-center font-bold tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`} />
              <span className="text-[11.6px] text-muted">used today: <b className="tabular-nums">{stats?.sent_today ?? 0}</b></span>
            </span>
          </Row>
          <Row label="Send window (IST)">
            <span className="flex items-center gap-[7px]">
              <input type="time" value={winStart} onChange={(e) => setWinStart(e.target.value)}
                className={`${FIELD} w-[112px] cursor-pointer font-semibold tabular-nums`} />
              <span className="text-muted">to</span>
              <input type="time" value={winEnd} onChange={(e) => setWinEnd(e.target.value)}
                className={`${FIELD} w-[112px] cursor-pointer font-semibold tabular-nums`} />
            </span>
          </Row>
          <p className="m-0 mt-[6px] text-[11.4px] leading-[1.55] text-faint">
            The engine claims nothing outside this window; anything scheduled past the close rolls to the next opening. Manual inbox replies are not window-limited.
          </p>
          <div className="mt-[12px]">
            <button onClick={saveSending} disabled={savingSend}
              className="inline-flex items-center gap-[7px] rounded-[9px] bg-[#25A25A] px-[16px] py-[8px] text-[13px] font-semibold text-white transition hover:bg-[#1B7A44] disabled:opacity-50">
              {savingSend ? <Loader2 className="h-[13px] w-[13px] animate-spin" /> : <CheckCircle2 className="h-[13px] w-[13px]" />}
              Save sending rules
            </button>
          </div>
        </Card>

        {/* ── engine ── */}
        <Card icon={<Zap />} title="Sequence engine" sub="The cron that does the actual sending">
          <p className="m-0 mb-[10px] text-[12.4px] leading-[1.6] text-ink-2">
            A scheduler should call this every 10 minutes. Each run sends a small
            batch of whatever is due — window, caps and opt-outs are enforced in
            the database before anything is handed to Interakt.
          </p>
          <div className="mb-[12px] rounded-[10px] bg-[#0F172A] px-[13px] py-[10px] font-mono text-[11.2px] leading-[1.7] text-[#A5F3B4]">
            POST https://crm.migrizo.com/api/whatsapp/sequences/drain<br />
            x-cron-secret: &lt;CRON_SECRET&gt;
          </div>
          <button onClick={runDrain} disabled={draining}
            className="inline-flex items-center gap-[7px] rounded-[9px] bg-[#25A25A] px-[16px] py-[9px] text-[13px] font-semibold text-white transition hover:bg-[#1B7A44] disabled:opacity-50">
            {draining ? <Loader2 className="h-[14px] w-[14px] animate-spin" /> : <PlayCircle className="h-[14px] w-[14px]" />}
            Run now{dryRun ? ' (dry-run)' : ''}
          </button>
          {drainResult && (
            <div className="mt-[12px] rounded-[11px] border border-[#E8EAF0] bg-[#F9FAFB] px-[13px] py-[11px] text-[12.4px]">
              {drainResult.skipped ? (
                <p className="m-0 text-[#A25D07]">Nothing sent — {drainResult.skipped}</p>
              ) : (
                <p className="m-0">
                  Claimed <b className="tabular-nums">{drainResult.claimed ?? 0}</b> ·
                  sent <b className="tabular-nums text-[#1B7A44]"> {drainResult.sent ?? 0}</b> ·
                  failed <b className={cn('tabular-nums', (drainResult.failed ?? 0) > 0 ? 'text-[#B02B2B]' : '')}> {drainResult.failed ?? 0}</b>
                  {drainResult.dryRun ? ' · dry-run' : ''}
                </p>
              )}
              {(drainResult.results ?? []).slice(0, 8).map((r, i) => (
                <p key={i} className="m-0 mt-[4px] text-[11.6px] text-muted">
                  {r.ok ? '✓' : '✗'} {r.lead} — step {r.step}{r.detail ? ` (${r.detail})` : ''}
                </p>
              ))}
            </div>
          )}
        </Card>

        {/* ── health ── */}
        <Card icon={<ShieldCheck />} title="Health" sub="What can never be messaged, and the full diagnostic">
          <Row label="Opted out / suppressed"><b className="tabular-nums">{stats?.suppressed ?? 0}</b> numbers — permanent, all channels</Row>
          <Row label="Conversations"><b className="tabular-nums">{stats?.conversations ?? 0}</b> total · <b className="tabular-nums">{stats?.window_open ?? 0}</b> windows open</Row>
          <Row label="Failed today"><b className={cn('tabular-nums', (stats?.failed_today ?? 0) > 0 ? 'text-[#B02B2B]' : '')}>{stats?.failed_today ?? 0}</b></Row>
          <p className="m-0 mt-[10px] text-[11.6px] leading-[1.6] text-faint">
            If quality drops below HIGH, sending pauses automatically and shows up
            here — protecting the number matters more than finishing a campaign.
          </p>
          <a href="/api/whatsapp/diagnose" target="_blank" rel="noreferrer"
            className="mt-[12px] inline-flex items-center gap-[7px] rounded-[9px] border border-[#DDE0E9] bg-white px-[14px] py-[8px] text-[13px] font-semibold text-ink-2 transition hover:border-[#2FB463] hover:bg-[#EDFAF1] hover:text-[#1B7A44]">
            <ExternalLink className="h-[13px] w-[13px]" /> Open the full diagnostic
          </a>
        </Card>

        <p className="col-span-full m-0 flex items-center gap-2 px-1 text-[11.6px] text-faint">
          <Clock className="h-[13px] w-[13px]" />
          All caps and windows are evaluated in Asia/Kolkata. The day resets at midnight IST.
        </p>
      </div>
    </div>
  );
}

// ── bits ────────────────────────────────────────────────────────────────────
function Card({ icon, title, sub, children }: {
  icon: React.ReactNode; title: string; sub: string; children: React.ReactNode;
}) {
  return (
    <div className="rounded-[14px] border border-[#E8EAF0] bg-white p-[18px] shadow-[0_1px_2px_rgba(20,24,40,.06)]">
      <div className="mb-[14px] flex items-center gap-[10px]">
        <span className="flex h-[34px] w-[34px] items-center justify-center rounded-[10px] border border-[#D7F3E1] bg-[#EDFAF1] text-[#1B7A44] [&>svg]:h-[16px] [&>svg]:w-[16px]">
          {icon}
        </span>
        <span>
          <b className="block text-[14px] font-bold tracking-[-.02em]">{title}</b>
          <span className="text-[11.8px] text-muted">{sub}</span>
        </span>
      </div>
      {children}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-[#F0F1F5] py-[8px] text-[13px] last:border-b-0">
      <span className="text-muted">{label}</span>
      <span className="text-right text-ink">{children}</span>
    </div>
  );
}
