The security review found problems that block publishing. This is security repair {{round}} of {{rounds}}, not
charged. Fix each finding below in the code, verify with make lint and make test, and commit.

Then bring the app's own documents in line with every endpoint you changed, in the same commit: its row in docs/app.md,
where "Signed in?" says Yes for an endpoint with .RequireUser() and No for one without; docs/data.md where it says who may
read or write; and the endpoint's WithDescription, which the platform publishes as the app's API description. A document
that says less than the code does is reported again at the next review. Where the app's tests include AppRulesTests,
make test checks docs/app.md against the code.

The findings, word for word:
{{findings}}{{earlier}}

The plan, for context:
{{plan}}
