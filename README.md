# GST on invoices

Add GST to any invoice or receipt, per payment, exactly like the SLA discount flow.

## Deploy — 2 steps

### 1. Supabase SQL Editor
Run `075_invoice_gst.sql`. It adds two columns to `payments`:
`gst_rate` (default 0) and `gst_mode` ('add' | 'inclusive').

Every existing payment stays at 0, so **no invoice already sent changes**.

### 2. Git — upload these 3 files at the same paths
```
lib/email/branded.ts                 GST maths + totals on the invoice
lib/types.ts                         Payment gains gst_rate / gst_mode
components/payments/payment-row.tsx  the GST bar
```

## How it works
Lead drawer → Payments → hover a row → click the **Send** icon.
A GST bar opens (same shape as the SLA discount bar):

- **GST %** — type any rate, e.g. 18
- **Add on top** / **Already included** — see below
- A live line shows: Taxable · GST · **Client pays**
- Then either **Save GST & download PDF** or **Send with 18% GST**

The rate is saved on the payment first, so the emailed invoice and the
downloaded PDF always show the same tax. Once set, the row displays
"GST 18% added · client pays ₹3,540" without opening anything.

## The two modes — this matters on a tax document
At 18% on ₹3,000:

| Mode | Taxable | GST | Client pays |
|---|---|---|---|
| Add on top | ₹3,000 | ₹540 | **₹3,540** |
| Already included | ₹2,542.37 | ₹457.63 | **₹3,000** |

Use **Add on top** when GST is charged in addition to your fee (most common).
Use **Already included** when the quoted amount is what the client pays and the
tax sits inside it.

On the document, GST always splits into CGST + SGST at half the rate each
(18% prints as CGST 9% + SGST 9%), matching the existing invoice layout.
Set the rate to 0 for clients where GST does not apply — the invoice then looks
exactly as it does today.

## Tested
- tsc clean · next build green
- 20 automated checks: add vs inclusive maths, rate clamping (negative → 0,
  >100 → 100), CGST/SGST halves, odd rates (5% → 2.50%), the rendered document
  totals, paid receipts still hiding bank details, plain-text version
