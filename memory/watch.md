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

**Found by the orchestrator's own Chrome walk of the real stack, 2026-11-25 — owed**
- **"Ask about this app" fails with a real model**: it answered `column "id" does not exist (422)`,
  and showed that raw database error in normal mode. Only ever tested with a faked model.
- **An employee's track record and recent work are empty after real builds** ("No work judged yet",
  "has not taken on any tasks yet") although the engineer built the whole app: factory work is not
  attributed to tasks the track record reads.
- Estimate accuracy on the credits page reads "Within 0%" when every estimate was far too high.
- The monthly cost shown for "sleeps when unused" (about 113 credits) and "always on" (about 184)
  is far from what the app actually cost (0.3 this month): the hosting rates are placeholders.
- A build run's page still shows "The verdict is ready — Read it".
- The export fails until Dock serves the data dump (the wiring lane).

**Seen working in that walk** — home with the real org chart, the verdict page on the agreed
schema, the run view in plain language and in technical mode, the app page with real history,
credits, people, AI-assistant keys, notifications, an employee's screen with real memory, autonomy,
both graph views; and an app built by the factory, opened at its own address, taking a book and
keeping it across a reload.

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

# In flight on 2026-11-25 (delete when landed)

- `main` has the five script lanes and sweep Y merged; README track tables are generated
  (`make academy-readme`). Pages publishes; CI's only expected failure is the Docker Hub login.
- Two lanes are unmerged in worktrees under `~/src/endgame-wt/`: `lane-sweep-x` (branch
  `build/sweep-x`: eleven small product defects) and `lane-visual` (`build/visual`: what four
  reviewers found in the 1,078 step pictures: captions covering their target, rings off screen,
  text highlights matching the wrong element, skeletons captured, one stand-in hosted app page).
- Still owed after they merge: one full gate run and `make site` plus `make academy-e2e` on
  `main`, the orchestrator's own Chrome walk of every flow, then the memory close-out.
