// =============================================================================
// WHATSAPP — shared types.
// Field names mirror migration 040 exactly; if you change one, change both.
// =============================================================================

export type WaDirection = 'in' | 'out';
export type WaStatus = 'queued' | 'sent' | 'delivered' | 'read' | 'failed' | 'received';
export type WaCategory = 'MARKETING' | 'UTILITY' | 'AUTHENTICATION';
export type WaMetaStatus = 'draft' | 'submitted' | 'approved' | 'rejected' | 'paused';

/** Row shape returned by public.whatsapp_conversations_list(). */
export interface WaConversation {
  id: string;
  lead_id: string | null;
  phone_e164: string;
  lead_name: string;
  lead_stage: string | null;
  visa_type: string | null;
  owner_id: string | null;
  status: 'open' | 'closed';
  unread_count: number;
  needs_attention: boolean;
  last_inbound_at: string | null;
  last_message_at: string | null;
  last_preview: string | null;
  last_direction: WaDirection | null;
  window_open: boolean;
  window_expires_at: string | null;
  suppressed: boolean;
}

export interface WaMessage {
  /** Delete-for-me (077): hidden from our inbox; the customer's copy is untouched. */
  hidden?: boolean | null;
  id: string;
  workspace_id: string;
  conversation_id: string;
  lead_id: string | null;
  direction: WaDirection;
  body: string;
  template_code: string | null;
  template_category: WaCategory | null;
  variables: Record<string, string> | null;
  provider_msg_id: string | null;
  status: WaStatus;
  error_code: string | null;
  error_detail: string | null;
  sent_by: string | null;
  sequence_step: string | null;
  created_at: string;
  updated_at: string;
  // Attachments (migration 048). media_path is a private storage path — the
  // browser never uses it directly, it fetches /api/whatsapp/media/<id>.
  media_path?: string | null;
  media_type?: 'image' | 'document' | 'audio' | 'video' | 'sticker' | null;
  media_name?: string | null;
  media_mime?: string | null;
  media_size?: number | null;
}

/** A canned free-form reply, inserted with /shortcut in the composer. */
export interface WaSavedReply {
  id: string;
  shortcut: string;
  title: string;
  body: string;
  sort_order: number;
  media_path?: string | null;
  media_type?: string | null;
  media_name?: string | null;
  media_mime?: string | null;
  media_size?: number | null;
  times_used?: number;
}

export interface WaTemplateVar {
  n: string;
  label?: string;
  default?: string;
}

export interface WaTemplate {
  id: string;
  code: string;
  name: string;
  track: 'cold' | 'hot' | 'utility' | 'custom';
  category: WaCategory;
  language: string;
  body: string;
  variables: WaTemplateVar[];
  meta_status: WaMetaStatus;
  meta_reason: string | null;
  step_no: number | null;
  active: boolean;
}

export interface WaSettings {
  workspace_id: string;
  phone_e164: string | null;
  display_number: string | null;
  waba_id: string | null;
  connected: boolean;
  dry_run: boolean;
  daily_cap: number;
  quality_rating: string | null;
  sending_paused: boolean;
  pause_reason: string | null;
  last_tested_at: string | null;
  last_test_error: string | null;
  send_window_start?: string;
  send_window_end?: string;
}

export interface WaStats {
  conversations: number;
  unread: number;
  attention: number;
  window_open: number;
  sent_today: number;
  failed_today: number;
  suppressed: number;
}

/** How much of the 24-hour window is left, and how urgently to say so. */
export type WindowState = 'open' | 'warn' | 'crit' | 'shut';

const HOUR = 3600_000;

export function windowState(lastInboundAt: string | null): WindowState {
  if (!lastInboundAt) return 'shut';
  const left = new Date(lastInboundAt).getTime() + 24 * HOUR - Date.now();
  if (left <= 0) return 'shut';
  if (left < HOUR) return 'crit';
  if (left < 6 * HOUR) return 'warn';
  return 'open';
}

export function windowLeftMs(lastInboundAt: string | null): number {
  if (!lastInboundAt) return 0;
  return Math.max(0, new Date(lastInboundAt).getTime() + 24 * HOUR - Date.now());
}

/** "18h 42m" while there are hours left, then "42m 07s" so the last hour feels urgent. */
export function formatLeft(ms: number): string {
  if (ms <= 0) return '';
  const h = Math.floor(ms / HOUR);
  const m = Math.floor((ms % HOUR) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return h > 0
    ? `${h}h ${String(m).padStart(2, '0')}m`
    : `${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
}

export const WINDOW_META: Record<WindowState, { label: string; colour: string }> = {
  open: { label: 'Open', colour: '#25A25A' },
  warn: { label: 'Closing soon', colour: '#A25D07' },
  crit: { label: 'Closing', colour: '#B02B2B' },
  shut: { label: 'Template only', colour: '#A8ADBF' },
};
