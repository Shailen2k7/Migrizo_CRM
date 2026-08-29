# Build fix — upload these two files

## What broke

Netlify runs `npm ci`, which refuses to install unless `package.json` and
`package-lock.json` agree exactly.

The WhatsApp removal took three packages out of `package.json` — `pdf-parse`,
`mammoth`, `word-extractor` (only the CV pipeline used them) — but the lock file
still listed them. `npm ci` stopped there and the deploy never reached the build.

My mistake: I edited `package.json` by hand and did not regenerate the lock file.
It didn't show up locally because `npm run build` uses the already-installed
`node_modules` and never consults the lock.

## The fix

Both files, regenerated and verified:

| File | Change |
|---|---|
| `package-lock.json` | Regenerated. 225 packages → 192. The three removed packages and their 33 dependencies are gone |
| `package.json` | Unchanged from the removal pack — included so the pair is guaranteed in sync |

Upload both to the repo root, overwriting. Netlify will redeploy.

## Verified before sending

- `npm ci` from a clean directory — exit 0, 163 packages installed
- `npm run build` on the result — exit 0, all routes built
- `npx tsc --noEmit` — clean

## If it still fails

Send me the actual log text, not the "Why did it fail?" panel — that panel had no
log content to read, which is why it gave generic advice. In Netlify: open the
failed deploy, click **Maximize log**, copy the last 40 lines, paste them here.

## Separate note, not urgent

The install printed a security advisory for `next@15.5.7`. Worth patching soon,
but it is a different job from this deploy and I would not bundle the two.
