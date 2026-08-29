# Fix pack — CV downloads + WhatsApp search

Two confirmed defects. Both verified with `npm run type-check` and `npm run build` (green).
Nothing else in the system is touched.

## Order

1. **Supabase SQL editor** → paste and run `supabase/migrations/080_wa_search.sql`.
   Idempotent — safe to run twice.
2. **Upload the 5 code files** to GitHub, keeping the exact folder paths.
3. Netlify redeploys. Done.

Steps 1 and 2 are independent — if you deploy the code before running the SQL,
search still works on the loaded conversations and simply falls back; it does not error.

---

## 1. The empty CV download — fixed at the root

The file you sent me was **0 bytes**. Every earlier fix chased the *filename*.
The problem was the *body*.

`new NextResponse(blob)` — Supabase hands back a stream-backed Blob, and Netlify's
Next adapter did not always drain that stream before closing the response. The
browser was told "here is your CV" and given nothing.

**Now:** every file is read fully into a Buffer, with an explicit `Content-Length`,
before it leaves the server (`lib/whatsapp/serve-bytes.ts`). A file arrives whole or
we say plainly that we could not read it. There is no third outcome.

Three more things came with it:

- **A 0-byte object no longer gets served.** If what we stored is empty, we re-pull
  the bytes from the sender's WhatsApp link, overwrite the object, and serve the
  real file. The record heals itself on the first click.
- **The extension is read from the actual bytes**, not guessed from the mime string.
  A PDF whose sender gave it no filename now saves as `.pdf`, not `.vndopenx`.
  Your rule is kept: if the customer named the file, that name is used untouched.
- **Non-English filenames survive** (Hindi, accents) via `filename*=UTF-8''…`.

Applies to both buttons — the paperclip in the chat and **Open CV** in the lead drawer.

## 2. WhatsApp search — fixed and made server-side

Two bugs in one line.

The search filtered a JavaScript array that only ever holds the **300 most-recently-active
conversations**. Anyone older was invisible — which is why searching a real customer
returned nothing. And for any text query the phone check ran `phone.includes('')`,
which is true for every row, so that clause matched everything and hid the real logic.

**Now:** local matches appear instantly as you type, and 220ms later Postgres searches
**every conversation you have**, on:

- lead name (case-insensitive)
- lead email
- phone — digits only on both sides, so `9999311087`, `99993 11087` and
  `+91 9999311087` all find `+919999311087`
- the last message text, so "booking link" finds the thread

Plus a clear (✕) button, a spinner while it searches, and an honest empty state that
says what was searched instead of showing a blank list.

Trigram indexes are created so this stays fast as the inbox grows.

---

## Test in 60 seconds

1. Open any chat where a customer sent a CV → click the file → **it opens.**
2. Open that lead's drawer → **Open CV** → same file, right name, right extension.
3. WhatsApp search → type a customer's **name** → they appear, even if the chat is months old.
4. Type the **last 5 digits** of a number → that chat appears.
5. Clear with ✕ → full list returns.

## Not in this pack

Still to come, in order: the two-column lead drawer + Visa route button + redesigned
Profile-received block (waiting on your approval of the mockup), template sync with
Interakt, and chat tags.
