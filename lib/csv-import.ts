import Papa from 'papaparse';
import type { LeadStage, PaymentStatus } from '@/lib/types';

export interface ImportRow {
  full_name: string;
  phone: string | null;
  email: string | null;
  visa_type: string | null;
  stage: LeadStage;
  next_follow_up: string | null;
  payment_status: PaymentStatus;
  amount_paid: number;
  last_note: string | null;
  _errors: string[];
  _duplicate: boolean;
  _rawRow: number;
  _row: number;
  _warnings: string[];
}

export interface ImportPreview {
  fileName: string;
  headers: string[];
  rows: ImportRow[];
  totalRows: number;
  validCount: number;
  errorCount: number;
  duplicateCount: number;
  fieldMap: Record<string, string>;
  unmappedHeaders: string[];
}

function canon(s: string) { return s.trim().toLowerCase().replace(/[\s_-]+/g, ''); }

const COL_MAP: Record<string, string> = {
  fullname: 'full_name', name: 'full_name', clientname: 'full_name', leadname: 'full_name',
  firstname: 'first_name', lastname: 'last_name',
  phone: 'phone', mobile: 'phone', contact: 'phone', phonenumber: 'phone', whatsapp: 'phone', mobilenumber: 'phone',
  email: 'email', emailaddress: 'email',
  visa: 'visa_type', visatype: 'visa_type', service: 'visa_type', interest: 'visa_type', interestedin: 'visa_type',
  stage: 'stage', status: 'stage', leadstatus: 'stage', dealstage: 'stage', tag: 'stage',
  note: 'last_note', notes: 'last_note', comment: 'last_note', remarks: 'last_note', lastnote: 'last_note', description: 'last_note',
  nextfollowup: 'next_follow_up', followup: 'next_follow_up', followupdate: 'next_follow_up', nextaction: 'next_follow_up',
  paymentstatus: 'payment_status', payment: 'payment_status',
  amountpaid: 'amount_paid', amount: 'amount_paid', paid: 'amount_paid',
};

function mapStage(raw: string | undefined): LeadStage {
  if (!raw) return 'cold';
  const s = raw.toLowerCase();
  if (/^won$|closed.?won|completed|success/.test(s)) return 'won';
  if (/junk|lost|dropped|rejected|disqualified|spam|closed.?lost/.test(s)) return 'junk';
  if (/invoice|proposal|quote|partial.?pay|negotiat|sent/.test(s)) return 'invoice_sent';
  if (/coming.?soon|consult|qualif|warm|interested/.test(s)) return 'mr_coming_soon';
  if (/^hot$|engaged|connect|responsive/.test(s)) return 'hot';
  if (/^cold$|attempt|^new$|inquiry|unresponsive|noreply/.test(s)) return 'cold';
  return 'cold';
}

function mapPaymentStatus(raw: string | undefined): PaymentStatus {
  if (!raw) return 'none';
  const s = raw.toLowerCase();
  if (/paid|complete/.test(s)) return 'paid';
  if (/partial/.test(s)) return 'partial';
  if (/overdue/.test(s)) return 'overdue';
  return 'none';
}

export async function readFile(file: File): Promise<{ headers: string[]; rows: Record<string, string>[] }> {
  const text = await file.text();
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });
  const headers = result.meta.fields || [];
  return { headers, rows: result.data };
}

export function buildPreview(
  fileName: string,
  headers: string[],
  rows: Record<string, string>[],
  existing: { phones: Set<string>; emails: Set<string> },
): ImportPreview {
  const fieldMap: Record<string, string> = {};
  headers.forEach((h) => {
    const target = COL_MAP[canon(h)];
    if (target) fieldMap[h] = target;
  });

  const seenPhones = new Set<string>();
  const seenEmails = new Set<string>();

  const importRows: ImportRow[] = rows.map((raw, idx) => {
    const r: Record<string, string> = {};
    Object.entries(raw).forEach(([k, v]) => {
      const target = fieldMap[k];
      if (target) r[target] = (v || '').toString().trim();
    });

    if (!r.full_name && (r.first_name || r.last_name)) {
      r.full_name = `${r.first_name || ''} ${r.last_name || ''}`.trim();
    }

    const errors: string[] = [];
    if (!r.full_name) errors.push('Name missing');

    const phone = r.phone || null;
    const email = r.email || null;
    let duplicate = false;
    if (phone) {
      if (existing.phones.has(phone) || seenPhones.has(phone)) duplicate = true;
      seenPhones.add(phone);
    }
    if (email && !duplicate) {
      if (existing.emails.has(email) || seenEmails.has(email)) duplicate = true;
      seenEmails.add(email);
    }

    let nextFollowUp: string | null = null;
    if (r.next_follow_up) {
      const d = new Date(r.next_follow_up);
      if (!isNaN(d.getTime())) nextFollowUp = d.toISOString();
    }

    const amountPaid = r.amount_paid ? Number(r.amount_paid.replace(/[^\d.-]/g, '')) || 0 : 0;

    return {
      full_name: r.full_name || '',
      phone,
      email,
      visa_type: r.visa_type || null,
      stage: mapStage(r.stage),
      next_follow_up: nextFollowUp,
      payment_status: mapPaymentStatus(r.payment_status),
      amount_paid: amountPaid,
      last_note: r.last_note || null,
      _errors: errors,
      _duplicate: duplicate,
      _rawRow: idx + 2,
      _row: idx + 2,
      _warnings: [],
    };
  });

  return {
    fileName,
    headers,
    rows: importRows,
    totalRows: importRows.length,
    validCount: importRows.filter((r) => r._errors.length === 0 && !r._duplicate).length,
    errorCount: importRows.filter((r) => r._errors.length > 0).length,
    duplicateCount: importRows.filter((r) => r._duplicate).length,
    fieldMap,
    unmappedHeaders: headers.filter((h) => !fieldMap[h]),
  };
}
