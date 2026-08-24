// =============================================================================
// INVOICE PDF — GET /api/invoice/pdf?paymentId=<uuid>
//
// Returns the SAME document the client receives by email, wrapped in print CSS
// and set to open the browser's print dialog on load. The user chooses
// "Save as PDF" and gets a pixel-identical copy of the emailed invoice.
//
// WHY NOT A PDF LIBRARY
// A server-side renderer (puppeteer/chromium) would be a second rendering path
// for the same document — the emailed invoice and the downloaded one would
// drift apart the first time either is touched. Printing the real HTML keeps
// exactly one template, and Chrome/Safari/Edge all produce a clean A4 PDF from
// it. Netlify's function bundle stays small, too. The print rules live in
// lib/email/print.ts so they can be rendered and inspected in a test.
//
// It is a GET so the drawer can open it in a new tab synchronously (no popup
// blocker) and the session cookie rides along. Auth is enforced here and by
// RLS: you can only reach a payment in a workspace you belong to.
// =============================================================================

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { renderInvoice, invoiceNumber } from '@/lib/email/branded';
import { wrapForPrint, safeFileTitle } from '@/lib/email/print';
import type { Lead, Payment } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** A tiny, self-contained error page — never a raw stack trace to the browser. */
function problem(message: string, status: number): Response {
  return new NextResponse(
    `<!doctype html><meta charset="utf-8"><title>Invoice unavailable</title>
     <body style="margin:0;font:15px/1.6 -apple-system,Segoe UI,Arial,sans-serif;background:#F2F4F8;color:#1A1E27;">
       <div style="max-width:420px;margin:14vh auto;background:#fff;border-radius:14px;padding:28px 30px;box-shadow:0 1px 3px rgba(16,24,40,.1);">
         <div style="font-size:17px;font-weight:700;color:#16294E;">Invoice unavailable</div>
         <p style="color:#6B7280;margin:10px 0 0;">${message}</p>
         <p style="color:#9AA3B2;font-size:13px;margin:16px 0 0;">You can close this tab and try again from the lead drawer.</p>
       </div>
     </body>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );
}

export async function GET(req: Request) {
  const paymentId = new URL(req.url).searchParams.get('paymentId');
  if (!paymentId) return problem('No payment was specified.', 400);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return problem('Your session has expired. Sign in to the CRM and try again.', 401);

  const { data: payment, error: pe } = await supabase
    .from('payments').select('*').eq('id', paymentId).single();
  if (pe || !payment) return problem('This payment no longer exists, or you do not have access to it.', 404);

  const { data: lead, error: le } = await supabase
    .from('leads').select('*').eq('id', (payment as Payment).lead_id).single();
  if (le || !lead) return problem('The client for this payment could not be found.', 404);

  const invNo = invoiceNumber(payment as Payment);
  const { html } = renderInvoice(lead as Lead, payment as Payment, invNo);

  const isPaid = (payment as Payment).status === 'paid';
  const docWord = isPaid ? 'Receipt' : 'Invoice';
  // Chrome uses document.title as the default "Save as PDF" filename, so this
  // is what lands in the user's Downloads folder.
  const fileTitle = safeFileTitle(
    `Migrizo ${docWord} ${invNo} - ${(lead as Lead).full_name || 'Client'}`,
  );

  const doc = wrapForPrint(html, fileTitle);

  return new NextResponse(doc, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // A financial document must never be served from a shared cache.
      'Cache-Control': 'no-store, private',
    },
  });
}
