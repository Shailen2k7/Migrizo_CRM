import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import type { LeadStage, PaymentStatus } from './types';
import { normalizePhone, normalizeEmail } from './utils';

// =========================================
// Field auto-detection — Zoho Bigin & general CRM exports
// Returns the canonical field for any column header
// =========================================

const FIELD_PATTERNS: Record<string, RegExp[]> = {
  full_name:    [/^full[\s_-]?name$/i, /^name$/i, /^contact[\s_-]?name$/i, /^lead[\s_-]?name$/i, /^client[\s_-]?name$/i, /^account[\s_-]?name$/i],
  first_name:   [/^first[\s_-]?name$/i, /^firstname$/i, /^given[\s_-]?name$/i],
  last_name:    [/^last[\s_-]?name$/i, /^lastname$/i, /^surname$/i, /^family[\s_-]?name$/i],
  phone:        [/^phone$/i, /^phone[\s_-]?number$/i, /^mobile$/i, /^mobile[\s_-]?(number|phone)$/i, /^contact[\s_-]?number$/i, /^cell$/i, /^telephone$/i, /^primary[\s_-]?phone$/i],
  email:        [/^email$/i, /^email[\s_-]?address$/i, /^e[\s_-]?mail$/i, /^primary[\s_-]?email$/i],
  visa_type:    [/^visa[\s_-]?type$/i, /^visa$/i, /^product$/i, /^service$/i, /^category$/i, /^interest$/i, /^pipeline$/i],
  stage:        [/^stage$/i, /^lead[\s_-]?stage$/i, /^status$/i, /^lead[\s_-]?status$/i, /^deal[\s_-]?stage$/i, /^pipeline[\s_-]?stage$/i, /^current[\s_-]?stage$/i],
  last_note:    [/^last[\s_-]?note$/i, /^notes?$/i, /^description$/i, /^comments?$/i, /^remarks$/i, /^message$/i],
  next_follow_up: [/^next[\s_-]?follow[\s_-]?up([\s_-]?date)?$/i, /^follow[\s_-]?up([\s_-]?date)?$/i, /^next[\s_-]?action([\s_-]?date)?$/i, /^next[\s_-]?contact$/i, /^reminder$/i],
  payment_status: [/^payment[\s_-]?status$/i, /^paid[\s_-]?status$/i, /^payment$/i],
  amount_paid: [/^amount[\s_-]?paid$/i, /^paid[\s_-]?amount$/i, /^paid$/i, /^revenue$/i, /^value$/i, /^deal[\s_-]?amount$/i, /^amount$/i],
};

export type CanonicalField = keyof typeof FIELD_PATTERNS | 'full_name';

export function detectField(header: string): CanonicalField | null {
  const h = header.trim();
  for (const [field, patterns] of Object.entries(FIELD_PATTERNS)) {
    if (patterns.some((re) => re.test(h))) return field as CanonicalField;
  }
  return null;
}

// =========================================
// Stage normalization — map various stage strings to our canonical stages
// =========================================

export function normalizeStage(raw: string | null | undefined): LeadStage {
  if (!raw) return 'new';
  const s = raw.toLowerCase().trim();
  if (/won|closed.?won|completed|success/.test(s)) return 'won';
  if (/lost|closed.?lost|dropped|rejected|disqualified/.test(s)) return 'lost';
  if (/partial.?pay/.test(s)) return 'partial';
  if (/proposal|negotiat|quote/.test(s)) return 'proposal';
  if (/consult/.test(s)) return 'consultation';
  if (/qualif/.test(s)) return 'qualified';
  if (/connect|in.?(conversation|progress)|engaged/.test(s)) return 'connected';
  if (/attempt|contact.?made|tried/.test(s)) return 'attempted';
  return 'new';
}

export function normalizePaymentStatus(raw: string | null | undefined, amountPaid: number): PaymentStatus {
  if (raw) {
    const s = raw.toLowerCase().trim();
    if (/overdue|late/.test(s)) return 'overdue';
    if (/paid|completed/.test(s)) return 'paid';
    if (/partial/.test(s)) return 'partial';
    if (/no|none|not/.test(s)) return 'none';
  }
  if (amountPaid > 0) return 'partial';
  return 'none';
}

export function parseDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;

  // Try ISO first
  let d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString();

  // DD/MM/YYYY or DD-MM-YYYY
  const m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/);
  if (m) {
    let [, dd, mm, yy] = m;
    let yyyy = yy.length === 2 ? '20' + yy : yy;
    d = new Date(`${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`);
    if (!isNaN(d.getTime())) return d.toISOString();
  }
  return null;
}

export function parseAmount(raw: string | number | null | undefined): number {
  if (raw == null || raw === '') return 0;
  if (typeof raw === 'number') return Math.round(raw);
  const digits = String(raw).replace(/[^\d.-]/g, '');
  const n = parseFloat(digits);
  return isNaN(n) ? 0 : Math.round(n);
}

// =========================================
// Parsed lead (after normalization, before insert)
// =========================================

export interface ParsedLead {
  full_name: string;
  phone: string | null;
  email: string | null;
  visa_type: string | null;
  stage: LeadStage;
  last_note: string | null;
  next_follow_up: string | null;
  payment_status: PaymentStatus;
  amount_paid: number;
  // Import metadata
  _row: number;
  _errors: string[];
  _warnings: string[];
  _duplicate?: 'phone' | 'email' | null;
}

export interface FieldMap {
  [canonical: string]: string; // canonical field → CSV column name
}

export interface ImportPreview {
  fileName: string;
  totalRows: number;
  fieldMap: FieldMap;
  unmappedHeaders: string[];
  rows: ParsedLead[];
  validCount: number;
  errorCount: number;
  warningCount: number;
  duplicateCount: number;
}

// =========================================
// Read file (CSV or Excel)
// =========================================

export async function readFile(file: File): Promise<{ headers: string[]; rows: Record<string, string>[] }> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.csv') || name.endsWith('.txt')) {
    return await readCsv(file);
  }
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    return await readExcel(file);
  }
  throw new Error('Unsupported file type. Please upload CSV or Excel (.xlsx, .xls).');
}

function readCsv(file: File): Promise<{ headers: string[]; rows: Record<string, string>[] }> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: (h) => h.trim(),
      complete: (results) => {
        const headers = (results.meta.fields || []).map((h) => h.trim());
        const rows = (results.data || []) as Record<string, string>[];
        resolve({ headers, rows });
      },
      error: (err) => reject(err),
    });
  });
}

async function readExcel(file: File): Promise<{ headers: string[]; rows: Record<string, string>[] }> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array', cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const json = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, { defval: '', raw: false });
  if (json.length === 0) return { headers: [], rows: [] };
  const headers = Object.keys(json[0]);
  return { headers, rows: json };
}

// =========================================
// Build the preview from raw rows
// =========================================

export interface ExistingLeadIndex {
  phones: Set<string>;
  emails: Set<string>;
}

export function buildPreview(
  fileName: string,
  headers: string[],
  rows: Record<string, string>[],
  existing: ExistingLeadIndex
): ImportPreview {
  // 1. Auto-detect field mapping
  const fieldMap: FieldMap = {};
  const unmappedHeaders: string[] = [];
  for (const h of headers) {
    const f = detectField(h);
    if (f && !fieldMap[f]) fieldMap[f] = h;
    else if (!f) unmappedHeaders.push(h);
  }

  // 2. Parse rows
  const parsed: ParsedLead[] = rows.map((row, idx) => {
    const get = (canonical: string) => {
      const col = fieldMap[canonical];
      return col ? (row[col] || '').toString().trim() : '';
    };

    // Build full name
    let fullName = get('full_name');
    if (!fullName) {
      const first = get('first_name');
      const last = get('last_name');
      fullName = [first, last].filter(Boolean).join(' ').trim();
    }

    const phone = normalizePhone(get('phone'));
    const email = normalizeEmail(get('email'));
    const amount = parseAmount(get('amount_paid'));
    const stage = normalizeStage(get('stage'));
    const paymentStatus = normalizePaymentStatus(get('payment_status'), amount);
    const nextFollowUp = parseDate(get('next_follow_up'));

    const errors: string[] = [];
    const warnings: string[] = [];
    if (!fullName) errors.push('Missing name');
    if (!phone && !email) errors.push('Need at least phone or email');

    // Stale follow-up warning
    if (nextFollowUp && new Date(nextFollowUp).getTime() < Date.now()) {
      warnings.push('Follow-up date is in the past');
    }
    if (get('next_follow_up') && !nextFollowUp) {
      warnings.push('Could not parse follow-up date');
    }

    // Duplicate check
    let duplicate: 'phone' | 'email' | null = null;
    if (phone && existing.phones.has(phone)) duplicate = 'phone';
    else if (email && existing.emails.has(email)) duplicate = 'email';
    if (duplicate) warnings.push(`Duplicate ${duplicate} — will skip`);

    return {
      full_name: fullName,
      phone,
      email,
      visa_type: get('visa_type') || null,
      stage,
      last_note: get('last_note') || null,
      next_follow_up: nextFollowUp,
      payment_status: paymentStatus,
      amount_paid: amount,
      _row: idx + 2, // +2 because row 1 is header
      _errors: errors,
      _warnings: warnings,
      _duplicate: duplicate,
    };
  });

  const validCount = parsed.filter((r) => r._errors.length === 0 && !r._duplicate).length;
  const errorCount = parsed.filter((r) => r._errors.length > 0).length;
  const warningCount = parsed.filter((r) => r._warnings.length > 0 && r._errors.length === 0).length;
  const duplicateCount = parsed.filter((r) => r._duplicate).length;

  return {
    fileName,
    totalRows: rows.length,
    fieldMap,
    unmappedHeaders,
    rows: parsed,
    validCount,
    errorCount,
    warningCount,
    duplicateCount,
  };
}
