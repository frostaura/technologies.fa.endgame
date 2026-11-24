The library's lending limits are written in its policy documents, `docs/policies/policy-01.md` to `policy-14.md`: each document defines the limit for one membership tier, somewhere in its text.

Add `GET /api/limits`, returning a JSON object mapping each tier's name, in upper case exactly as the policy writes it, to the most books a member on that tier may hold at once — every tier defined in those documents, and no others.

Your context is deliberately small for this task: keep what you find in your notes as you go. Add an xUnit test for the endpoint. All tests must pass.
