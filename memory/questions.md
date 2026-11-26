---
name: technologies-fa-endgame-questions
description: "Founder-owned: the Portainer stack and secrets for the first deploy; when the public, unlicensed repository goes private; who sends email; the first three invited organisations; margin and hosting rates; the operators list."
type: question
last_verified: 2026-11-26
---

# Open questions — founder-owned

1. **The first deployment.** CI publishes the images to Docker Hub (secrets added 2026-11-26). The
   redeploy job stays off until the Portainer stack and its four secrets do. The steps, every
   setting and where each value comes from are in `docs/architecture/ARCH-008-deploying-on-portainer.md`.
2. **Who is an operator?** God mode comes only from the `ENDGAME_OPERATORS` list. On the local
   stack the development account is not on it, so God mode was only ever walked in the demo.
3. **When does the repository go private, and is it ever open source?** It is public for free CI
   and unlicensed. The house default is open source; this one departs from it until decided.
4. **Who sends email?** Apps need transactional mail. That is a third external service unless
   Cloudflare's own email sending proves usable (unverified) or the existing FrostAura mail server
   is used. Mail has only ever reached the local catcher.
5. **The credit margin and the hosting rates.** The margin is 1.0 (none) and the hosting rates
   and the 500-credit monthly model cap per app are placeholders (assumptions log, entry 15).
6. **The first three invited organisations.** The spec fixes the profile — people the founder
   knows who each run two or more live web products — and that none is invited before FrostAura
   and the Crusaders rebuild run on Endgame. The names are his.
7. **Is the operator handbook right to be public?** It is published on the same Pages site as the
   client academy (assumptions log, entry 33). It holds no secret, address or credential.
8. **Is the red-lines reading of God mode right?** An agent passed it on conditions
   ([decisions](decisions.md)); he answered "You assume correct" on 2026-11-24. Listed until he
   has read the conditions themselves.
