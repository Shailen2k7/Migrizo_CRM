'use client';

// =============================================================================
// MASTER LEADS — every lead, one sheet, and what to do with each of them.
// -----------------------------------------------------------------------------
// Read top to bottom the way a sales lead reads their pipeline:
//
//   1. PERIOD   — which leads am I looking at? (Created: Aug 2026)
//   2. PULSE    — of those, how many are assessed, contacted, replying?
//   3. PLAYBOOK — twelve buckets, each a play, each clickable
//   4. SHEET    — the leads themselves; every column sorts and filters from
//                 its own header, the way Airtable and Notion do it
//
// The date scope drives all four, including the download — "every lead from
// August, and what state it is in" is one click on the period and one on
// Download.
//
// EDITABLE vs COMPUTED. Nine columns write through the exact same paths the
// lead drawer uses (updateLead / addNote / toggleSpotlight) — optimistic,
// rolled back on failure, logged where the drawer logs. Bucket, Offer/Action
// and Response are COMPUTED and deliberately not hand-editable: a hand-edited
// bucket is a sheet that lies about itself.
//
// FACETED COUNTS. Every count on the page — the cards, the numbers beside
// each value in a column menu — is computed from the leads that pass every
// OTHER active filter. So filtering to Spotlight doesn't zero out the other
// cards, and a column menu always tells you what picking a value will leave.
//
// NOTHING HERE TOUCHES AUTOMATION. The only lead fields written are ones the
// drawer already writes. The WhatsApp sequences keep matching stage='cold' and
// stage='hot' on exactly the rows they match today; the one new database touch
// (relay_conversations, for Response) is a read.
//
// Rendering is hand-windowed (fixed row height → arithmetic, no dependency),
// and the cell editors are ours rather than <select>, because a native
// select's arrow keys change the VALUE — the keystroke a sheet owes to moving.
// =============================================================================

import { useMemo, useRef, useState, useEffect, useCallback, useLayoutEffect } from 'react';
import {
  Star, Search, X, Download, Tags, RotateCcw, ChevronDown, ChevronUp, Check,
  Maximize2, Minimize2, ArrowUp, ArrowDown, Filter, CalendarDays,
} from 'lucide-react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import { useApp } from '@/components/shared/app-provider';
import {
  STAGE_META, STAGE_ORDER, getStageMeta, industryLabel, INDUSTRY_LIST,
  type Lead, type LeadStage,
} from '@/lib/types';
import {
  GTV_META, GTV_ORDER, WTP_META, WTP_ORDER, gtvOf, wtpOf,
  type GtvEligibility, type Wtp, type Swatch,
} from '@/lib/master-leads';
import {
  BUCKET_META, BUCKET_ORDER, bucketOf, type BucketId,
  RESPONSE_META, RESPONSE_ORDER, responseOf, type ResponseStatus,
  VISA_TRACK_META, visaTrackOf, type Chip,
} from '@/lib/playbook';
import {
  loadMasterPrefs, saveMasterPrefs, DEFAULT_PREFS, rangeOf, monthKeyOf, monthLabel,
  type MasterPrefs, type DatePref,
} from '@/lib/master-view-prefs';
import { initials, avatarColor, cn } from '@/lib/utils';

const ROW_H = 46;
const HEAD_H = 40;
const OVERSCAN = 8;

type ColId =
  | 'sel' | 'n' | 'lead' | 'phone' | 'field' | 'visa' | 'gtv' | 'wtp'
  | 'status' | 'spot' | 'bucket' | 'action' | 'resp' | 'notes' | 'created';

interface Col {
  id: ColId; label: string; w: number; min: number;
  edit?: 'enum' | 'text';
  filter?: 'enum' | 'text';
  sortable?: boolean;
  resizable?: boolean;
}

const COLUMNS: Col[] = [
  { id: 'sel',     label: '',                 w: 36,  min: 36 },
  { id: 'n',       label: '',                 w: 46,  min: 40 },
  { id: 'lead',    label: 'Lead Name',        w: 220, min: 150, edit: 'text', filter: 'text', sortable: true, resizable: true },
  { id: 'phone',   label: 'Phone',            w: 138, min: 100, edit: 'text', filter: 'text', sortable: true, resizable: true },
  { id: 'field',   label: 'Field / Category', w: 136, min: 100, edit: 'enum', filter: 'enum', sortable: true, resizable: true },
  { id: 'visa',    label: 'Visa Track',       w: 110, min: 90,  edit: 'enum', filter: 'enum', sortable: true, resizable: true },
  { id: 'gtv',     label: 'GTV Eligibility',  w: 148, min: 120, edit: 'enum', filter: 'enum', sortable: true, resizable: true },
  { id: 'wtp',     label: 'WTP',              w: 96,  min: 80,  edit: 'enum', filter: 'enum', sortable: true, resizable: true },
  { id: 'status',  label: 'Lead Status',      w: 140, min: 110, edit: 'enum', filter: 'enum', sortable: true, resizable: true },
  { id: 'spot',    label: 'Spotlight',        w: 104, min: 96,                filter: 'enum', sortable: true },
  { id: 'bucket',  label: 'Current Bucket',   w: 180, min: 130,               filter: 'enum', sortable: true, resizable: true },
  { id: 'action',  label: 'Offer / Action',   w: 240, min: 150,                               sortable: true, resizable: true },
  { id: 'resp',    label: 'Response',         w: 160, min: 116,               filter: 'enum', sortable: true, resizable: true },
  { id: 'notes',   label: 'Notes',            w: 240, min: 140, edit: 'text', filter: 'text', sortable: true, resizable: true },
  { id: 'created', label: 'Created',          w: 118, min: 100,                               sortable: true, resizable: true },
];

const FIRST_DATA_COL = 2;

// ── The playbook, laid out as stages of the funnel ───────────────────────────
// A Nordic palette — oat, clay rose, lavender fog, eucalyptus, fjord blue,
// stone, moss, terracotta. Muted, earthy tints in the Scandinavian and Dutch
// tradition: colour tells you which stage a card belongs to, the deep ink on
// top carries the number. Every pair is at least 4.5:1, so the soft grounds
// never cost legibility. Dark mode mixes the same accent into the surface,
// so the palette survives rather than being swapped out.
interface Tone { bg: string; border: string; accent: string; ink: string; sub: string }
const TONE: Record<string, Tone> = {
  'Assess':    { bg: '#F5EEE2', border: '#E7DAC1', accent: '#B08238', ink: '#4A3615', sub: '#7A6040' }, // oat · ochre
  'Groom':     { bg: '#F6E8EB', border: '#EACDD4', accent: '#B35F76', ink: '#521F2E', sub: '#85505F' }, // clay rose
  'Re-engage': { bg: '#EDEAF5', border: '#D9D3EB', accent: '#7465AE', ink: '#2F2756', sub: '#5E5586' }, // lavender fog
  'Convert':   { bg: '#E3EFEC', border: '#C7DED8', accent: '#4A8A80', ink: '#1C413B', sub: '#4B6C66' }, // eucalyptus
  'Redirect':  { bg: '#E4EDF4', border: '#C8D9E7', accent: '#4A7BA0', ink: '#1C3A52', sub: '#4C6780' }, // fjord blue
  'Closed':    { bg: '#EFEEEA', border: '#DDDBD4', accent: '#87857C', ink: '#383731', sub: '#6A6862' }, // stone
  'Won':       { bg: '#E8EEDD', border: '#D1DDBC', accent: '#6A8C3A', ink: '#2E4115', sub: '#5A6D42' }, // moss
  'Unrouted':  { bg: '#F6E6DC', border: '#EBCBB8', accent: '#B65A36', ink: '#55230F', sub: '#8A5238' }, // terracotta
};
const STAGE_NAME: Record<BucketId, string> = {
  needs_assessment: 'Assess',
  hot_groom: 'Groom', spotlight_groom: 'Groom',
  nr_wtp: 'Re-engage', nr_mwtp: 'Re-engage',
  cold_wtp: 'Convert', cold_mwtp: 'Convert', cold_nwtp: 'Convert',
  good_chicken: 'Redirect',
  bad_chicken: 'Closed',
  converted: 'Won',
  uncovered: 'Unrouted',
};
const STAGE_OF: Record<BucketId, { stage: string; color: string }> = Object.fromEntries(
  (Object.keys(STAGE_NAME) as BucketId[]).map((b) => [b, { stage: STAGE_NAME[b], color: TONE[STAGE_NAME[b]].accent }]),
) as Record<BucketId, { stage: string; color: string }>;

const CARD_LABEL: Record<BucketId, string> = {
  needs_assessment: 'Needs assessment',
  hot_groom: 'Hot',
  spotlight_groom: 'Spotlight',
  nr_wtp: 'Not responding · WTP',
  nr_mwtp: 'Not responding · M-WTP',
  cold_wtp: 'Cold · WTP',
  cold_mwtp: 'Cold · M-WTP',
  cold_nwtp: 'Cold · N-WTP',
  good_chicken: 'Good chicken',
  bad_chicken: 'Bad chicken',
  converted: 'Converted',
  uncovered: 'No bucket yet',
};

interface Option { value: string; label: string; swatch?: Swatch | Chip }
interface MenuOption { value: string; label: string; dot?: string; count: number }

const fmtN = (n: number) => n.toLocaleString('en-IN');
const pctOf = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

// ── Reply history ────────────────────────────────────────────────────────────
// One read of relay_conversations when the sheet mounts. The signed-in CRM user
// can see these rows because both apps share a workspace and the table's RLS
// selects on membership. If the read fails, Response shows "—" and says so in
// the status bar rather than guessing.
function useReplyHistory() {
  const [state, setState] = useState<{ replied: Set<string>; messaged: Set<string>; ok: boolean | null }>(
    { replied: new Set(), messaged: new Set(), ok: null },
  );
  useEffect(() => {
    let alive = true;
    (async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('relay_conversations')
        .select('lead_id, last_inbound_at, last_outbound_at')
        .not('lead_id', 'is', null)
        .limit(10000);
      if (!alive) return;
      if (error || !data) { setState((s) => ({ ...s, ok: false })); return; }
      const replied = new Set<string>();
      const messaged = new Set<string>();
      for (const c of data as { lead_id: string; last_inbound_at: string | null; last_outbound_at: string | null }[]) {
        if (c.last_inbound_at) replied.add(c.lead_id);
        if (c.last_outbound_at) messaged.add(c.lead_id);
      }
      setState({ replied, messaged, ok: true });
    })();
    return () => { alive = false; };
  }, []);
  return state;
}

export function MasterLeadsTable({ onRowClick }: { onRowClick?: (id: string) => void }) {
  const { leads, updateLead, bulkUpdateLeads, toggleSpotlight, addNote, user } = useApp();
  const wa = useReplyHistory();

  // Preferences load in an effect, never in a useState initialiser — reading
  // localStorage during the first render makes the server and client disagree.
  const [prefs, setPrefs] = useState<MasterPrefs>(DEFAULT_PREFS);
  const [ready, setReady] = useState(false);
  useEffect(() => { setPrefs(loadMasterPrefs()); setReady(true); }, []);
  useEffect(() => { if (ready) saveMasterPrefs(prefs); }, [prefs, ready]);
  const patchPrefs = useCallback((p: Partial<MasterPrefs>) => setPrefs((prev) => ({ ...prev, ...p })), []);

  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [active, setActive] = useState<{ r: number; c: number }>({ r: 0, c: FIRST_DATA_COL });
  const [editing, setEditing] = useState<{ r: number; c: number; seed?: string } | null>(null);
  const [menu, setMenu] = useState<{ col: ColId; rect: DOMRect } | null>(null);
  const [dateOpen, setDateOpen] = useState(false);
  const [dlOpen, setDlOpen] = useState(false);
  const [full, setFull] = useState(false);

  // Named in an effect: the server has no `navigator`, so sniffing it inline
  // renders "Ctrl" on the server and "⌘" on a Mac, and React rejects that.
  const [modKey, setModKey] = useState('Ctrl');
  useEffect(() => { if (/Mac|iPhone|iPad/.test(navigator.platform || '')) setModKey('⌘'); }, []);

  const chrome = useRef<HTMLDivElement>(null);
  const [gridH, setGridH] = useState(460);

  const cols = useMemo(() => COLUMNS.map((c) => ({ ...c, w: prefs.widths[c.id] ?? c.w })), [prefs.widths]);
  const colById = useMemo(() => new Map(cols.map((c) => [c.id, c])), [cols]);
  // Trailing flexible column so a wide screen is ruled to the edge.
  const template = useMemo(() => `${cols.map((c) => `${c.w}px`).join(' ')} minmax(0, 1fr)`, [cols]);
  const gridW = useMemo(() => cols.reduce((s, c) => s + c.w, 0), [cols]);
  const offsets = useMemo(() => {
    const o: number[] = []; let x = 0;
    for (const c of cols) { o.push(x); x += c.w; }
    return o;
  }, [cols]);

  // ── Data ──────────────────────────────────────────────────────────────────
  const real = useMemo(() => leads.filter((l) => !l.is_sample), [leads]);

  const bucketById = useMemo(() => {
    const m = new Map<string, BucketId>();
    for (const l of real) m.set(l.id, bucketOf(l));
    return m;
  }, [real]);

  const respOf = useCallback(
    (l: Lead): ResponseStatus => responseOf(l, wa.replied, wa.messaged),
    [wa.replied, wa.messaged],
  );

  const range = useMemo(() => rangeOf(prefs.date), [prefs.date]);
  const scoped = useMemo(() => {
    if (range.from === null && range.to === null) return real;
    return real.filter((l) => {
      const t = new Date(l.created_at).getTime();
      return (range.from === null || t >= range.from) && (range.to === null || t < range.to);
    });
  }, [real, range]);

  const months = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of real) { const k = monthKeyOf(l.created_at); m.set(k, (m.get(k) ?? 0) + 1); }
    return [...m.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [real]);

  // ── Filtering ─────────────────────────────────────────────────────────────
  const enumKey = useCallback((col: ColId, l: Lead): string => {
    switch (col) {
      case 'field':  return l.industry ?? '';
      case 'visa':   return visaTrackOf(l) ?? '';
      case 'gtv':    return l.eligibility ?? '';
      case 'wtp':    return l.investment_readiness ?? '';
      case 'status': return l.stage;
      case 'spot':   return l.is_spotlight ? 'yes' : 'no';
      case 'bucket': return bucketById.get(l.id) ?? 'uncovered';
      case 'resp':   return respOf(l);
      default:       return '';
    }
  }, [bucketById, respOf]);

  const textOf = (col: ColId, l: Lead): string => {
    switch (col) {
      case 'lead':  return `${l.full_name} ${l.email ?? ''}`;
      case 'phone': return l.phone ?? '';
      case 'notes': return l.last_note ?? '';
      default:      return '';
    }
  };

  const needle = q.trim().toLowerCase();

  /** Does this lead pass every active filter — except, optionally, one column's? */
  const passes = useCallback((l: Lead, except?: ColId): boolean => {
    if (needle) {
      const hay = `${l.full_name} ${l.phone ?? ''} ${l.email ?? ''}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    if (prefs.untaggedOnly && l.eligibility && l.investment_readiness) return false;
    for (const [col, vals] of Object.entries(prefs.filters)) {
      if (col === except || !vals || vals.length === 0) continue;
      if (col === 'resp' && !wa.ok) continue;
      if (!vals.includes(enumKey(col as ColId, l))) return false;
    }
    for (const [col, t] of Object.entries(prefs.text)) {
      if (col === except) continue;
      const qq = t.trim().toLowerCase(); if (!qq) continue;
      let hay = textOf(col as ColId, l).toLowerCase();
      if (col === 'phone' && /\d/.test(qq)) { hay = hay.replace(/\D/g, ''); if (!hay.includes(qq.replace(/\D/g, ''))) return false; continue; }
      if (!hay.includes(qq)) return false;
    }
    return true;
  }, [needle, prefs.untaggedOnly, prefs.filters, prefs.text, enumKey, wa.ok]);

  // ── Sorting ───────────────────────────────────────────────────────────────
  const sortValue = useCallback((col: string, l: Lead): string | number | null => {
    switch (col) {
      case 'lead':    return l.full_name.toLowerCase();
      case 'phone':   return l.phone || null;
      case 'field':   return l.industry ? industryLabel(l.industry).toLowerCase() : null;
      case 'visa':    { const v = visaTrackOf(l); return v ? (v === 'gtv' ? 0 : 1) : null; }
      case 'gtv':     return l.eligibility ? GTV_ORDER.indexOf(l.eligibility as GtvEligibility) : null;
      case 'wtp':     return l.investment_readiness ? WTP_ORDER.indexOf(l.investment_readiness as Wtp) : null;
      case 'status':  { const i = STAGE_ORDER.indexOf(l.stage); return i < 0 ? 99 : i; }
      case 'spot':    return l.is_spotlight ? 0 : 1;
      case 'bucket':  return BUCKET_ORDER.indexOf(bucketById.get(l.id) ?? 'uncovered');
      case 'action':  return BUCKET_META[bucketById.get(l.id) ?? 'uncovered'].action.toLowerCase();
      case 'resp':    return wa.ok ? RESPONSE_ORDER.indexOf(respOf(l)) : null;
      case 'notes':   return l.last_note ? l.last_note.toLowerCase() : null;
      default:        return new Date(l.created_at).getTime();
    }
  }, [bucketById, respOf, wa.ok]);

  const rows = useMemo(() => {
    const out = scoped.filter((l) => passes(l));
    const dir = prefs.sortDir === 'asc' ? 1 : -1;
    const key = prefs.sortKey;
    return out
      .map((l) => ({ l, v: sortValue(key, l) }))
      .sort((a, b) => {
        // Blanks sink to the bottom whichever way the column is sorted.
        if (a.v === null && b.v === null) return 0;
        if (a.v === null) return 1;
        if (b.v === null) return -1;
        if (typeof a.v === 'number' && typeof b.v === 'number') return dir * (a.v - b.v);
        return dir * String(a.v).localeCompare(String(b.v));
      })
      .map((x) => x.l);
  }, [scoped, passes, prefs.sortDir, prefs.sortKey, sortValue]);

  // ── Faceted counts ────────────────────────────────────────────────────────
  const cardBase = useMemo(() => scoped.filter((l) => passes(l, 'bucket')), [scoped, passes]);
  const bucketCounts = useMemo(() => {
    const c = new Map<BucketId, number>();
    for (const l of cardBase) { const b = bucketById.get(l.id) ?? 'uncovered'; c.set(b, (c.get(b) ?? 0) + 1); }
    return c;
  }, [cardBase, bucketById]);

  const enumOptions = useCallback((col: ColId): { value: string; label: string; dot?: string }[] => {
    switch (col) {
      case 'field':  return [...INDUSTRY_LIST.map((k) => ({ value: k as string, label: industryLabel(k) })), { value: '', label: 'Not set' }];
      case 'visa':   return [
        { value: 'gtv', label: 'GTV', dot: VISA_TRACK_META.gtv.dot },
        { value: 'ifv', label: 'IFV', dot: VISA_TRACK_META.ifv.dot },
        { value: '', label: 'Not set' }];
      case 'gtv':    return [...GTV_ORDER.map((k) => ({ value: k as string, label: GTV_META[k].label, dot: GTV_META[k].dot })), { value: '', label: 'Not set' }];
      case 'wtp':    return [...WTP_ORDER.map((k) => ({ value: k as string, label: `${WTP_META[k].short} — ${WTP_META[k].label}`, dot: WTP_META[k].dot })), { value: '', label: 'Not set' }];
      case 'status': {
        const known = STAGE_ORDER.map((k) => ({ value: k as string, label: STAGE_META[k].label, dot: STAGE_META[k].dot }));
        const extra = [...new Set(real.map((l) => l.stage as string))].filter((s) => !STAGE_ORDER.includes(s as LeadStage))
          .map((s) => ({ value: s, label: getStageMeta(s).label, dot: getStageMeta(s).dot }));
        return [...known, ...extra];
      }
      case 'spot':   return [{ value: 'yes', label: 'Spotlight', dot: '#F59E0B' }, { value: 'no', label: 'Not in spotlight' }];
      case 'bucket': return BUCKET_ORDER.map((b) => ({ value: b, label: CARD_LABEL[b], dot: STAGE_OF[b].color }));
      case 'resp':   return RESPONSE_ORDER.map((r) => ({ value: r, label: RESPONSE_META[r].label, dot: RESPONSE_META[r].dot }));
      default:       return [];
    }
  }, [real]);

  const menuOptions = useMemo((): MenuOption[] => {
    if (!menu) return [];
    const col = colById.get(menu.col);
    if (!col || col.filter !== 'enum') return [];
    const base = scoped.filter((l) => passes(l, menu.col));
    const counts = new Map<string, number>();
    for (const l of base) { const k = enumKey(menu.col, l); counts.set(k, (counts.get(k) ?? 0) + 1); }
    return enumOptions(menu.col).map((o) => ({ ...o, count: counts.get(o.value) ?? 0 }));
  }, [menu, colById, scoped, passes, enumKey, enumOptions]);

  const labelFor = (col: ColId, v: string) => enumOptions(col).find((o) => o.value === v)?.label ?? v;

  // ── Pulse ─────────────────────────────────────────────────────────────────
  const pulse = useMemo(() => {
    const n = rows.length;
    const assessed = rows.filter((l) => l.eligibility && l.investment_readiness).length;
    let contacted = 0, replied = 0;
    if (wa.ok) for (const l of rows) {
      const r = respOf(l);
      if (r !== 'never_contacted') contacted++;
      if (r === 'replied') replied++;
    }
    return { n, assessed, contacted, replied };
  }, [rows, wa.ok, respOf]);

  // ── Windowing ─────────────────────────────────────────────────────────────
  const scroller = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState({ top: 0, left: 0 });

  const filterSig = JSON.stringify([q, prefs.filters, prefs.text, prefs.untaggedOnly, prefs.date, prefs.sortKey, prefs.sortDir]);
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
    setScroll((s) => ({ ...s, top: 0 }));
    setActive((a) => ({ ...a, r: 0 }));
    setEditing(null);
  }, [filterSig]);

  const bodyH = Math.max(0, gridH - HEAD_H);
  const start = Math.max(0, Math.floor(scroll.top / ROW_H) - OVERSCAN);
  const end = Math.min(rows.length, Math.ceil((scroll.top + bodyH) / ROW_H) + OVERSCAN);
  const slice = rows.slice(start, end);

  const revealRow = useCallback((r: number) => {
    const el = scroller.current; if (!el) return;
    const y = r * ROW_H;
    if (y < el.scrollTop) el.scrollTop = y;
    else if (y + ROW_H > el.scrollTop + el.clientHeight - HEAD_H) el.scrollTop = y + ROW_H - (el.clientHeight - HEAD_H);
  }, []);
  useLayoutEffect(() => { revealRow(active.r); }, [active.r, revealRow]);

  // The sheet measures its own distance from the top of the window, so it is
  // right whether the cards are showing, the toolbar wraps, or chips appear.
  const STATUS_H = 32;
  useLayoutEffect(() => {
    const measure = () => {
      const el = scroller.current; if (!el) return;
      const top = el.getBoundingClientRect().top;
      setGridH(Math.max(260, window.innerHeight - top - STATUS_H - (full ? 14 : 20)));
    };
    measure();
    window.addEventListener('resize', measure);
    const ro = new ResizeObserver(measure);
    if (chrome.current) ro.observe(chrome.current);
    return () => { window.removeEventListener('resize', measure); ro.disconnect(); };
  }, [full, prefs.cardsHidden]);

  // ── Writes ────────────────────────────────────────────────────────────────
  const eligibilityPatch = useCallback((v: GtvEligibility | null): Partial<Lead> => ({
    eligibility: v,
    eligibility_at: v ? new Date().toISOString() : null,
    eligibility_by: v ? user.id : null,
    eligibility_source: v ? 'manual' : null,
  }), [user.id]);

  const editOptions = useCallback((c: ColId): Option[] => {
    switch (c) {
      case 'gtv': return [{ value: '', label: 'Not set' },
        ...GTV_ORDER.map((k) => ({ value: k as string, label: GTV_META[k].label, swatch: GTV_META[k] }))];
      case 'wtp': return [{ value: '', label: 'Not set' },
        ...WTP_ORDER.map((k) => ({ value: k as string, label: WTP_META[k].label, swatch: WTP_META[k] }))];
      case 'status': return STAGE_ORDER.map((k) => ({ value: k as string, label: STAGE_META[k].label, swatch: STAGE_META[k] }));
      case 'visa': return [{ value: '', label: 'Not set' },
        { value: 'gtv', label: 'GTV — Global Talent Visa', swatch: VISA_TRACK_META.gtv },
        { value: 'ifv', label: 'IFV — Innovator Founder Visa', swatch: VISA_TRACK_META.ifv }];
      case 'field': return [{ value: '', label: 'Not set' },
        ...INDUSTRY_LIST.map((k) => ({ value: k as string, label: industryLabel(k) }))];
      default: return [];
    }
  }, []);

  const commit = useCallback((lead: Lead, c: ColId, v: string) => {
    switch (c) {
      case 'gtv':    updateLead(lead.id, eligibilityPatch(v === '' ? null : v as GtvEligibility)); break;
      case 'wtp':    updateLead(lead.id, { investment_readiness: v === '' ? null : v as Wtp }); break;
      case 'status': if (v && v !== lead.stage) updateLead(lead.id, { stage: v as LeadStage }); break;
      case 'visa':   updateLead(lead.id, { visa_type: v === '' ? null : v }); break;
      case 'field':  updateLead(lead.id, { industry: v === '' ? null : v }); break;
      case 'lead': {
        const name = v.trim();
        if (!name) { toast.error('A lead needs a name'); break; }
        if (name !== lead.full_name) updateLead(lead.id, { full_name: name });
        break;
      }
      case 'phone': {
        const phone = v.trim();
        if (phone !== (lead.phone ?? '')) updateLead(lead.id, { phone: phone || null });
        break;
      }
      // Through addNote, so the note lands in the lead's history and the
      // activity log — writing last_note directly would hide it from the drawer.
      case 'notes': {
        const body = v.trim();
        if (body && body !== (lead.last_note ?? '')) addNote(lead.id, body);
        break;
      }
    }
    setEditing(null);
    scroller.current?.focus();
  }, [updateLead, eligibilityPatch, addNote]);

  const valueAt = (l: Lead, c: ColId): string => {
    switch (c) {
      case 'gtv':    return l.eligibility ?? '';
      case 'wtp':    return l.investment_readiness ?? '';
      case 'status': return l.stage;
      case 'visa':   return visaTrackOf(l) ?? '';
      case 'field':  return l.industry ?? '';
      case 'lead':   return l.full_name;
      case 'phone':  return l.phone ?? '';
      case 'notes':  return l.last_note ?? '';
      default:       return '';
    }
  };

  // ── Selection ─────────────────────────────────────────────────────────────
  const ids = useMemo(() => [...selected], [selected]);
  const applyBulk = async (patch: Partial<Lead>) => { await bulkUpdateLeads(ids, patch); setSelected(new Set()); };
  const allShown = rows.length > 0 && rows.every((l) => selected.has(l.id));
  const toggleAll = () => setSelected(allShown ? new Set() : new Set(rows.map((l) => l.id)));
  const toggleOne = (id: string) => setSelected((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  // ── Filter mutations ──────────────────────────────────────────────────────
  const setColFilter = (col: ColId, vals: string[]) =>
    setPrefs((p) => {
      const f = { ...p.filters };
      if (vals.length) f[col] = vals; else delete f[col];
      return { ...p, filters: f };
    });
  const setColText = (col: ColId, t: string) =>
    setPrefs((p) => {
      const tx = { ...p.text };
      if (t) tx[col] = t; else delete tx[col];
      return { ...p, text: tx };
    });
  const clearAll = () => { setQ(''); patchPrefs({ filters: {}, text: {}, untaggedOnly: false, date: { kind: 'all' } }); };

  const isFiltered = (col: ColId) => (prefs.filters[col]?.length ?? 0) > 0 || !!prefs.text[col]?.trim();

  // ── Keyboard ──────────────────────────────────────────────────────────────
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (editing || menu) return;
    const maxR = rows.length - 1;
    const lastC = cols.length - 1;
    const move = (dr: number, dc: number) => {
      e.preventDefault();
      setActive((a) => ({
        r: Math.min(maxR, Math.max(0, a.r + dr)),
        c: Math.min(lastC, Math.max(FIRST_DATA_COL, a.c + dc)),
      }));
    };
    const key = e.key;
    if ((e.metaKey || e.ctrlKey) && key.toLowerCase() === 'c') { e.preventDefault(); copySelection(); return; }
    if ((e.metaKey || e.ctrlKey) && key.toLowerCase() === 'a') { e.preventDefault(); setSelected(new Set(rows.map((l) => l.id))); return; }
    switch (key) {
      case 'ArrowDown':  return move(1, 0);
      case 'ArrowUp':    return move(-1, 0);
      case 'ArrowRight': return move(0, 1);
      case 'ArrowLeft':  return move(0, -1);
      case 'Tab':        return move(0, e.shiftKey ? -1 : 1);
      case 'PageDown':   return move(Math.floor(bodyH / ROW_H), 0);
      case 'PageUp':     return move(-Math.floor(bodyH / ROW_H), 0);
      case 'Home':       e.preventDefault(); return setActive((a) => ({ ...a, r: 0 }));
      case 'End':        e.preventDefault(); return setActive((a) => ({ ...a, r: maxR }));
      case 'Escape':     e.preventDefault(); if (full) { setFull(false); return; } return setSelected(new Set());
      case ' ': {
        e.preventDefault();
        const l = rows[active.r]; if (!l) return;
        if (cols[active.c].id === 'spot') toggleSpotlight(l.id); else toggleOne(l.id);
        return;
      }
      case 'Enter': {
        e.preventDefault();
        const col = cols[active.c]; const l = rows[active.r]; if (!l) return;
        if (col.edit) setEditing({ r: active.r, c: active.c });
        else if (col.id === 'spot') toggleSpotlight(l.id);
        else onRowClick?.(l.id);
        return;
      }
      default: {
        if (key.length === 1 && !e.metaKey && !e.ctrlKey && /[\w+@.\- ]/.test(key)) {
          const col = cols[active.c];
          if (col.edit === 'enum') setEditing({ r: active.r, c: active.c });
          else if (col.edit === 'text') { e.preventDefault(); setEditing({ r: active.r, c: active.c, seed: key }); }
        }
      }
    }
  };

  // ── Copy & download ───────────────────────────────────────────────────────
  const HEADERS = ['Lead Name', 'Phone', 'Field / Category', 'Visa Track', 'GTV Eligibility',
    'WTP Status', 'Lead Status', 'Spotlight', 'Current Lead Bucket', 'Offer / Action',
    'Response Status', 'Notes', 'Created'];

  const rowValues = useCallback((l: Lead): (string | number)[] => {
    const g = gtvOf(l); const w = wtpOf(l); const v = visaTrackOf(l);
    const b = BUCKET_META[bucketById.get(l.id) ?? 'uncovered'];
    return [
      l.full_name, l.phone ?? '', industryLabel(l.industry) || '', v ? VISA_TRACK_META[v].label : '',
      g ? GTV_META[g].label : '', w ? WTP_META[w].short : '', getStageMeta(l.stage).label,
      l.is_spotlight ? 'Yes' : '', b.label, b.action,
      wa.ok ? RESPONSE_META[respOf(l)].label : '', (l.last_note ?? '').replace(/\n/g, ' '),
      l.created_at.slice(0, 10),
    ];
  }, [bucketById, respOf, wa.ok]);

  const copySelection = useCallback(() => {
    const list = ids.length ? rows.filter((l) => selected.has(l.id)) : [rows[active.r]].filter(Boolean);
    if (!list.length) return;
    const tsv = [HEADERS, ...list.map(rowValues)].map((r) => r.join('\t')).join('\n');
    navigator.clipboard.writeText(tsv)
      .then(() => toast.success(`Copied ${list.length} row${list.length === 1 ? '' : 's'} — paste straight into Excel`))
      .catch(() => toast.error('The browser would not give access to the clipboard'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids, rows, selected, active.r, rowValues]);

  const save = (blob: Blob, name: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = name; a.click();
    URL.revokeObjectURL(url);
  };
  const fileStem = `migrizo-leads-${range.slug}`;

  const downloadCsv = () => {
    const csv = [HEADERS, ...rows.map(rowValues)]
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    save(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' }), `${fileStem}.csv`);
    toast.success(`${fmtN(rows.length)} leads · ${range.label} — exported to CSV`);
    setDlOpen(false);
  };

  const downloadXlsx = async () => {
    setDlOpen(false);
    const t = toast.loading('Building the workbook…');
    try {
      const XLSX = await import('xlsx');
      const body = rows.map(rowValues);
      const ws = XLSX.utils.aoa_to_sheet([HEADERS, ...body]);
      ws['!cols'] = [24, 15, 15, 10, 15, 9, 14, 9, 20, 32, 17, 40, 11].map((wch) => ({ wch }));
      ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: body.length, c: HEADERS.length - 1 } }) };
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Master Leads');
      const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
      save(new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${fileStem}.xlsx`);
      toast.success(`${fmtN(body.length)} leads · ${range.label} — exported to Excel`, { id: t });
    } catch {
      toast.error('Could not build the workbook. The CSV export still works.', { id: t });
    }
  };

  // ── Column resizing ───────────────────────────────────────────────────────
  const drag = useRef<{ id: ColId; x: number; w: number } | null>(null);
  const startResize = (e: React.MouseEvent, c: Col) => {
    e.preventDefault(); e.stopPropagation();
    drag.current = { id: c.id, x: e.clientX, w: c.w };
    const onMove = (ev: MouseEvent) => {
      const d = drag.current; if (!d) return;
      const col = COLUMNS.find((k) => k.id === d.id)!;
      const w = Math.max(col.min, Math.min(640, d.w + (ev.clientX - d.x)));
      setPrefs((p) => ({ ...p, widths: { ...p.widths, [d.id]: w } }));
    };
    const onUp = () => { drag.current = null; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // ── Active-filter chips ───────────────────────────────────────────────────
  const chips: { key: string; label: string; onRemove: () => void }[] = [];
  for (const [col, vals] of Object.entries(prefs.filters)) {
    if (!vals?.length) continue;
    const c = colById.get(col as ColId); if (!c) continue;
    const shown = vals.length <= 2 ? vals.map((v) => labelFor(c.id, v)).join(', ') : `${vals.length} selected`;
    chips.push({ key: `f:${col}`, label: `${c.label}: ${shown}`, onRemove: () => setColFilter(c.id, []) });
  }
  for (const [col, t] of Object.entries(prefs.text)) {
    if (!t?.trim()) continue;
    const c = colById.get(col as ColId); if (!c) continue;
    chips.push({ key: `t:${col}`, label: `${c.label} contains “${t.trim()}”`, onRemove: () => setColText(c.id, '') });
  }
  const anyFilter = chips.length > 0 || prefs.untaggedOnly || !!q || prefs.date.kind !== 'all';

  const activeLead = rows[active.r];
  const activeCol = cols[active.c];
  const bucketFilter = prefs.filters.bucket ?? [];

  return (
    <div className={cn('flex flex-col', full && 'fixed inset-0 z-[55] bg-[hsl(var(--bg))] p-3 sm:p-5')}>
      <div ref={chrome} className="flex flex-col gap-3">

        {/* ── 1 · Period and pulse ───────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <h1 className="text-[20px] font-semibold tracking-tight text-ink">Master Leads</h1>

          <div className="relative">
            <button
              onClick={() => setDateOpen((v) => !v)}
              className={cn('inline-flex h-8 items-center gap-2 rounded-lg border px-3 text-[12.5px] font-medium transition',
                prefs.date.kind !== 'all'
                  ? 'border-indigo bg-[hsl(var(--indigo-soft))] text-indigo'
                  : 'border-border bg-surface text-ink-2 hover:border-border-strong')}
            >
              <CalendarDays className="h-3.5 w-3.5" />
              <span className="text-muted">Created</span>
              <span>{range.label}</span>
              <ChevronDown className="h-3.5 w-3.5 opacity-60" />
            </button>
            {dateOpen && (
              <DateMenu
                value={prefs.date}
                months={months}
                onPick={(d) => { patchPrefs({ date: d }); setDateOpen(false); }}
                onClose={() => setDateOpen(false)}
              />
            )}
          </div>

          <div className="flex items-center divide-x divide-border rounded-lg border border-border bg-surface text-[12px]">
            <Stat value={fmtN(pulse.n)} label="leads" />
            <Stat value={`${pctOf(pulse.assessed, pulse.n)}%`} label="assessed" hint={`${fmtN(pulse.assessed)} have both eligibility and WTP`} />
            {wa.ok && <Stat value={`${pctOf(pulse.contacted, pulse.n)}%`} label="contacted" hint={`${fmtN(pulse.contacted)} messaged on WhatsApp`} />}
            {wa.ok && <Stat value={`${pctOf(pulse.replied, pulse.n)}%`} label="replied" hint={`${fmtN(pulse.replied)} have replied`} />}
          </div>

          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => patchPrefs({ cardsHidden: !prefs.cardsHidden })}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 text-[12.2px] font-medium text-muted transition hover:text-ink"
            >
              {prefs.cardsHidden ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
              {prefs.cardsHidden ? 'Show playbook' : 'Hide playbook'}
            </button>
            <button
              onClick={() => setFull((v) => !v)}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 text-[12.2px] font-medium text-muted transition hover:text-ink"
              title={full ? 'Leave full screen (Esc)' : 'Full screen'}
            >
              {full ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
              {full ? 'Exit' : 'Full screen'}
            </button>
          </div>
        </div>

        {/* ── 2 · Playbook ───────────────────────────────────────────────── */}
        {!prefs.cardsHidden && (
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            {BUCKET_ORDER.map((b) => {
              const n = bucketCounts.get(b) ?? 0;
              const share = pctOf(n, cardBase.length);
              const { stage } = STAGE_OF[b];
              const t = TONE[stage];
              const on = bucketFilter.includes(b);
              // Light values straight from the palette; dark ones mix the same
              // accent into the surface so each card keeps its identity at night.
              const vars = {
                '--c-bg': t.bg, '--c-bd': t.border, '--c-ac': t.accent, '--c-ink': t.ink, '--c-sub': t.sub,
                '--d-bg': `color-mix(in srgb, ${t.accent} 16%, hsl(var(--surface)))`,
                '--d-bd': `color-mix(in srgb, ${t.accent} 34%, hsl(var(--surface)))`,
                '--d-ink': `color-mix(in srgb, ${t.accent} 30%, white)`,
                '--d-sub': `color-mix(in srgb, ${t.accent} 55%, hsl(var(--muted)))`,
              } as React.CSSProperties;
              return (
                <button
                  key={b}
                  onClick={() => setColFilter('bucket', on && bucketFilter.length === 1 ? [] : [b])}
                  title={`${BUCKET_META[b].hint}\nPlay: ${BUCKET_META[b].action}`}
                  style={{
                    ...vars,
                    ...(on ? { boxShadow: `0 0 0 2px ${t.accent}, 0 10px 24px -12px ${t.accent}` } : {}),
                  }}
                  className={cn(
                    'group relative flex min-w-0 flex-col rounded-2xl border px-4 pb-3.5 pt-3 text-left transition duration-200',
                    'border-[color:var(--c-bd)] bg-[color:var(--c-bg)]',
                    'dark:border-[color:var(--d-bd)] dark:bg-[color:var(--d-bg)]',
                    'hover:-translate-y-0.5 hover:shadow-[0_10px_24px_-14px_rgba(0,0,0,0.35)]',
                    n === 0 && !on && 'opacity-55 saturate-[0.6]',
                  )}
                >
                  <div className="flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-[color:var(--c-ac)]" />
                    <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[color:var(--c-sub)] dark:text-[color:var(--d-sub)]">{stage}</span>
                    <span className="ml-auto text-[11px] font-medium tabular-nums text-[color:var(--c-sub)] dark:text-[color:var(--d-sub)]">{share}%</span>
                  </div>
                  <div className="mt-2 text-[26px] font-semibold leading-none tracking-[-0.02em] tabular-nums text-[color:var(--c-ink)] dark:text-[color:var(--d-ink)]">{fmtN(n)}</div>
                  <div className="mt-2 truncate text-[13px] font-semibold text-[color:var(--c-ink)] dark:text-[color:var(--d-ink)]">{CARD_LABEL[b]}</div>
                  <div className="mt-0.5 truncate text-[11.5px] text-[color:var(--c-sub)] dark:text-[color:var(--d-sub)]">{BUCKET_META[b].action}</div>
                  <div className="mt-3 h-1 w-full overflow-hidden rounded-full"
                    style={{ background: `color-mix(in srgb, ${t.accent} 18%, transparent)` }}>
                    <div className="h-full rounded-full bg-[color:var(--c-ac)] transition-[width] duration-700 ease-out"
                      style={{ width: `${Math.max(share, n ? 3 : 0)}%` }} />
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* ── 3 · Toolbar and active filters ─────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
            <input
              value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, phone, email"
              className="h-8 w-[230px] rounded-lg border border-border bg-surface pl-8 pr-7 text-[12.5px] outline-none transition focus:border-indigo"
            />
            {q && <button onClick={() => setQ('')} aria-label="Clear search"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-faint hover:text-ink"><X className="h-3.5 w-3.5" /></button>}
          </div>

          <button onClick={() => patchPrefs({ untaggedOnly: !prefs.untaggedOnly })}
            className={cn('inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[12.2px] font-medium transition',
              prefs.untaggedOnly ? 'border-indigo bg-[hsl(var(--indigo-soft))] text-indigo' : 'border-border bg-surface text-muted hover:text-ink')}>
            <Tags className="h-3.5 w-3.5" /> Needs tagging
          </button>

          {chips.map((c) => (
            <span key={c.key} className="inline-flex h-7 max-w-[280px] items-center gap-1 rounded-full border border-indigo/30 bg-[hsl(var(--indigo-soft))] pl-2.5 pr-1 text-[11.8px] font-medium text-indigo">
              <Filter className="h-3 w-3 shrink-0" />
              <span className="truncate">{c.label}</span>
              <button onClick={c.onRemove} aria-label={`Remove ${c.label}`} className="rounded-full p-0.5 hover:bg-indigo/15"><X className="h-3 w-3" /></button>
            </span>
          ))}

          {anyFilter ? (
            <button onClick={clearAll}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-[12.2px] font-medium text-muted transition hover:text-ink">
              <RotateCcw className="h-3.5 w-3.5" /> Reset view
            </button>
          ) : (
            <span className="hidden text-[11.8px] text-faint md:inline">Click any column name to sort or filter</span>
          )}

          <div className="relative ml-auto">
            <button onClick={() => setDlOpen((v) => !v)}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-ink px-3 text-[12.3px] font-medium text-[hsl(var(--surface))] transition hover:opacity-90">
              <Download className="h-3.5 w-3.5" /> Download {fmtN(rows.length)} <ChevronDown className="h-3 w-3 opacity-70" />
            </button>
            {dlOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setDlOpen(false)} />
                <div className="absolute right-0 z-40 mt-1.5 w-[250px] overflow-hidden rounded-xl border border-border bg-surface shadow-xl">
                  <div className="border-b border-border px-3 py-2 text-[11px] text-faint">
                    {fmtN(rows.length)} leads · {range.label}{chips.length ? ' · filtered' : ''}
                  </div>
                  <MenuItem onClick={downloadXlsx} title="Excel workbook (.xlsx)" sub="Filters on, columns sized" />
                  <MenuItem onClick={downloadCsv} title="CSV" sub="Opens anywhere" />
                  <MenuItem onClick={() => { copySelection(); setDlOpen(false); }}
                    title={ids.length ? `Copy ${ids.length} selected` : 'Copy this row'} sub="To paste into a sheet" />
                </div>
              </>
            )}
          </div>
        </div>

        {ids.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-indigo bg-[hsl(var(--indigo-soft))] px-3 py-2">
            <span className="text-[12.5px] font-semibold text-indigo">{ids.length} selected</span>
            <span className="text-[12px] text-muted">Set for all of them:</span>
            <BulkSelect label="GTV Eligibility" options={GTV_ORDER.map((k) => ({ value: k, label: GTV_META[k].label }))}
              onPick={(v) => applyBulk(eligibilityPatch(v as GtvEligibility))} />
            <BulkSelect label="WTP" options={WTP_ORDER.map((k) => ({ value: k, label: WTP_META[k].label }))}
              onPick={(v) => applyBulk({ investment_readiness: v as Wtp })} />
            <BulkSelect label="Lead Status" options={STAGE_ORDER.map((k) => ({ value: k, label: STAGE_META[k].label }))}
              onPick={(v) => applyBulk({ stage: v as LeadStage })} />
            <BulkSelect label="Visa Track" options={[
              { value: 'gtv', label: 'GTV — Global Talent Visa' },
              { value: 'ifv', label: 'IFV — Innovator Founder Visa' }]}
              onPick={(v) => applyBulk({ visa_type: v })} />
            <button onClick={() => setSelected(new Set())}
              className="ml-auto text-[12.2px] font-medium text-muted transition hover:text-ink">Clear</button>
          </div>
        )}
      </div>

      {/* ── 4 · Sheet ──────────────────────────────────────────────────────── */}
      <div className="mt-3 flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
        <div
          ref={scroller}
          tabIndex={0}
          onKeyDown={onKeyDown}
          onScroll={(e) => setScroll({ top: e.currentTarget.scrollTop, left: e.currentTarget.scrollLeft })}
          className="overflow-auto outline-none"
          style={{ height: gridH }}
        >
          <div style={{ minWidth: gridW }}>
            <div className="sticky top-0 z-20 grid select-none bg-surface-2 text-[11px] font-semibold text-muted"
              style={{ gridTemplateColumns: template, height: HEAD_H }}>
              {cols.map((c, i) => {
                const sorted = prefs.sortKey === c.id;
                const filtered = isFiltered(c.id);
                const interactive = c.sortable || c.filter;
                return (
                  <div key={c.id}
                    className={cn('relative flex h-full items-center border-b border-r border-border bg-surface-2',
                      i <= 2 && 'sticky z-10', c.id === 'sel' && 'justify-center', c.id === 'n' && 'justify-end pr-2')}
                    style={i === 0 ? { left: 0 } : i === 1 ? { left: cols[0].w } : i === 2 ? { left: cols[0].w + cols[1].w } : undefined}>
                    {c.id === 'sel' ? (
                      <input type="checkbox" checked={allShown} onChange={toggleAll}
                        aria-label="Select everything shown" className="h-3.5 w-3.5 accent-[hsl(var(--indigo))]" />
                    ) : interactive ? (
                      <button
                        onClick={(e) => setMenu({ col: c.id, rect: e.currentTarget.getBoundingClientRect() })}
                        className={cn('group flex h-full w-full min-w-0 items-center gap-1.5 px-2.5 text-left transition hover:bg-[hsl(var(--border)/0.5)] hover:text-ink',
                          (sorted || filtered || menu?.col === c.id) && 'text-ink')}
                      >
                        <span className="truncate">{c.label}</span>
                        {sorted && (prefs.sortDir === 'asc'
                          ? <ArrowUp className="h-3 w-3 shrink-0 text-indigo" />
                          : <ArrowDown className="h-3 w-3 shrink-0 text-indigo" />)}
                        {filtered && <Filter className="h-3 w-3 shrink-0 fill-indigo text-indigo" />}
                        <ChevronDown className="ml-auto h-3 w-3 shrink-0 opacity-30 transition group-hover:opacity-80" />
                      </button>
                    ) : (
                      <span className="px-2.5">{c.label}</span>
                    )}
                    {c.resizable && (
                      <span
                        onMouseDown={(e) => startResize(e, c)}
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
                        title="Drag to resize"
                        className="absolute -right-[4px] top-0 z-30 h-full w-[9px] cursor-col-resize after:absolute after:inset-y-0 after:left-1/2 after:w-px after:bg-transparent hover:after:bg-indigo"
                      />
                    )}
                  </div>
                );
              })}
              <div className="h-full border-b border-border bg-surface-2" />
            </div>

            {rows.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-4 py-20 text-center">
                <div className="text-[13.5px] font-medium text-ink-2">No leads match this view</div>
                <button onClick={clearAll} className="text-[12.5px] font-medium text-indigo hover:underline">Reset view</button>
              </div>
            ) : (
              <div style={{ height: rows.length * ROW_H, position: 'relative' }}>
                <div style={{ position: 'absolute', top: start * ROW_H, left: 0, right: 0 }}>
                  {slice.map((l, i) => {
                    const r = start + i;
                    const picked = selected.has(l.id);
                    const onActiveRow = r === active.r;
                    const rowBg = picked ? 'hsl(var(--indigo-soft))' : onActiveRow ? 'hsl(var(--surface-2))' : 'hsl(var(--surface))';
                    return (
                      <div key={l.id} className="grid" style={{ gridTemplateColumns: template, height: ROW_H }}>
                        {cols.map((c, ci) => (
                          <Cell
                            key={c.id} col={c} ci={ci} lead={l} row={r} rowBg={rowBg}
                            bucket={bucketById.get(l.id) ?? 'uncovered'}
                            resp={wa.ok === null ? null : wa.ok ? respOf(l) : null}
                            waFailed={wa.ok === false}
                            isActive={onActiveRow && ci === active.c}
                            isEditing={!!editing && editing.r === r && editing.c === ci}
                            picked={picked}
                            stickyLeft={ci === 0 ? 0 : ci === 1 ? cols[0].w : ci === 2 ? cols[0].w + cols[1].w : undefined}
                            onActivate={() => { setActive({ r, c: ci }); setEditing(null); }}
                            onOpen={() => c.edit && setEditing({ r, c: ci })}
                            onToggleSelect={() => toggleOne(l.id)}
                            onToggleSpot={() => toggleSpotlight(l.id)}
                            onOpenLead={() => onRowClick?.(l.id)}
                          />
                        ))}
                        <div className="border-b border-border" style={{ background: rowBg }} />
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border bg-surface-2 px-3 py-1.5 text-[11.5px] text-muted">
          <span><b className="text-ink">{fmtN(rows.length)}</b> of {fmtN(scoped.length)} in {range.label.toLowerCase()}</span>
          {ids.length > 0 && <span className="text-indigo"><b>{ids.length}</b> selected</span>}
          {bucketFilter.length === 1 && (
            <span>Play: <b className="text-ink-2">{BUCKET_META[bucketFilter[0] as BucketId]?.action}</b></span>
          )}
          {wa.ok === false && <span className="text-faint">WhatsApp reply history unavailable</span>}
          {activeLead && (
            <span className="truncate">R{active.r + 1} · {activeCol.label || '—'} · <span className="text-ink-2">{activeLead.full_name}</span></span>
          )}
          <span className="ml-auto hidden text-faint sm:block">Arrows move · Enter edits · Space selects · {modKey}C copies · double-click a name to open</span>
        </div>
      </div>

      {/* ── Column menu ───────────────────────────────────────────────────── */}
      {menu && (() => {
        const c = colById.get(menu.col)!;
        return (
          <ColumnMenu
            col={c}
            rect={menu.rect}
            sortDir={prefs.sortKey === c.id ? prefs.sortDir : null}
            onSort={(d) => { patchPrefs({ sortKey: c.id, sortDir: d }); setMenu(null); }}
            options={c.filter === 'enum' ? menuOptions : undefined}
            selected={prefs.filters[c.id] ?? []}
            onChange={(vals) => setColFilter(c.id, vals)}
            text={c.filter === 'text' ? (prefs.text[c.id] ?? '') : undefined}
            onText={(t) => setColText(c.id, t)}
            disabled={c.id === 'resp' && !wa.ok ? 'Reply history is still loading' : undefined}
            onClear={() => { setColFilter(c.id, []); setColText(c.id, ''); }}
            onClose={() => { setMenu(null); scroller.current?.focus(); }}
          />
        );
      })()}

      {/* ── Cell editor ───────────────────────────────────────────────────── */}
      {editing && rows[editing.r] && (() => {
        const col = cols[editing.c];
        const anchor = {
          x: (scroller.current?.getBoundingClientRect().left ?? 0) - scroll.left + offsets[editing.c],
          y: (scroller.current?.getBoundingClientRect().top ?? 0) + HEAD_H - scroll.top + editing.r * ROW_H,
          w: col.w, h: ROW_H,
        };
        return col.edit === 'text' ? (
          <TextEditor
            key={`${editing.r}:${editing.c}`}
            anchor={anchor}
            initial={editing.seed !== undefined ? editing.seed : valueAt(rows[editing.r], col.id)}
            wide={col.id === 'notes'}
            placeholder={col.id === 'notes' ? 'Add a note — it lands in the lead history' : col.label}
            onCommit={(v) => commit(rows[editing.r], col.id, v)}
            onClose={() => { setEditing(null); scroller.current?.focus(); }}
          />
        ) : (
          <CellEditor
            anchor={anchor}
            options={editOptions(col.id)}
            current={valueAt(rows[editing.r], col.id)}
            onPick={(v) => commit(rows[editing.r], col.id, v)}
            onClose={() => { setEditing(null); scroller.current?.focus(); }}
          />
        );
      })()}
    </div>
  );
}

// ── Header pieces ───────────────────────────────────────────────────────────

function Stat({ value, label, hint }: { value: string; label: string; hint?: string }) {
  return (
    <span className="flex items-baseline gap-1 px-3 py-1.5" title={hint}>
      <b className="font-semibold tabular-nums text-ink">{value}</b>
      <span className="text-muted">{label}</span>
    </span>
  );
}

function DateMenu({ value, months, onPick, onClose }: {
  value: DatePref;
  months: [string, number][];
  onPick: (d: DatePref) => void;
  onClose: () => void;
}) {
  const [from, setFrom] = useState(value.kind === 'custom' ? value.from ?? '' : '');
  const [to, setTo] = useState(value.kind === 'custom' ? value.to ?? '' : '');
  const quick: { d: DatePref; label: string }[] = [
    { d: { kind: 'all' }, label: 'All time' },
    { d: { kind: 'today' }, label: 'Today' },
    { d: { kind: '7d' }, label: 'Last 7 days' },
    { d: { kind: '30d' }, label: 'Last 30 days' },
    { d: { kind: 'this_month' }, label: 'This month' },
    { d: { kind: 'last_month' }, label: 'Last month' },
  ];
  const isOn = (d: DatePref) => d.kind === value.kind && (d.kind !== 'month' || d.month === value.month);

  return (
    <>
      <div className="fixed inset-0 z-[60]" onMouseDown={onClose} />
      <div className="absolute left-0 z-[61] mt-1.5 flex w-[440px] overflow-hidden rounded-xl border border-border bg-surface shadow-2xl"
        onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
        <div className="w-[170px] border-r border-border p-1.5">
          <div className="px-2 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-faint">Quick</div>
          {quick.map((o) => (
            <button key={o.label} onClick={() => onPick(o.d)}
              className={cn('flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-[12.5px] transition',
                isOn(o.d) ? 'bg-[hsl(var(--indigo-soft))] font-medium text-indigo' : 'text-ink-2 hover:bg-surface-2')}>
              {o.label}{isOn(o.d) && <Check className="h-3.5 w-3.5" />}
            </button>
          ))}
          <div className="mt-2 border-t border-border px-2 pb-1 pt-2.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-faint">Custom range</div>
          <div className="flex flex-col gap-1.5 px-2 pb-2">
            <label className="text-[11px] text-muted">From
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
                className="mt-0.5 block h-7 w-full rounded-md border border-border bg-surface px-1.5 text-[12px] text-ink outline-none focus:border-indigo" />
            </label>
            <label className="text-[11px] text-muted">To
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
                className="mt-0.5 block h-7 w-full rounded-md border border-border bg-surface px-1.5 text-[12px] text-ink outline-none focus:border-indigo" />
            </label>
            <button disabled={!from && !to}
              onClick={() => onPick({ kind: 'custom', from: from || undefined, to: to || undefined })}
              className="mt-1 h-7 rounded-md bg-indigo text-[12px] font-medium text-white transition hover:opacity-90 disabled:opacity-40">
              Apply range
            </button>
          </div>
        </div>
        <div className="flex max-h-[330px] flex-1 flex-col p-1.5">
          <div className="px-2 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-faint">By month</div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {months.map(([ym, n]) => {
              const d: DatePref = { kind: 'month', month: ym };
              const on = isOn(d);
              return (
                <button key={ym} onClick={() => onPick(d)}
                  className={cn('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] transition',
                    on ? 'bg-[hsl(var(--indigo-soft))] font-medium text-indigo' : 'text-ink-2 hover:bg-surface-2')}>
                  <span className="flex-1">{monthLabel(ym)}</span>
                  <span className={cn('tabular-nums text-[11.5px]', on ? 'text-indigo' : 'text-faint')}>{fmtN(n)}</span>
                  {on && <Check className="h-3.5 w-3.5" />}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}

/**
 * The menu behind every column name — sort, and filter by value or by text.
 * Counts beside each value are faceted: they reflect every OTHER filter in
 * force, so the number is exactly what ticking that value will leave.
 */
function ColumnMenu({ col, rect, sortDir, onSort, options, selected, onChange, text, onText, disabled, onClear, onClose }: {
  col: Col; rect: DOMRect;
  sortDir: 'asc' | 'desc' | null;
  onSort: (d: 'asc' | 'desc') => void;
  options?: MenuOption[];
  selected: string[];
  onChange: (vals: string[]) => void;
  text?: string;
  onText: (t: string) => void;
  disabled?: string;
  onClear: () => void;
  onClose: () => void;
}) {
  const W = 268;
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - W - 8));
  const top = rect.bottom + 4;
  const maxH = Math.max(200, window.innerHeight - top - 16);
  const sortLabels: Record<string, [string, string]> = {
    created: ['Oldest first', 'Newest first'],
    lead: ['A → Z', 'Z → A'], phone: ['A → Z', 'Z → A'], notes: ['A → Z', 'Z → A'],
    action: ['A → Z', 'Z → A'], field: ['A → Z', 'Z → A'],
  };
  const [ascL, descL] = sortLabels[col.id] ?? ['First to last', 'Last to first'];
  const hasFilter = selected.length > 0 || !!text?.trim();

  const toggle = (v: string) =>
    onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);

  return (
    <>
      <div className="fixed inset-0 z-[64]" onMouseDown={onClose} />
      <div
        role="dialog"
        aria-label={`${col.label} options`}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } }}
        className="fixed z-[65] flex flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-2xl"
        style={{ left, top, width: W, maxHeight: maxH }}
      >
        <div className="border-b border-border px-3 py-2 text-[12px] font-semibold text-ink">{col.label}</div>

        {col.sortable && (
          <div className="border-b border-border p-1">
            {([['asc', ascL, ArrowUp], ['desc', descL, ArrowDown]] as const).map(([d, label, Icon]) => (
              <button key={d} onClick={() => onSort(d)}
                className={cn('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] transition',
                  sortDir === d ? 'bg-[hsl(var(--indigo-soft))] font-medium text-indigo' : 'text-ink-2 hover:bg-surface-2')}>
                <Icon className="h-3.5 w-3.5" /> Sort {label}
                {sortDir === d && <Check className="ml-auto h-3.5 w-3.5" />}
              </button>
            ))}
          </div>
        )}

        {options && (
          <div className="flex min-h-0 flex-col">
            <div className="flex items-center px-3 pb-1 pt-2">
              <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-faint">Show only</span>
              {!disabled && (
                <span className="ml-auto flex gap-2 text-[11px]">
                  <button onClick={() => onChange(options.filter((o) => o.count > 0).map((o) => o.value))} className="text-muted hover:text-ink">All</button>
                  <button onClick={() => onChange([])} className="text-muted hover:text-ink">None</button>
                </span>
              )}
            </div>
            {disabled ? (
              <div className="px-3 pb-3 text-[12px] text-faint">{disabled}</div>
            ) : (
              <div className="min-h-0 overflow-y-auto p-1 pt-0">
                {options.map((o) => {
                  const on = selected.includes(o.value);
                  return (
                    <button key={o.value || '_blank'} onClick={() => toggle(o.value)}
                      className={cn('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] transition hover:bg-surface-2',
                        o.count === 0 && !on && 'opacity-45')}>
                      <span className={cn('flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[4px] border transition',
                        on ? 'border-indigo bg-indigo text-white' : 'border-border-strong')}>
                        {on && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
                      </span>
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: o.dot ?? 'hsl(var(--faint))' }} />
                      <span className={cn('flex-1 truncate', on ? 'font-medium text-ink' : 'text-ink-2')}>{o.label}</span>
                      <span className="tabular-nums text-[11.5px] text-faint">{fmtN(o.count)}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {text !== undefined && (
          <div className="p-2.5">
            <div className="pb-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-faint">Contains</div>
            <input
              autoFocus
              value={text}
              onChange={(e) => onText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') onClose(); }}
              placeholder={`Filter ${col.label.toLowerCase()}…`}
              className="h-8 w-full rounded-lg border border-border bg-surface px-2.5 text-[12.5px] outline-none focus:border-indigo"
            />
          </div>
        )}

        {(options || text !== undefined) && (
          <div className="flex items-center justify-between border-t border-border px-2 py-1.5">
            <button onClick={onClear} disabled={!hasFilter}
              className="rounded-md px-2 py-1 text-[12px] font-medium text-muted transition hover:text-ink disabled:opacity-40">Clear filter</button>
            <button onClick={onClose} className="rounded-md bg-ink px-3 py-1 text-[12px] font-medium text-[hsl(var(--surface))] hover:opacity-90">Done</button>
          </div>
        )}
      </div>
    </>
  );
}

// ── Cell ────────────────────────────────────────────────────────────────────

function Pill({ chip, text }: { chip: Chip | Swatch; text: string }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 truncate rounded-md px-2 py-[3px] text-[11.3px] font-medium"
      style={{ background: chip.bg, color: chip.fg }}>
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: chip.dot }} />
      <span className="truncate">{text}</span>
    </span>
  );
}

function Cell({
  col, ci, lead, row, rowBg, bucket, resp, waFailed, picked, isActive, isEditing, stickyLeft,
  onActivate, onOpen, onToggleSelect, onToggleSpot, onOpenLead,
}: {
  col: Col; ci: number; lead: Lead; row: number; rowBg: string;
  bucket: BucketId; resp: ResponseStatus | null; waFailed: boolean;
  picked: boolean; isActive: boolean; isEditing: boolean;
  stickyLeft?: number;
  onActivate: () => void; onOpen: () => void;
  onToggleSelect: () => void; onToggleSpot: () => void; onOpenLead: () => void;
}) {
  const dash = <span className="px-1 text-[12px] text-faint">—</span>;
  const content = (() => {
    switch (col.id) {
      case 'sel':
        return <input type="checkbox" tabIndex={-1} checked={picked} onChange={onToggleSelect}
          aria-label={`Select ${lead.full_name}`} className="mx-auto h-3.5 w-3.5 accent-[hsl(var(--indigo))] outline-none" />;
      case 'n':
        return <span className="w-full pr-2 text-right text-[10.5px] tabular-nums text-faint">{row + 1}</span>;
      case 'lead':
        return (
          <button type="button" tabIndex={-1} onDoubleClick={onOpenLead} title="Double-click to open the lead"
            className="flex h-full w-full min-w-0 items-center gap-2.5 px-2.5 text-left outline-none focus:outline-none">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10.5px] font-semibold text-white"
              style={{ background: avatarColor(lead.full_name) }}>{initials(lead.full_name)}</span>
            <span className="truncate text-[12.8px] font-medium text-ink">{lead.full_name}</span>
          </button>
        );
      case 'phone':
        return <span className="truncate px-2.5 tabular-nums text-[12.3px] text-ink-2">{lead.phone || '—'}</span>;
      case 'field':
        return lead.industry ? <span className="truncate px-2.5 text-[12.3px] text-ink-2">{industryLabel(lead.industry)}</span> : <span className="px-2.5">{dash}</span>;
      case 'visa': {
        const v = visaTrackOf(lead);
        return <div className="w-full px-2">{v ? <Pill chip={VISA_TRACK_META[v]} text={VISA_TRACK_META[v].label} /> : dash}</div>;
      }
      case 'gtv': {
        const g = gtvOf(lead);
        return <div className="w-full px-2">{g ? <Pill chip={GTV_META[g]} text={GTV_META[g].label} /> : dash}</div>;
      }
      case 'wtp': {
        const w = wtpOf(lead);
        return <div className="w-full px-2">{w ? <Pill chip={WTP_META[w]} text={WTP_META[w].short} /> : dash}</div>;
      }
      case 'status': {
        const m = getStageMeta(lead.stage);
        return <div className="w-full px-2"><Pill chip={m as Chip} text={m.label} /></div>;
      }
      case 'spot':
        return (
          <button type="button" tabIndex={-1} onClick={onToggleSpot} aria-pressed={lead.is_spotlight}
            title={lead.is_spotlight ? 'In Spotlight — click to remove' : 'Add to Spotlight'}
            className="mx-auto rounded p-1 outline-none transition hover:scale-110 focus:outline-none">
            <Star className="h-4 w-4" style={lead.is_spotlight ? { fill: '#F59E0B', color: '#F59E0B' } : { color: 'hsl(var(--border-strong))' }} />
          </button>
        );
      case 'bucket': {
        const m = BUCKET_META[bucket];
        return (
          <div className="flex w-full min-w-0 items-center gap-2 px-2.5">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: STAGE_OF[bucket].color }} />
            <span className="truncate text-[12.3px] font-medium text-ink">{CARD_LABEL[bucket] ?? m.label}</span>
          </div>
        );
      }
      case 'action':
        return <span className="truncate px-2.5 text-[12px] text-ink-2" title={BUCKET_META[bucket].action}>{BUCKET_META[bucket].action}</span>;
      case 'resp': {
        if (waFailed) return <div className="px-2">{dash}</div>;
        if (!resp) return <span className="px-2.5 text-[11.5px] text-faint">…</span>;
        const m = RESPONSE_META[resp];
        return <div className="w-full px-2"><Pill chip={m} text={m.label} /></div>;
      }
      case 'notes':
        return lead.last_note
          ? <span className="truncate px-2.5 text-[12px] text-ink-2" title={lead.last_note}>{lead.last_note}</span>
          : <span className="px-2.5">{dash}</span>;
      default:
        return <span className="whitespace-nowrap px-2.5 tabular-nums text-[12px] text-muted">{fmtDate(lead.created_at)}</span>;
    }
  })();

  return (
    <div
      className={cn('relative flex h-full min-w-0 items-center border-b border-r border-border', stickyLeft !== undefined && 'sticky z-10')}
      style={{ background: rowBg, left: stickyLeft }}
      onMouseDown={(e) => {
        if (ci >= FIRST_DATA_COL) onActivate();
        (e.currentTarget.closest('[tabindex="0"]') as HTMLElement | null)?.focus();
      }}
      onClick={() => { if (col.edit) onOpen(); }}
    >
      {content}
      {isActive && !isEditing && (
        <span aria-hidden className="pointer-events-none absolute inset-0 z-20 rounded-[3px] border-2 border-indigo" />
      )}
    </div>
  );
}

// ── Editors ─────────────────────────────────────────────────────────────────

function CellEditor({ anchor, options, current, onPick, onClose }: {
  anchor: { x: number; y: number; w: number; h: number };
  options: Option[];
  current: string;
  onPick: (v: string) => void;
  onClose: () => void;
}) {
  const [i, setI] = useState(() => Math.max(0, options.findIndex((o) => o.value === current)));
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { box.current?.focus(); }, []);

  const h = Math.min(options.length * 32 + 8, 320);
  const below = anchor.y + anchor.h + h < window.innerHeight - 8;
  const top = below ? anchor.y + anchor.h : Math.max(8, anchor.y - h);
  const w = Math.max(anchor.w, 220);

  return (
    <>
      <div className="fixed inset-0 z-[60]" onMouseDown={onClose} />
      <div
        ref={box} tabIndex={-1} role="listbox"
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setI((n) => Math.min(options.length - 1, n + 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setI((n) => Math.max(0, n - 1)); }
          else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); onPick(options[i].value); }
          else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
          else if (e.key.length === 1) {
            const k = e.key.toLowerCase();
            const hit = options.findIndex((o) => o.label.toLowerCase().startsWith(k));
            if (hit >= 0) setI(hit);
          }
        }}
        className="fixed z-[61] overflow-y-auto rounded-xl border border-border bg-surface p-1 shadow-2xl outline-none"
        style={{ left: Math.max(8, Math.min(anchor.x, window.innerWidth - w - 8)), top, width: w, maxHeight: h }}
      >
        {options.map((o, n) => (
          <button
            key={o.value || '_none'} role="option" aria-selected={o.value === current}
            onMouseEnter={() => setI(n)} onClick={() => onPick(o.value)}
            className={cn('flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12.5px] transition',
              n === i ? 'bg-[hsl(var(--indigo-soft))]' : 'hover:bg-surface-2')}
          >
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: o.swatch ? o.swatch.dot : 'hsl(var(--faint))' }} />
            <span className="flex-1 truncate">{o.label}</span>
            {o.value === current && <Check className="h-3.5 w-3.5 shrink-0 text-indigo" />}
          </button>
        ))}
      </div>
    </>
  );
}

/** Airtable's model: Enter or clicking away commits, Escape discards. */
function TextEditor({ anchor, initial, placeholder, wide, onCommit, onClose }: {
  anchor: { x: number; y: number; w: number; h: number };
  initial: string; placeholder?: string; wide?: boolean;
  onCommit: (v: string) => void; onClose: () => void;
}) {
  const [v, setV] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    el.focus(); el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  const w = Math.max(anchor.w, wide ? 340 : 230);
  const left = Math.max(8, Math.min(anchor.x, window.innerWidth - w - 8));
  return (
    <>
      <div className="fixed inset-0 z-[60]" onMouseDown={() => ref.current?.blur()} />
      <input
        ref={ref} value={v} placeholder={placeholder}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); done.current = true; onCommit(v); }
          else if (e.key === 'Escape') { e.preventDefault(); done.current = true; onClose(); }
          e.stopPropagation();
        }}
        onBlur={() => { if (!done.current) { done.current = true; onCommit(v); } }}
        className="fixed z-[61] rounded-md border-2 border-indigo bg-surface px-2.5 text-[12.8px] text-ink shadow-xl outline-none"
        style={{ left, top: anchor.y, width: w, height: anchor.h }}
      />
    </>
  );
}

// ── Small pieces ────────────────────────────────────────────────────────────

function MenuItem({ onClick, title, sub }: { onClick: () => void; title: string; sub: string }) {
  return (
    <button onClick={onClick} className="block w-full px-3 py-2 text-left transition hover:bg-surface-2">
      <div className="text-[12.5px] font-medium text-ink">{title}</div>
      <div className="text-[11px] text-faint">{sub}</div>
    </button>
  );
}

function BulkSelect({ label, options, onPick }: {
  label: string; options: { value: string; label: string }[]; onPick: (v: string) => void;
}) {
  return (
    <div className="relative">
      <select value="" onChange={(e) => { const v = e.target.value; e.currentTarget.value = ''; if (v) onPick(v); }}
        className="h-7 cursor-pointer appearance-none rounded-lg border border-border bg-surface pl-2.5 pr-7 text-[12px] font-medium text-ink outline-none transition hover:border-indigo">
        <option value="">{label}…</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-faint" />
    </div>
  );
}
