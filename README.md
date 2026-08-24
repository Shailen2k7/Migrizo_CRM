# Invoices — UK bank details + PDF download

Two changes in one bundle. Upload all 5 files.

## 1. UK bank account on UNPAID invoices

Unpaid invoices now show two bank boxes side by side, with the UPI strip below:

- **UK (GBP)** — M4 Investment Ltd · Revolut Bank · A/C 94649332 · Sort Code 04-29-09
- **India (INR)** — Grownmind Educational Services Pvt Ltd · ICICI (unchanged)
- **UPI** — grownmind@icici (unchanged)

Whichever account matches the client's invoice currency is shown **first**, so a
GBP client sees the UK account on the left.

**Paid invoices are untouched.** The whole payment block only renders when the
payment is not paid — a receipt shows the green "Payment received" line and no
account numbers anywhere, in the HTML or the plain-text version.

## 2. Download as PDF from the lead drawer

Every payment row now has a green **download** button next to the send button
(Lead drawer → Payments). It opens the invoice in a new tab and brings up the
print dialog — choose **Save as PDF**.

What you get:

- **The same document the client is emailed.** No second template, so the PDF
  can never drift away from the email.
- **The same invoice number** as the email for that payment (MGZ-YYYYMM-XXXXXX).
- **One clean A4 page.** If a document runs slightly over, it is scaled to fit
  exactly one page (never below 76% — a genuinely long invoice paginates
  properly instead of becoming unreadable).
- **Nothing sliced in half.** The payment-details box and the navy footer move
  whole to the next page rather than being cut across a page break.
- **A sensible filename** — "Migrizo Invoice MGZ-202608-3F2A91 - Aarav Sharma".
- Paid payments download as a **Receipt** with no bank details, same as the email.

Access: the download is available to anyone who can already see the payment.
It is not gated on the "send client emails" permission, because saving a copy of
a document on your own screen is not the same as emailing the client. The route
still requires a signed-in CRM user and is scoped by RLS to your workspace.

## Files to upload

```
lib/email/branded.ts                 UK bank details + shared invoiceNumber()
lib/email/print.ts                   NEW — print/PDF rules
app/api/invoice/pdf/route.ts         NEW — the PDF endpoint
app/api/email/send/route.ts          now imports the shared invoiceNumber()
components/payments/payment-row.tsx  the download button
```

No SQL. No env vars. Nothing else in the CRM is affected.

## Verify after deploy

1. Lead drawer → Payments → hover a row → click the green download icon.
2. Print preview should show **1 page** with both bank boxes.
3. Mark the payment paid, download again → "Receipt", green banner, no bank
   details, still 1 page.

If the browser blocks the new tab, allow popups for the CRM — you'll get a
toast telling you so.
