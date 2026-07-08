// =============================================================================
// EMAIL SEND ENDPOINT — onboarding / SLA / invoice
// -----------------------------------------------------------------------------
// POST { type: 'onboarding' | 'sla' | 'invoice', leadId, paymentId?, force? }
//
// * Requires a signed-in CRM user; RLS scopes which leads they can reach.
// * Onboarding has a server-side "sent once" guard (activity log) so the auto
//   trigger can never double-send. Pass force=true to deliberately resend.
// * Every send is logged to the lead's activity feed.
// =============================================================================

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { renderOnboarding, renderSLA, renderInvoice } from '@/lib/email/branded';
import type { Lead, Payment } from '@/lib/types';

export const runtime = 'nodejs';

type EmailType = 'onboarding' | 'sla' | 'invoice';
const VALID: EmailType[] = ['onboarding', 'sla', 'invoice'];

// Deterministic invoice number from the payment row: MGZ-YYYYMM-XXXXXX
function invoiceNumber(payment: { id: string; created_at: string | null }): string {
  const d = new Date(payment.created_at || Date.now());
  const ym = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
  return `MGZ-${ym}-${payment.id.replace(/-/g, '').slice(0, 6).toUpperCase()}`;
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });

  let body: { type?: string; leadId?: string; paymentId?: string; force?: boolean; discount?: number };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, reason: 'bad_request' }, { status: 400 }); }
  const type = body.type as EmailType;
  const leadId = body.leadId;
  if (!leadId || !VALID.includes(type)) {
    return NextResponse.json({ ok: false, reason: 'bad_request' }, { status: 400 });
  }

  // Load the lead (RLS restricts to the user's workspace).
  const { data: lead, error } = await supabase.from('leads').select('*').eq('id', leadId).single();
  if (error || !lead) return NextResponse.json({ ok: false, reason: 'not_found' }, { status: 404 });

  // PERMISSION: client emails are admin/owner-only unless the workspace has
  // explicitly enabled them for members (Settings → Permissions).
  const { data: membership } = await supabase
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', lead.workspace_id)
    .eq('user_id', user.id)
    .single();
  if (!membership) return NextResponse.json({ ok: false, reason: 'forbidden' }, { status: 403 });
  if (membership.role !== 'admin') {
    const { data: ws } = await supabase
      .from('workspaces')
      .select('allow_member_email')
      .eq('id', lead.workspace_id)
      .single();
    if (!ws || !(ws as { allow_member_email?: boolean }).allow_member_email) {
      return NextResponse.json({ ok: false, reason: 'forbidden' }, { status: 403 });
    }
  }
  if (!lead.email) return NextResponse.json({ ok: false, reason: 'no_email' });

  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.NOTIFY_FROM; // e.g. "Migrizo <updates@migrizo.com>"
  if (!apiKey || !from) return NextResponse.json({ ok: false, reason: 'not_configured' });

  // Invoice/receipt guard: don't auto-resend the same payment's receipt.
  if (type === 'invoice' && body.paymentId && !body.force) {
    const { data: prior } = await supabase
      .from('activity')
      .select('id')
      .eq('lead_id', leadId)
      .eq('action', 'email_sent')
      .contains('meta', { email_type: 'invoice', payment_id: body.paymentId })
      .limit(1);
    if (prior && prior.length > 0) {
      return NextResponse.json({ ok: true, already_sent: true });
    }
  }

  // Onboarding guard: only ever auto-send once per lead.
  if (type === 'onboarding' && !body.force) {
    const { data: prior } = await supabase
      .from('activity')
      .select('id')
      .eq('lead_id', leadId)
      .eq('action', 'email_sent')
      .contains('meta', { email_type: 'onboarding' })
      .limit(1);
    if (prior && prior.length > 0) {
      return NextResponse.json({ ok: true, already_sent: true });
    }
  }

  // Render the requested template.
  let email: { subject: string; html: string; text: string };
  let meta: Record<string, unknown> = { email_type: type };

  if (type === 'invoice') {
    if (!body.paymentId) return NextResponse.json({ ok: false, reason: 'bad_request' }, { status: 400 });
    const { data: payment, error: pe } = await supabase
      .from('payments').select('*').eq('id', body.paymentId).single();
    if (pe || !payment || payment.lead_id !== leadId) {
      return NextResponse.json({ ok: false, reason: 'payment_not_found' }, { status: 404 });
    }
    const invNo = invoiceNumber(payment as Payment);
    email = renderInvoice(lead as Lead, payment as Payment, invNo);
    meta = { ...meta, payment_id: body.paymentId, invoice_no: invNo, milestone: (payment as Payment).milestone };
  } else if (type === 'sla') {
    const discount = typeof body.discount === 'number' && body.discount > 0 ? Math.min(body.discount, 3000) : 0;
    email = renderSLA(lead as Lead, discount);
    if (discount) meta = { ...meta, discount };
  } else {
    const { data: ws } = await supabase
      .from('workspaces')
      .select('case_manager_name, case_manager_phone')
      .eq('id', lead.workspace_id)
      .single();
    const cm = ws && (ws as { case_manager_name?: string }).case_manager_name
      ? { name: (ws as { case_manager_name: string }).case_manager_name, phone: (ws as { case_manager_phone?: string }).case_manager_phone || '' }
      : undefined;
    email = renderOnboarding(lead as Lead, cm);
  }

  // Send via the Resend REST API (same pattern as notify-client).
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [lead.email], subject: email.subject, html: email.html, text: email.text }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return NextResponse.json({ ok: false, reason: 'send_failed', detail }, { status: 502 });
    }
  } catch {
    return NextResponse.json({ ok: false, reason: 'send_failed' }, { status: 502 });
  }

  // Log to the lead's activity feed (best-effort, never blocks the response).
  try {
    await supabase.from('activity').insert({
      workspace_id: lead.workspace_id,
      user_id: user.id,
      lead_id: leadId,
      action: 'email_sent',
      meta,
    });
  } catch { /* noop */ }

  return NextResponse.json({ ok: true });
}
