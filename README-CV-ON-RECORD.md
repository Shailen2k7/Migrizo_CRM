# CV on Record — one zip, everything

## What this fixes

1. THE UUID-NO-EXTENSION DOWNLOADS ("dd775f0e-…" that won't open): every
   download now carries a proper filename WITH an extension (from the
   customer's name, the file itself, or its type — in that order).
2. FILES NEVER DELETED (from the intake-v2 zip, included here) + the
   media-recovery hotfix (self-healing downloads for failed captures, honest
   message when truly gone) — all in this one zip.
3. "DOWNLOAD CV" BUTTON in the lead drawer, next to View profile. It ALWAYS
   gives you something:
   - the permanently archived original (new: every judged CV is copied into a
     per-lead archive that survives chat clears and the Delete-all-CVs purge),
   - or the newest CV still in their chat (and it archives it right then, so
     old leads self-heal the first time you click),
   - or a clean printable document rendered from the extracted profile text
     (for files the old pipeline deleted — the CONTENT was never lost; ⌘P
     saves it as a PDF),
   - or a plain-English "no CV yet" message. Never a bare "Not found".

## Deploy
1. Upload all files (same paths).
2. Run supabase/migrations/079_lead_cv_archive.sql in Supabase (twice; second
   run = notices only). Also run 078 first if you haven't yet.
3. Test: open any lead who sent a CV → "Download CV" → file opens with a real
   name. Send a fresh CV from a test lead → verdict → check the lead now has
   an archived copy.
