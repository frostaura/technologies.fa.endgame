The security review found nothing in the app's code that blocks publishing, but the app's own documents say less than
the code does. Correct only the documents each finding names (docs/app.md, docs/data.md, README.md and the like) so they
say what the code does: for an endpoint with .RequireUser(), "Signed in?" is Yes. Change no code, tests or configuration;
the code was reviewed and stands. Verify with make test, commit, and reply with what you changed. This is not charged.

The findings, word for word:
{{findings}}
