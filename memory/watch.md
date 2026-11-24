---
name: technologies-fa-endgame-watch
description: "First real run: research works live, but the verdict page crashed blank and no end-to-end build has finished. Margin and hosting rates are placeholders. Passkeys, HTTPS, real mail and later CI jobs are unverified."
type: watch
last_verified: 2026-11-25
---

# Known debts

Found by merging the build lanes and by the first real run through the console on 2026-11-25. The
first lanes' debts (operator rights, margin, service addresses, contract docs, missing console
screens) were paid by later lanes; what is listed here is still owed.

**Found by the first real research run (being fixed in the factory and second console lanes)**
- **The verdict page crashed to a blank screen**: the Runner wrote the verdict in one shape, the
  console expected another, and nothing validated it. No route had an error boundary.
- Normal mode showed raw contractor output labelled "Update", repeated the verdict three times,
  and counted "0 actions taken".
- Research strands were capped at two web searches each and reported low confidence.
- **No real end-to-end factory build has finished.** The research half is proven; the build half is not.

**Founder's numbers still owed**
- The credit margin is 1.0 (none); the hosting rates and the 500-credit monthly model cap per app
  are placeholders (assumptions log, entry 15).

**Not verified anywhere yet**
- Passkey ceremonies in a real browser — every walk used the development sign-in.
- Shared apps with invitation codes, end to end.
- HTTPS, the Cloudflare tunnel, and anything applied to a real Cloudflare account.
- A real SMTP server. Mail only ever reached the local catcher.
- CI for the jobs added after the scaffold: they are written and syntax-checked, not run to green.
- More than a handful of apps on the real stack, and waking after the host restarts.
- One Runner test (`A_graceful_shutdown_…`) failed once in a full run: a timing race.
