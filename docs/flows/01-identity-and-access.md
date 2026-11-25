# Identity and access — every flow

Signing in, people and roles, AI-assistant keys and MCP, opening apps as a member or end user, the shell.

Read from the code on 2026-11-25, one reader per area; nothing here was taken from the other docs. The fields and how to read them are in [README.md](README.md). A flow marked *API only* or *MCP only* has no screen.

Every entry carries the four academy fields you added: Level, Learn first, What you learn, and You know it worked when. On-screen labels are quoted word for word. `{App}` and `{Org}` stand for real names.

**The most serious finding:** a person invited to an organisation cannot register through the console. The sign-in screen has no field for an invitation code, yet the invitation e-mail and the People screen both tell them to use one. The control plane accepts the code (`SignInTests` proves it); only the screen is missing. This also blocks the Owner of an organisation that an operator provisions. Details are in ID-07, PPL-08 and the list at the end.

---

## Identity

### ID-01 Create the first passkey on a fresh install
- **Who:** the very first person (becomes the first Owner)
- **Starts at:** console, any address (moved to `/sign-in`)
- **Needs:** a fresh install: no organisation and no person registered at all. A browser that supports passkeys, on https or localhost.
- **Level:** Foundation
- **Learn first:** none
- **What you learn:** Endgame has no passwords. Your device keeps the key, and only the first person may register without an invitation.
- **Steps:**
  1. The person opens the console. It finds no session and shows **"Sign in"**, with the lead "Use the passkey on this device. There is no password to remember or to lose."
  2. They click **"First time here? Create your passkey"**. The heading becomes **"Create your passkey"**, with the lead "Your device keeps the key; Endgame never sees a password, because there is none."
  3. They fill in **"Your name"** and **"Email address"** (both required) and click **"Create passkey"**. While it works the button reads **"Waiting for your device…"**.
  4. The server checks that this is a fresh install and sends passkey options. It keeps the registration's purpose in a sealed cookie that lasts five minutes.
  5. The device asks the person to approve. On approval the server checks the attestation and creates the first user, under a lock so two people cannot both become first. It stores the passkey and opens a session that lasts 14 days and renews with use.
  6. The console reloads who is signed in. Because no organisation exists yet, it shows **"Name your organisation, then describe your first idea."** That screen belongs to the organisation-tree reader.
- **You know it worked when:** the sign-in screen is replaced by the console header (Endgame mark, **"Normal"**/**"Technical"** toggle, **"Sign out"**) and the first-run heading above.
- **Variations and refusals:**
  - Browser without passkeys: "This browser cannot use passkeys. Open Endgame in a current browser on a device with a screen lock." The buttons are disabled.
  - Prompt closed or timed out: "The passkey prompt was closed or timed out. Nothing was changed."
  - The device already holds a key: "This device already holds a passkey for Endgame. Sign in with it instead."
  - Not https or localhost: "Passkeys need a secure address (https or localhost)."
  - No credential returned: "No passkey was created."
  - Bad e-mail (server): "Give a valid e-mail address."
  - Name too long (server): "A display name is at most {n} characters."
  - Someone else won the race: 409, "Someone has already registered first; ask them for an invitation."
  - Attestation rejected: 400, "The passkey was not accepted".
  - Passkey created for a different registration: 403, "The passkey was not created for this registration."
  - No registration under way, or it expired after five minutes: "No passkey registration is under way; ask for registration options first." or "The registration state is not valid; start again."
  - **"I already have one"** goes back to the sign-in view.
- **Where:** `features/auth/SignInView.tsx`, `features/auth/webauthn.ts`. `POST /api/auth/passkey/register/options`, `POST /api/auth/passkey/register/complete`, `GET /api/me`. `AccountService.CreateFirstUserAsync`.
- **Reachable from:** UI
- **Covered by tests:** `SignInTests.The_first_person_registers_a_passkey_names_the_organisation_signs_out_and_signs_back_in`; `tests-e2e/console.spec.ts` "a passkey is created and signs the owner in"; `App.test.tsx` "passkey encoding".

### ID-02 Sign in to the console with a passkey
- **Who:** owner / admin / builder / viewer / operator who already has a passkey
- **Starts at:** `/sign-in`, which every signed-out address is moved to
- **Needs:** a registered passkey on this device, or on a phone or security key it can reach
- **Level:** Foundation
- **Learn first:** ID-01 (or PPL-08)
- **What you learn:** signing in is one approval on your device, and the session lasts 14 days while you keep using it.
- **Steps:**
  1. The person clicks **"Sign in with a passkey"**. The button reads **"Waiting for your device…"**.
  2. The console asks the server for options without an e-mail, so the device offers any Endgame passkey. The server deliberately answers an unknown e-mail exactly as it answers none, so accounts cannot be probed.
  3. The person chooses a key and approves. The server verifies the assertion, records the passkey's use and signs them in.
  4. The console opens the address the person first asked for (a signed-out visit to `/credits` lands on `/credits`), or `/` when they came to `/sign-in` directly. It shows the organisation they chose last on this device (ID-10's switcher), or the first one they belong to.
- **You know it worked when:** the screen first asked for, or the org chart, appears with **"Sign out"** in the header.
- **Variations and refusals:**
  - Unknown or unverifiable passkey: 401, "That passkey could not be verified." Credential made for another origin: rejected.
  - Prompt closed: "The passkey prompt was closed or timed out. Nothing was changed."
  - No key chosen: "No passkey was chosen."
  - Unsupported browser: the same alert as in ID-01.
  - Only a console address is kept: never another site, never `/sign-in` itself; it is used once.
  - Someone with roles in two organisations switches between them on "Your account" (ID-09).
- **Where:** `SignInView.tsx`, `features/auth/returnTo.ts`. `POST /api/auth/passkey/login/options`, `POST /api/auth/passkey/login/complete`. `App.tsx` redirect logic.
- **Reachable from:** UI
- **Covered by tests:** `SignInTests` (`A_passkey_answered_for_another_origin_is_rejected`, `An_unknown_passkey_cannot_sign_in`, the first-person test); `AccountView.test.tsx` ("landing where you were going…"); `tests-e2e/console.spec.ts`; `tests-e2e/manage.spec.ts` ("after signing in, you land on the address you first asked for").

### ID-03 Use the development sign-in
- **Who:** developer or tester
- **Starts at:** `/sign-in`
- **Needs:** control plane running in Development **and** `ENDGAME_DEV_LOGIN=true`
- **Level:** Developer
- **Learn first:** ID-02
- **What you learn:** a deployment can offer a passkey-free sign-in for tests, and it exists only when both switches are on.
- **Steps:**
  1. The sign-in screen asks which sign-in methods the deployment offers. While waiting it shows a skeleton with the screen-reader text "Checking how this deployment signs people in".
  2. If development sign-in is offered, a dashed box appears: **"Development only"**, "This deployment is in development and offers a sign-in without a passkey.", and the button **"Development sign-in"**.
  3. The person clicks it. The button reads **"Signing in…"**. The console sends an empty body, so the server signs in the account named by `ENDGAME_DEV_USER_EMAIL` (default `dev@frostaura.net`).
  4. On a fresh install that account becomes the first user. Otherwise an existing account is found, or a new account with no role is created. The session ends when the browser closes.
  5. The console moves to `/`.
- **You know it worked when:** the org chart (or the first-run screen) appears with **"Sign out"** in the header.
- **Variations and refusals:**
  - Not enabled: the box is absent and the route does not exist (404). It is also absent from the OpenAPI document.
  - Options request fails: "Could not check this deployment's sign-in options: {reason}".
  - The console cannot sign in as a different e-mail. Only the API, and Edge's sign-in page (ACC-13), take an e-mail.
  - An unknown e-mail on an install that already has users creates a person with no role. Not verified on screen: they probably see the first-run screen, whose naming step the server then refuses.
- **Where:** `SignInView.tsx` (`DevelopmentSignIn`). `GET /api/auth/options`, `POST /api/auth/development`.
- **Reachable from:** UI (API with an e-mail)
- **Covered by tests:** `DevelopmentSignInTests` (both tests); `App.test.tsx` "offers the development sign-in only when the API advertises it…" and "…no development sign-in unless advertised"; `console.spec.ts` "development sign-in is offered only when advertised…"; `tests-stack/acceptance.spec.ts` "1. the development sign-in, through the console".

### ID-04 Arrive signed out at any console address
- **Who:** anonymous visitor
- **Starts at:** any console address, for example `/apps/{id}` or `/people?scope=…`
- **Needs:** nothing
- **Level:** Foundation
- **Learn first:** none
- **What you learn:** signed out, the console is only its sign-in screen, never a broken page.
- **Steps:**
  1. While the session is checked, the console shows the **"Opening Endgame"** skeleton.
  2. The server answers 401. The console replaces the address with `/sign-in` and shows the sign-in screen.
  3. Once signed in, a visitor at `/sign-in` is moved to `/`.
- **You know it worked when:** the address bar reads `/sign-in` and the **"Sign in"** heading shows.
- **Variations and refusals:**
  - The address originally asked for is not remembered for after sign-in.
  - Signed in, `/sign-in` itself shows the home screen.
  - The side panel **"One place to run every product you own"**, with its four points, shows only on wide screens.
- **Where:** `App.tsx`, `lib/router.ts`. `GET /api/me`.
- **Reachable from:** UI
- **Covered by tests:** `App.test.tsx` "shows the opening skeleton…" and "sends a signed-out visitor to sign-in…"; `SignInTests.Signed_out_me_is_401_problem_and_auth_options_are_readable`.

### ID-05 Recover from a failed session check
- **Who:** anyone
- **Starts at:** any console address
- **Needs:** the session check fails for a reason other than 401 (network failure, 5xx)
- **Level:** Foundation
- **Learn first:** ID-04
- **What you learn:** "could not check" is different from "signed out", and the console says which one happened.
- **Steps:**
  1. The console shows the Endgame mark and **"Endgame could not check who you are"**, with the reason.
  2. The person clicks **"Try again"** and the session is checked again.
- **You know it worked when:** the normal console, or the sign-in screen, replaces the failure.
- **Variations and refusals:** none found.
- **Where:** `App.tsx`. `GET /api/me`.
- **Reachable from:** UI
- **Covered by tests:** `App.test.tsx` "records a failed session check, which is not the same as signed out".

### ID-06 Sign out of the console
- **Who:** any signed-in person
- **Starts at:** **"Sign out"** in the header of every console screen
- **Needs:** signed in
- **Level:** Foundation
- **Learn first:** ID-02
- **What you learn:** signing out of the console also ends every app session this browser holds.
- **Steps:**
  1. The person clicks **"Sign out"**. The button is disabled while the request runs.
  2. The server ends the console session, then ends and clears every app session cookie the browser sent.
  3. The session check now answers 401, so the console moves to `/sign-in` and shows the sign-in screen.
- **You know it worked when:** the **"Sign in"** screen appears at `/sign-in` and stays after a reload.
- **Variations and refusals:** there is no confirmation step.
- **Where:** `features/shell/AppShell.tsx` (`SignOut`). `POST /api/auth/logout`, `AppIdentityService.SignOutEverywhereAsync`.
- **Reachable from:** UI
- **Covered by tests:** `App.test.tsx` "signs out to the sign-in screen and stays there"; `SignInTests` first-person test (signs out and back in).

### ID-07 Try to register without an invitation, or with one through the console
- **Who:** stranger; invited person
- **Starts at:** `/sign-in`, then **"First time here? Create your passkey"**
- **Needs:** an install that already has a person
- **Level:** Foundation
- **Learn first:** ID-01
- **What you learn:** Endgame is invite-only.
- **Steps:**
  1. The person fills in **"Your name"** and **"Email address"** and clicks **"Create passkey"**.
  2. The console sends only the name and e-mail. The server refuses with 403 and the console shows: "Endgame is invite-only. Sign in, or register with the invitation code you were sent."
- **You know it worked when:** that refusal appears in the alert box and nothing is created.
- **Variations and refusals:** **this is where invited people are stranded.** The form has no invitation-code field, so a person holding a valid code gets the same refusal. See PPL-08.
- **Where:** `SignInView.tsx`, `store/api.ts` (`passkeyRegisterOptions`, whose arguments are `{ displayName, email }` only). `POST /api/auth/passkey/register/options`.
- **Reachable from:** UI (refusal only)
- **Covered by tests:** `SignInTests.After_the_first_person_registration_needs_an_invitation…` (API only). No console test.

### ID-08 Add another passkey to your own account
- **Who:** any signed-in person
- **Starts at:** "Your account" (`/account`), **"Add another passkey"**
- **Needs:** signed in; a browser that can make passkeys
- **Level:** Core
- **Learn first:** ID-02
- **What you learn:** one account can hold several passkeys, so losing one device never locks you out.
- **Steps:**
  1. "Your passkeys" reads "<n> passkeys can sign you in. Add one on each device you use, so losing one never locks you out."
  2. Press **"Add another passkey"**; it reads "Waiting for your device…". Approve on the device.
  3. "The new passkey is saved. Either one signs you in now." The count goes up.
- **You know it worked when:** the count is one higher and the saved message shows.
- **Variations and refusals:**
  - The device declines or times out: "No passkey was added: <reason>".
  - A browser without passkeys: "This browser cannot make passkeys. Open Endgame in a current browser on a device with a screen lock." and the button is disabled.
  - The same attestation refusals as ID-01. Signed in, the server adds the key to the caller's own account whatever body is sent.
- **Where:** `features/account/AccountView.tsx`; `AuthEndpoints.cs` (the "add" kind).
- **Reachable from:** UI; API.
- **Covered by tests:** `AccountView.test.tsx` ("adds another passkey with this device…"); `tests-e2e/manage.spec.ts` ("shows your passkeys…").

### ID-09 See who you are and every role you hold, and switch organisation
- **Who:** any signed-in person
- **Starts at:** "Your account" (`/account`). Also `GET /api/me`.
- **Needs:** signed in
- **Level:** Foundation
- **Learn first:** ID-02
- **What you learn:** your roles are grants at places in the tree, possibly in more than one organisation, and the console works in one of them at a time.
- **Steps:**
  1. The page shows your name, e-mail and, for an operator, "FrostAura operator".
  2. "Your roles" lists each organisation, with "Working in it now" on the active one, and each grant: "<Role> of the whole organisation" or "<Role> of a division, <path>", with what that role may do. An Admin or Owner sees "People in <Org>".
  3. In more than one organisation: "You belong to <n> organisations. The console shows one at a time." and **"Working in"**. Choosing another opens its org chart; every screen then reads that organisation. The choice is kept on this device.
- **You know it worked when:** "Working in it now" moves to the organisation chosen.
- **Variations and refusals:** no role yet: "You hold no role in any organisation yet. Whoever invited you grants one." (an operator: "As an operator you enter organisations from Every organisation."). Failed read: "Your account could not be loaded". An operator inside an organisation in God mode has no switcher; the entered organisation applies.
- **Where:** `features/account/AccountView.tsx`, `OrganisationSwitcher.tsx`; `lib/useActiveOrganisation.ts`; `AuthEndpoints.MeAsync`.
- **Reachable from:** UI; API. The header carries the same switcher once the shell mounts it.
- **Covered by tests:** `AccountView.test.tsx`; `tests-e2e/manage.spec.ts`; `SignInTests`.

### ID-10 Read the operator access log
- **Who:** owner
- **Starts at:** home screen, with the organisation selected: the **"Operator access"** link (shown only when your role at the selection is Owner). Or `/operator-access` directly.
- **Needs:** the Owner role. The organisation has been named.
- **Level:** Core
- **Learn first:** ID-02; SHL-05 (what God mode is)
- **What you learn:** every time FrostAura enters or acts on your organisation it is logged, and only you can read that log.
- **Steps:**
  1. The page shows the heading **"Operator access"** and the line "Every time someone from FrostAura entered {Org} or acted on it, newest first. It is never silent, and only the Owner can read it."
  2. While it loads: "Loading the operator log", with three skeleton cards.
  3. The newest 500 entries appear. Each card has a plain-words title, the date and time, and the operator's name and e-mail (or "A FrostAura operator").
  4. In technical mode each card also shows the raw action and its JSON detail.
- **You know it worked when:** the list labelled "Operator log" shows entries, or the empty state.
- **Variations and refusals:**
  - The plain-words titles are "Entered the organisation", "Set up the organisation" and "Added {credits}" (or "Added credits"). Every other action, including an overdraft change and a top-up request closed by an operator, shows as "Acted on the organisation".
  - A burst of operator reads within 10 minutes is one "entered" entry. An explicit entry always writes one.
  - Empty: "No one from FrostAura has entered {Org}" and "If anyone does, it is written here first."
  - Anyone but the Owner: 403, shown as **"Only the Owner can read the operator log"**, with **"Try again"**.
  - No organisation yet: "There is no log until your organisation is named".
  - An operator reading it sees the log of their own first organisation, not the one they entered.
- **Where:** `features/audit/OperatorAccessView.tsx`, `features/home/HomeView.tsx` (`ManageLinks`). `GET /api/audit/operator-access?organisation=`. `AccessService.LogVisitAsync` and `RecordEntryAsync`.
- **Reachable from:** UI
- **Covered by tests:** `OperatorAccessView.test.tsx` (all five); `console.spec.ts` "the Owner reads every operator entry; anyone else is refused…"; `ControlPlaneDebtsTests.Operators_come_from_the_explicit_list_only_and_every_entry_is_logged_for_the_owner`; `FinalDefectsTests.Entering_an_organisation_and_then_reading_it_is_one_logged_entry` and `Reads_with_no_entry_before_them_log_one_entry…`.

### ID-11 Set who is an operator, and whether the development sign-in can exist
- **Who:** host administrator
- **Starts at:** environment configuration and the command line
- **Needs:** access to the host
- **Level:** Operator
- **Learn first:** ID-03, SHL-05
- **What you learn:** God mode is granted to an explicit list of addresses only, never by domain, and production cannot enable the development sign-in.
- **Steps:**
  1. Set `ENDGAME_OPERATORS` to a list of e-mail addresses (separated by commas, semicolons or spaces), and/or `Operators:Emails`.
  2. Restart the control plane. Those people now see the God-mode band and can open `/operator`.
  3. `make prod-config` checks that production pins `ENDGAME_DEV_LOGIN` to false.
- **You know it worked when:** an operator sees the God-mode band. `make prod-config` prints "prod-config: parses; development sign-in pinned off; every service Production; backup key required."
- **Variations and refusals:** an access token is never treated as an operator.
- **Where:** `AccessService.cs` (`OperatorOptions`), `Makefile`.
- **Reachable from:** command line only
- **Covered by tests:** `ControlPlaneDebtsTests.Operators_come_from_the_explicit_list_only…`; `DevelopmentSignInTests`.

---

## People

**Roles as the server enforces them** (reference for every PPL flow):
- There are four roles: Viewer < Builder < Admin < Owner.
- The *deepest* grant on a scope's chain decides your role there. The one exception is the organisation's Owner, who may do everything everywhere.
- An organisation has one Owner, who can never be granted, removed or changed.
- Only the Owner makes or unmakes an Admin.
- Admins manage people, secrets and sharing within where their grant is set.
- An operator with no role enters an organisation as Admin, never as Owner, and is logged.
- Someone with no role anywhere on a scope is told it does not exist (404), so the shape of the tree is not revealed.
- The console's **"What each role may do"** panel, word for word:
  - Owner: "Everything, including credits, the overdraft limit, managing Admins and closing the organisation."
  - Admin: "Manages people, secrets, sharing, public or private, budgets and rules, within where the grant is set."
  - Builder: "Creates and changes projects and apps, directs employees, and spends credits within budget."
  - Viewer: "Sees everything there — the org chart, dashboards and apps — and changes nothing."

### PPL-01 See the people at a level, and what each role may do
- **Who:** admin / owner / operator
- **Starts at:** home screen, with a node selected: **"People"** (shown to Admin, Owner or operator). Or `/people?scope={path}`.
- **Needs:** Admin or higher at the scope
- **Level:** Core
- **Learn first:** ID-02
- **What you learn:** a grant is set at one level and holds for everything beneath it.
- **Steps:**
  1. The heading reads **"People in {name}"**, with the line "Everyone with a role here, and where each grant was set. A grant holds for everything beneath where it is set."
  2. While loading: "Loading the people".
  3. Each row shows the person's name (with "(you)" against yourself), their e-mail, and the role as a badge or a drop-down.
  4. Each row says "Set here" or "Set at {node}". It also says "Since {date}", or **"No passkey yet: they sign in with the code they were given"** for a person still to register. This is the only way pending invitations are shown.
  5. Technical mode adds the grant's id.
  6. The side panel **"What each role may do"** lists the four roles with the text above, followed by "A role can be granted at the organisation, a division, a project or an app, and holds for everything beneath it — so one person can be a Builder in one division and a Viewer elsewhere."
- **You know it worked when:** the list labelled "People" shows rows.
- **Variations and refusals:**
  - Empty: "No one holds a role in {name} yet" and "Invite someone and they appear here once they accept."
  - 403: **"Only an Admin or the Owner can see the people here"**, with **"Try again"**.
  - No organisation yet: "There is no one to show until your organisation is named".
  - The server lists grants set *at or beneath* the scope only. Below the organisation, the Owner and organisation-wide grants are **not** listed, so the empty-state text can be untrue. "Set at {node}" therefore always means a node beneath.
- **Where:** `features/people/PeopleView.tsx`, `lib/roles.ts`. `GET /api/members?scope=`.
- **Reachable from:** UI
- **Covered by tests:** `PeopleView.test.tsx` ("shows a skeleton…", "records a refusal…", "says when no one holds a role", "lists each person…").

### PPL-02 Switch the level being viewed
- **Who:** admin / owner
- **Starts at:** People screen, the **"Show people at"** drop-down. It appears only when the organisation has more than one node.
- **Needs:** PPL-01
- **Level:** Core
- **Learn first:** PPL-01
- **What you learn:** each level of the tree has its own people list.
- **Steps:** the person picks a node in the indented list. The address becomes `/people?scope=…` and the list and heading follow.
- **You know it worked when:** the heading changes to the chosen node's name.
- **Variations and refusals:** the same refusals as PPL-01 at the new scope.
- **Where:** `PeopleView.tsx` (`ScopePicker`).
- **Reachable from:** UI
- **Covered by tests:** none specific.

### PPL-03 Invite a new person to a role
- **Who:** admin (Builder or Viewer roles) / owner (Admin too) / operator
- **Starts at:** People screen, the **"Invite someone"** panel
- **Needs:** Admin or higher at the scope
- **Level:** Core
- **Learn first:** PPL-01
- **What you learn:** an invitation is a role at a level plus a one-time code, shown once.
- **Steps:**
  1. The person fills in **"E-mail address"** and, optionally, **"Their name"** (hint: "Optional. Shown to everyone in the organisation.").
  2. They choose a **"Role"**: Viewer, Builder, or Admin (Admin is offered only to the Owner).
  3. They choose **"Where"** (hint: "The role holds here and beneath."). Only this node and the nodes beneath it are offered.
  4. The text of the chosen role from the roles panel is shown under the form.
  5. They click **"Invite"**. While it works it reads **"Inviting…"**.
  6. The server creates the person if they are new and grants the role. If they have no passkey, it issues a one-time code that lasts 7 days and is stored only as a hash. If mail is configured it queues the e-mail "You are invited to {Org} on Endgame".
  7. A green box appears: "{name} is invited as {Role} at {node}." It then says either "The code was e-mailed to them too." or "E-mail is not set up here, so give them this code yourself.", followed by "They use it to make their passkey before {date}."
  8. The box shows the code with **"Copy"** (**"Copied"** once copied), the line **"It will not be shown again."**, and **"Done"**.
  9. The person appears in the list with "No passkey yet…".
- **You know it worked when:** the green box with the code appears and the person is in the list.
- **Variations and refusals:**
  - Invalid e-mail: "That does not look like an e-mail address." The button is disabled.
  - Copy fails: "It could not be copied; select it and copy it by hand."
  - Server refusal: "{email} was not invited: {reason} Nothing changed." Reasons include "Only the Owner manages Admins." (403), "An organisation has one Owner, the person it was provisioned for.", and "That person is the Owner here; their role is not changed by a grant." (409).
  - With no name given, the name becomes the part of the address before the @.
  - The code never reaches the app's data store or the address bar.
- **Where:** `PeopleView.tsx` (`Invite`), `store/sensitive.ts` (`inviteMember`), `components/OneTime.tsx`. `POST /api/members`, `AccountService.GrantAsync`, `InvitationMailer.SendAsync`.
- **Reachable from:** UI; MCP (`member_invite`)
- **Covered by tests:** `PeopleView.test.tsx` "invites by e-mail to a role at a level…"; `breadth.spec.ts` "invites to a role at a level with a one-time code…"; `SignInTests` invitation test.

### PPL-04 Grant a role to someone who already has a passkey
- **Who:** admin / owner
- **Starts at:** the **"Invite someone"** panel
- **Needs:** the person already holds a passkey (for example, a member elsewhere in the organisation)
- **Level:** Core
- **Learn first:** PPL-03
- **What you learn:** existing people need no code; the grant applies at once.
- **Steps:** the same as PPL-03, steps 1 to 5. The server issues no code.
- **You know it worked when:** "{name} already has a passkey, so they now hold {Role} at {node} and can sign in straight away." appears.
- **Variations and refusals:** granting at a node where they already hold a grant replaces that grant's role.
- **Where:** as PPL-03.
- **Reachable from:** UI; MCP
- **Covered by tests:** none specific found.

### PPL-05 Send a fresh code to a pending invitee
- **Who:** admin / owner
- **Starts at:** the **"Invite someone"** panel
- **Needs:** the person has no passkey yet
- **Level:** Core
- **Learn first:** PPL-03
- **What you learn:** inviting the same address again replaces the old code with a new one.
- **Steps:** invite the same e-mail again. A new code that lasts 7 days replaces the old one, which stops working. The new code is shown once and e-mailed if mail is set up.
- **You know it worked when:** a new code box appears.
- **Variations and refusals:** there is no dedicated **"Resend"** control.
- **Where:** `AccountService.IssueInvitationIfNeededAsync`.
- **Reachable from:** UI (indirectly); MCP
- **Covered by tests:** none found.

### PPL-06 Change someone's role
- **Who:** admin (between Builder and Viewer) / owner (to or from Admin too)
- **Starts at:** People screen, the role drop-down in a row
- **Needs:** the grant was set at this level. It is not your own grant and not the Owner's. If it is an Admin's grant, you are the Owner.
- **Level:** Core
- **Learn first:** PPL-01
- **What you learn:** a grant is changed where it was set, and Admins are the Owner's to make.
- **Steps:**
  1. The person picks a new role in **"Role for {name}"**.
  2. The list shows the new role at once.
  3. The server checks the needed role (Owner if the change touches Admin, otherwise Admin) and updates the grant.
- **You know it worked when:** the drop-down keeps the new value after the list refreshes.
- **Variations and refusals:**
  - Refused: the role goes back and "The role was not changed: {reason} It is back to {Role}." appears.
  - A grant set beneath shows "Change this grant at {node}." and has no drop-down.
  - The Owner's row and your own row show a badge only.
  - **Side effect:** if the person has no passkey yet, the server issues a new invitation code. The one they were sent stops working, and the console throws the new code away without showing or e-mailing it.
- **Where:** `PeopleView.tsx` (`MemberRow`), `store/api.ts` (`changeRole`). `PATCH /api/members/{membershipId}`.
- **Reachable from:** UI. Over MCP, `member_invite` at the same scope does the same thing.
- **Covered by tests:** `PeopleView.test.tsx` "changes a role at once and puts it back when refused"; `breadth.spec.ts` "an Admin who asks for the Admin role is refused…"; `BreadthTests.A_role_is_changed_where_it_was_set_and_admins_are_the_owners_to_make`.

### PPL-07 Remove someone's grant
- **Who:** admin / owner (Admin grants: Owner only)
- **Starts at:** People screen, **"Remove {name}"** in a row
- **Needs:** the same conditions as PPL-06
- **Level:** Core
- **Learn first:** PPL-01
- **What you learn:** removing a grant at one level leaves grants set elsewhere in place.
- **Steps:**
  1. The person clicks **"Remove {name}"**. A confirmation shows: "{name} loses this role at once. Grants set elsewhere stay.", with **"Remove"** and **"Keep them"**.
  2. They click **"Remove"**. The row disappears at once and the grant is deleted.
- **You know it worked when:** the row is gone after the list refreshes.
- **Variations and refusals:**
  - Refused: the row returns and "{name} still has their role: {reason}" appears above the list.
  - The Owner's grant: "The Owner's role cannot be revoked."
  - The person's account, passkey and any pending code stay. Not verified from code: whether a role-less account with a pending code can still register.
- **Where:** `PeopleView.tsx`. `DELETE /api/members/{membershipId}`.
- **Reachable from:** UI; MCP (`member_revoke`)
- **Covered by tests:** `PeopleView.test.tsx` "asks before removing someone and removes them"; `breadth.spec.ts`.

### PPL-08 Accept an invitation and register as an invited member
- **Who:** invited person
- **Starts at:** the invitation e-mail (which says "Open {console} and register a passkey with this e-mail address and the code below.") or a code handed over by the inviter
- **Needs:** an open code (7 days, single use) for that e-mail address
- **Level:** Foundation
- **Learn first:** PPL-03
- **What you learn:** the code proves you were invited, once, and after that your passkey is all you use.
- **Steps that work, through the API only:**
  1. Request registration options with the e-mail, a display name and the invitation code. The server checks the code in constant time and against its expiry.
  2. Complete the passkey registration. The passkey is stored, the code is cleared and the person is signed in with exactly the granted role.
- **Steps in the console:** the sign-in screen offers only **"First time here? Create your passkey"**, with name and e-mail. Submitting gets "Endgame is invite-only…" (ID-07). **The invited person cannot finish in the console.**
- **You know it worked when:** (API) the answer lists the granted membership.
- **Variations and refusals:**
  - Wrong, used or expired code: 403, "That invitation code is not valid for this e-mail address, or it has expired."
  - The same gap blocks the Owner of an organisation that an operator provisions from God mode.
- **Where:** `AuthEndpoints.cs` (the "invitation" kind), `AccountService.FindInvitedAsync` and `ClearInvitationAsync`. The console side is missing from `SignInView.tsx`.
- **Reachable from:** **API only. Screen missing.**
- **Covered by tests:** `SignInTests.After_the_first_person_registration_needs_an_invitation_and_the_invited_person_gets_their_role` (API). No UI test.

---

## AI assistants and MCP

### AST-01 Open the AI assistants screen and copy the addresses
- **Who:** any member (viewer or higher)
- **Starts at:** home: **"AI assistants"** (**"MCP access"** in technical mode). The app page also has **"Let an assistant in"**. Or `/assistants`.
- **Needs:** signed in, with an organisation
- **Level:** Advanced
- **Learn first:** ID-02, SHL-01
- **What you learn:** an assistant needs two things, a key and an address. There is one address for the whole organisation and one for each app.
- **Steps:**
  1. The heading reads **"Let an AI assistant work with your organisation"** (technical: **"MCP access tokens"**).
  2. The lead reads: "Give an assistant a key and it can do what you can do here — read the org chart, start ideas, look after apps — but never more than the role you give it. It can never make an app public, change the overdraft, top up or download an app."
  3. In technical mode the lead instead names `egp_…` tokens, `/mcp` and `/mcp/apps/{appId}`, and says "God mode is never available through one."
  4. The side panel **"The addresses to give it"** (technical: **"Endpoints"**) shows **"The whole organisation"** with `{origin}/mcp` and one line per app with `{origin}/mcp/apps/{id}`. Each has **"Copy"**, which reads **"Copied"** afterwards.
  5. The footnote reads "The organisation's address lets it do what you do in the console; an app's address lets it use that app the way its people do." (technical: "Streamable HTTP, stateless; no OAuth — the token is made here.")
- **You know it worked when:** a copied address reads **"Copied"**.
- **Variations and refusals:**
  - No apps yet: "Each app gets an address of its own once it is built."
  - No organisation: "There is nothing to connect until your organisation is named".
- **Where:** `features/assistants/AssistantsView.tsx`, `features/apps/AppAside.tsx`, `HomeView.tsx`.
- **Reachable from:** UI
- **Covered by tests:** `AssistantsView.test.tsx` "speaks plainly in normal mode…" and "gives the two kinds of address…".

### AST-02 Make a key for an assistant
- **Who:** any member
- **Starts at:** the **"Make a key"** panel (technical: **"New token"**)
- **Needs:** a role somewhere in the organisation
- **Level:** Advanced
- **Learn first:** AST-01, PPL-01 (roles)
- **What you learn:** a key acts as you, held to one organisation and a role no higher than yours. An Owner's key is at most an Admin's.
- **Steps:**
  1. The person fills in **"Which assistant is it for?"** (1 to 100 characters; hint: "A name you will recognise later, such as "My laptop assistant".").
  2. They choose **"What it may do"**: only roles up to their highest in the organisation are offered, never Owner. The hint is "As Owner, the most a key can carry is Admin." or "No more than your own role." The default is Builder where allowed.
  3. They choose **"It stops working"**: "In 30 days", "In 90 days" (default), "In a year" or "Never".
  4. They click **"Make the key"** (technical: **"Create token"**). While it works it reads **"Making the key…"**.
  5. The server creates an `egp_…` token and stores only its hash.
  6. The box **"The new key"** shows "Give this key to {name}, with the address for the whole organisation. It acts as you, as {Role}." (technical adds "Send it as Authorization: Bearer."). It shows the key with **"Copy"**, **"It will not be shown again."** and **"Done"**.
- **You know it worked when:** the key box appears and the key is listed as **"Active"**.
- **Variations and refusals:**
  - No name: the button stays disabled.
  - No role in the organisation: "You hold no role in this organisation that a key could carry."
  - Refusal: "No key was made: {reason}". Reasons: Owner asked for ("A token never acts as the Owner…"); higher than your role (403, "A token's role is no higher than yours…"); 50 live tokens already ("You hold 50 live tokens here; revoke one first."); expiry outside 1 to 366 days.
- **Where:** `AssistantsView.tsx` (`NewToken`), `store/sensitive.ts` (`createToken`). `POST /api/tokens`, `AccessTokenService.CreateAsync`.
- **Reachable from:** UI. There is no MCP tool for keys.
- **Covered by tests:** `AssistantsView.test.tsx` "makes a key no higher than the person's role and shows it once…"; `breadth.spec.ts` "lets an assistant in with a key shown once…"; `McpTests.Tokens_are_shown_once_kept_as_a_hash_capped_at_the_persons_role_and_never_owner`.

### AST-03 See and revoke keys
- **Who:** the key's maker
- **Starts at:** the list **"Assistants you have let in"** (technical: **"Tokens"**)
- **Needs:** at least one key
- **Level:** Advanced
- **Learn first:** AST-02
- **What you learn:** you can see when each key was last used, and shut one out at once.
- **Steps:**
  1. Each row shows the name, "{Role} in {Organisation} · made {date} · ends/ended {date}" (or "· never ends"), "Last used {time ago}" or "Never used", and a badge: **"Active"**, **"Expired"** or **"Revoked"**. Technical mode adds the prefix and id.
  2. The person clicks **"Revoke"**. A confirmation shows: "The assistant using it is shut out at once. This cannot be undone; make a new key to let it back in.", with **"Revoke it"** and **"Keep it"**.
  3. They click **"Revoke it"**. The badge becomes **"Revoked"** at once, and the key's next call gets 401.
- **You know it worked when:** the badge reads **"Revoked"** and **"Revoke"** has gone.
- **Variations and refusals:**
  - Refused: the badge returns and "The key still works: {reason}" appears.
  - Empty: "No assistant has a key yet" and "Make a key here, then give it and the address beside to your assistant."
  - Load failure: "The assistant access could not be loaded" and **"Try again"**.
  - "Last used" updates at most once a minute.
  - The list shows your keys from **every** organisation without saying which one each belongs to.
- **Where:** `AssistantsView.tsx` (`TokenRow`). `GET /api/tokens`, `DELETE /api/tokens/{id}`.
- **Reachable from:** UI
- **Covered by tests:** `AssistantsView.test.tsx` "lists each key…", "shows loading, a failed read and an empty list distinctly" and "revokes at once after a confirmation…"; `breadth.spec.ts`.

### AST-04 What a key can never do
- **Who:** AI assistant
- **Level:** Advanced
- **Learn first:** AST-02
- **What you learn:** some acts belong to a person and are never possible with a key.
- **The rules, from the code:**
  - A key works only on `/mcp`. It is never accepted on `/api`, so it can never stand in for a person at the console, and a cookie is not accepted on `/mcp`.
  - It reaches one organisation only. Anything else answers 404.
  - Its role is capped by the token.
  - It is never an operator, so God mode is unavailable.
  - Its actor is recorded as `mcp`, so `access: public` is refused with 403 `human_only` and "Only a person can make an app public".
  - There are no tools for top-ups, overdraft, export, keys or the operator log.
  - The Owner-only overdraft setting is out of reach because the cap is at most Admin.
  - A breached red line refuses a build for everyone.
- **You know it worked when:** any of these attempts returns an error result.
- **Where:** `AccessTokenAuthentication.cs`, `AccessTokens.cs` (`CallerCeiling`), `AccessService.cs`, `CascadeService.cs`.
- **Reachable from:** MCP only
- **Covered by tests:** `McpTests.A_viewers_token_reads_and_changes_nothing`; `AuthorizationMatrixTests.Every_mcp_tool_is_held_to_the_same_roles…`; `AppAccessTests.Only_a_person_can_make_an_app_public…`.

### AST-05 Connect an assistant to the whole organisation
- **Who:** AI assistant, set up by a member
- **Starts at:** the assistant's MCP settings
- **Needs:** a key (AST-02) and the `/mcp` address (AST-01)
- **Level:** Advanced
- **Learn first:** AST-01, AST-02
- **What you learn:** the organisation is a set of tools, each held to the same checks as the console.
- **Steps:**
  1. Add a server at `https://{console}/mcp` (streamable HTTP, stateless) with the header `Authorization: Bearer egp_…`.
  2. The assistant lists 45 tools (AST-07 to AST-16). Read-only tools are marked read-only, and tools whose name contains "remove" are marked destructive.
  3. Each call runs the same service as the console, behind the same role check at the named scope, capped by the key.
- **You know it worked when:** the assistant lists the tools and `tree_get` returns your organisation. "Last used" changes on the AI assistants screen.
- **Variations and refusals:**
  - Unknown, revoked or expired key, or no bearer: 401 with `WWW-Authenticate: Bearer realm="endgame-mcp", error="invalid_token"`.
  - Unknown tool: "There is no tool '{name}'."
  - Refusals come back as an error result `{ status, code, title, detail }`. Role too low: 403, naming the needed role and, if the key caps it, "this access token acts as a {role} at most". Another organisation or branch: 404.
- **Where:** `Mcp/McpSetup.cs`, `Mcp/ControlPlaneTools.cs`.
- **Reachable from:** MCP only
- **Covered by tests:** `McpTests.The_control_plane_tools_do_what_the_console_does_under_the_same_rules`; `EdgeRoutingTests.Mcp_goes_to_the_control_plane_before_the_console_catches_everything`.

### AST-06 Connect an assistant to one app
- **Who:** AI assistant, for a member with a role on the app
- **Starts at:** the assistant's MCP settings, at `https://{console}/mcp/apps/{appId}`
- **Needs:** a key, and the Viewer role or higher on that app
- **Level:** Advanced
- **Learn first:** AST-05
- **What you learn:** every app answers MCP from its own API description, and the app sees the assistant as you.
- **Steps:**
  1. The assistant lists tools: one per operation in the app's OpenAPI document, for its current published version. GET operations are marked read-only.
  2. It calls one. The control plane makes a short-lived member session for the key's person and calls the app through Edge.
  3. The result is `{ status, body, truncated }`.
- **You know it worked when:** the tool list shows the app's own operations.
- **Variations and refusals:**
  - No role on the app: 404.
  - The app's own 4xx: error result "The app refused the call", carrying the app's `code` (default `app_error`).
  - Per UC-116: the app cannot describe itself, or cannot be reached, gives 502 `app_openapi_unavailable` or `app_unreachable` (not traced in detail).
  - App end users cannot use this; it is for members only.
- **Where:** `Mcp/AppTools.cs`, `AppIdentityService.MemberTokenAsync`.
- **Reachable from:** MCP only
- **Covered by tests:** `McpTests.An_apps_own_api_is_derived_from_its_openapi_and_called_through_edge_with_a_member_session`.

### AST-07 to AST-16 What the assistant can do, by capability
All need AST-05. All are MCP only, Level Advanced. Covered by `McpTests` and `AuthorizationMatrixTests.Every_mcp_tool_is_held_to_the_same_roles…`. "You know it worked when": the call returns a result that is not an error and matches what the console then shows.

- **AST-07 Read the organisation:**
  - `tree_get` (Viewer) returns the first organisation the key reaches.
  - `ontology_get` (Viewer; views all, org-chart, data-flow).
  - `notifications_list` (Admin; optionally unread only, 50 at most).
  - *Teaches:* the org chart as one document.
- **AST-08 Shape the tree:**
  - `node_create` (division: Admin; project or app: Builder; the parent must be one level up).
  - `node_update` (rename, or status active/archived; division: Admin, otherwise Builder; an organisation is refused with "An organisation is renamed by its Owner at the console.").
- **AST-09 Values, budgets and credits:**
  - `cascade_get` (Viewer; secret and permission kinds need Admin).
  - `cascade_set` and `cascade_remove` (budget, rule_set, context, setting. The role depends on the key: context and `sleep.*` need Builder, the overdraft own-limit needs Owner and so is unreachable, everything else needs Admin. Secret and permission kinds are refused with "Secrets are set with secret_set and roles with member_invite.").
  - `budget_set` (Admin, monthly credits).
  - `credits_get` (Viewer).
- **AST-10 Ideas and verdicts:**
  - `idea_estimate` (Viewer).
  - `idea_submit` (Builder; recorded as coming from MCP).
  - `idea_get` (Viewer).
  - `idea_decide` (Builder; build / change / overrule / drop; a red line refuses build and overrule).
  - `ideas_suggest` (Builder).
  - `ideas_suggestions` (Viewer).
  - `suggestion_take` (Builder).
- **AST-11 Runs, tasks, approvals and conversation:**
  - `runs_list`, `run_get` and `run_events` (Viewer; at most 100 runs or 200 events).
  - `run_control` (Builder; pause, resume or cancel).
  - `approval_answer` (Builder; approve or reject).
  - `tasks_list` (Viewer).
  - `conversation_post` (Builder; optionally to one employee).
- **AST-12 Workforce:**
  - `employees_list` and `employee_get` (Viewer).
  - `employee_update` (Admin; name, role, mandate, or status paused/idle).
  - `employee_release` (Admin).
  - `hires_list` (Viewer).
  - `hire_raise` and `hire_decide` (Admin).
- **AST-13 Autonomy and rules:**
  - `autonomy_get` (Viewer).
  - `autonomy_set` (Admin; mode, and the start, plan and hire checkpoints).
  - `rule_set_set` (Admin; deny, ask, allow and checkpoints per stage).
- **AST-14 People:**
  - `members_list` (Admin).
  - `member_invite` (Admin; Admin roles only if the person behind the key is the Owner. The cap of Admin still passes, because the check uses the person's role capped at Admin, and Admin is not Owner. **Not verified: an Owner's key probably cannot grant Admin**, because the capped role becomes Admin and "Only the Owner manages Admins." follows). The code is returned **in the tool result and never e-mailed**.
  - `member_revoke` (Admin; an Admin's grant needs Owner, which is unreachable by key).
- **AST-15 Secrets:**
  - `secrets_list` (Admin; names only).
  - `secret_set` and `secret_remove` (Admin).
- **AST-16 Apps:**
  - `app_get` (Viewer).
  - `app_settings` (Builder for running mode and idle minutes; Admin to change access; `public` is refused as `human_only`).
  - `app_ask` (Builder; charged to the app).
  - `app_versions` (Viewer).
  - `app_restore` (Builder; a public app becomes private).
- **Missing as tools** (finding): app sharing (list, share, unshare), keys, notifications mark-read, top-up requests, the operator log, an employee's memory, the app dashboard. Export, overdraft and top-ups are deliberately absent.

---

## App access and end users

Each app has two addresses:
- **path form:** `https://{platform host}/{org}/{division}/{project}/{app}/`
- **organisation subdomain:** `https://{org}.{organisation domain}/{division}/{project}/{app}/`

The identity pages sit at `{app address}_endgame/auth/sign-in`, `sign-up`, `sign-out` and `handoff`. The access setting is inherited down the tree and defaults to private.

### ACC-01 Open a private app as a member who has a role
- **Who:** owner / admin / builder / viewer / operator
- **Starts at:** the app's address
- **Needs:** signed in to the console in the same browser, with a role on the app
- **Level:** Foundation
- **Learn first:** ID-02
- **What you learn:** your console session opens every app you have a role on, and the app is told who you are.
- **Steps:** Edge asks the control plane. The answer is allow, with a 15-minute app-scoped token that Edge passes to the app as `X-Endgame-Session`. The app opens and shows the person as a member with their role. An operator entering this way is logged in the operator log.
- **You know it worked when:** the app loads. In template apps the user menu shows the person's name with **"Sign out"**.
- **Variations and refusals:** see ACC-10 (no role) and ACC-14 to ACC-16 (unavailable).
- **Where:** `Edge/Routing/AppGate.cs`, `Edge/Access/AccessGate.cs`, `AppIdentityService.CheckAsync`. `POST /internal/access/check`.
- **Reachable from:** UI (browser)
- **Covered by tests:** `AppAccessTests.A_private_app_admits_members_with_rights…`; `acceptance.spec.ts` test 4.

### ACC-02 Arrive signed out at a private or shared app
- **Who:** anonymous visitor
- **Starts at:** the app's address
- **Needs:** nothing
- **Level:** Foundation
- **Learn first:** none
- **What you learn:** private and shared apps ask strangers to sign in on the platform's own page.
- **Steps:**
  1. Edge's check answers "sign in".
  2. For a page request, Edge redirects (302) to `{app}_endgame/auth/sign-in?returnTo={original}`. For other requests it answers 401 with `Location` set.
  3. The page reads **"Sign in to {App}"**, then "{App} belongs to {Org}."
  4. It shows **"Members of {Org}"**: "Sign in with the passkey you use for Endgame." and **"Sign in with a passkey"**.
  5. For shared or public apps only, it adds **"Using this app"**: "Sign in with the passkey you created for this app.", **"Sign in with your passkey"**, and "New here? **Create your sign-in**".
- **You know it worked when:** the **"Sign in to {App}"** page shows.
- **Variations and refusals:**
  - Control plane unreachable: "This app is temporarily unavailable" (503).
  - The page cannot load the app's details: lead "Sign-in is unavailable just now." plus the error.
  - Unknown sub-page: 404.
- **Where:** `AppGate.RefuseAsync`, `Edge/Access/AuthPages.cs`, `Edge/Pages/AuthPage.cs`. `GET /api/app-auth/{appId}`.
- **Reachable from:** UI
- **Covered by tests:** `EdgePipelineTests.The_sign_in_page_is_the_edges_own…`; `AppAccessTests` private-app test; `appkit/proof/tests/addresses.spec.ts`.

### ACC-03 A member signs in at an app's sign-in page
- **Who:** member
- **Starts at:** **"Sign in with a passkey"** on an app's sign-in page
- **Needs:** a console passkey
- **Level:** Foundation
- **Learn first:** ACC-02, ID-02
- **What you learn:** apps use the same passkey as the console.
- **Steps:** they approve the passkey. This is the console sign-in, so the console session starts too. The page sends them to `returnTo`, or through a hand-off for the subdomain form (ACC-08). The app opens.
- **You know it worked when:** the app opens at the original address.
- **Variations and refusals:**
  - Unknown key: the error text from ID-02.
  - Prompt closed: "The passkey prompt was closed or timed out. Nothing was changed."
  - No role on the app: ACC-10.
  - There is no way to register a member passkey here.
- **Where:** `AuthPage.cs` (script), `/api/auth/passkey/login/*`.
- **Reachable from:** UI
- **Covered by tests:** `EdgePipelineTests` sign-in test; `acceptance.spec.ts` test 4.

### ACC-04 Register at a shared app as an invited person
- **Who:** invited person, who becomes an app end user
- **Starts at:** the e-mail "{Org} shared {App} with you" (it says to open the path-form address and choose "Create an account"), or a code handed over by an Admin
- **Needs:** the app is shared with this address. The code is open (14 days, single use).
- **Level:** Foundation
- **Learn first:** ACC-02. The other reader covers how an Admin shares an app.
- **What you learn:** an end user belongs to one app only, with no role in the organisation.
- **Steps:**
  1. They open the app and are sent to the sign-in page (ACC-02). They click **"Create your sign-in"**.
  2. The page reads **"Create your sign-in for {App}"**, then "{App} is shared with chosen people. Use the address it was shared with and the invitation code you were given."
  3. They fill in **"E-mail address"**, **"Your name"** (optional) and **"Invitation code"**, and click **"Create a passkey"**.
  4. The server checks the code without using it up, then the device creates a passkey for this app alone.
  5. The server checks the code again and uses it up. It creates the end user and starts a 14-day session at this app (cookie `endgame.app.{id}`).
  6. They are sent to `returnTo`, or through the hand-off for the subdomain form.
- **You know it worked when:** the app opens and shows their name.
- **Variations and refusals:**
  - Wrong address or code, or a used or expired code: "This app is shared with chosen people: register with the address it was shared with and the invitation code you were given."
  - Already registered: "That address is already registered with this app; sign in instead."
  - Prompt closed: "The passkey prompt was closed or timed out. Nothing was changed."
  - Passkey made for a different registration: "The passkey was not created for this registration."
  - Took longer than five minutes: "The passkey ceremony has expired or is not valid; start again."
  - **"Already registered? Sign in"** goes back to the sign-in page.
  - The e-mail's wording ("Create an account") matches only template apps' own button; Edge's link says "Create your sign-in".
- **Where:** `AuthPage.cs`, `AppAuthEndpoints.cs`, `AppIdentityService.SignUpOptionsAsync` and `SignUpCompleteAsync`, `InvitationMailer.SendShareAsync`. `POST /api/app-auth/{appId}/sign-up/options|complete`.
- **Reachable from:** UI
- **Covered by tests:** `AppAccessTests.A_shared_app_admits_the_people_it_was_shared_with_once_they_register…`; `console.spec.ts` "a shared app lists its people, invites by e-mail…" (inviter side).

### ACC-05 Register as an end user of a public app
- **Who:** anonymous visitor
- **Starts at:** the app's sign-up page (from **"Create your sign-in"**, or an app button such as the template's **"Create an account"**)
- **Needs:** the app is public
- **Level:** Foundation
- **Learn first:** ACC-07
- **What you learn:** anyone may register for a public app with just a passkey.
- **Steps:** the lead reads "Anyone may use {App}. A passkey on this device signs you in — there is no password." There is no code field. Fill in the e-mail, optionally the name, click **"Create a passkey"**, approve, and return signed in.
- **You know it worked when:** the app shows their name.
- **Variations and refusals:**
  - Private app: the lead reads "{App} is private: only members of {Org} can open it." and no form is shown. The server refuses with "This app is private: only members of the organisation with rights over it can open it."
  - Already registered: as ACC-04.
- **Where:** as ACC-04.
- **Reachable from:** UI
- **Covered by tests:** `AppAccessTests` (public cases in `Only_a_person_can_make_an_app_public…`); `acceptance.spec.ts` test 12 (anonymous only).

### ACC-06 An end user signs back in
- **Who:** app end user
- **Starts at:** the app's sign-in page, **"Sign in with your passkey"**
- **Needs:** registered at this app; still shared, or the app is public
- **Level:** Foundation
- **Learn first:** ACC-04 or ACC-05
- **What you learn:** a passkey made for one app works there and nowhere else.
- **Steps:** they approve the passkey. The server verifies it for this app only and checks the app may still be opened. A new 14-day session starts and they return.
- **You know it worked when:** the app opens with their name.
- **Variations and refusals:**
  - A passkey from another app, or an unknown one: "That passkey could not be verified for this app."
  - No longer shared: "This app is not shared with that address."
  - Now private: the private refusal from ACC-05.
- **Where:** `AppIdentityService.SignInOptionsAsync` and `SignInCompleteAsync`.
- **Reachable from:** UI
- **Covered by tests:** `AppAccessTests.An_end_user_belongs_to_one_app_and_can_never_reach_the_console_or_another_app`.

### ACC-07 Open a public app with no sign-in
- **Who:** anonymous visitor
- **Starts at:** the app's address
- **Needs:** the app is public
- **Level:** Foundation
- **Learn first:** none
- **What you learn:** public means anyone, and signing in only tells the app who you are.
- **Steps:** with no cookies, Edge opens the app without asking the control plane. With cookies, it asks; a known visitor gets a session token, and anyone else is anonymous.
- **You know it worked when:** the app loads, offering **"Sign in"** in template apps.
- **Variations and refusals:** even if the control plane is down, a public app opens anonymously.
- **Where:** `AccessGate.CheckAsync`.
- **Reachable from:** UI
- **Covered by tests:** `acceptance.spec.ts` "12. made public by a person, the app opens signed out".

### ACC-08 Use the organisation-subdomain address
- **Who:** member or end user
- **Starts at:** `https://{org}.{domain}/{division}/{project}/{app}/`
- **Needs:** the platform's own address is configured
- **Level:** Core
- **Learn first:** ACC-02, ACC-03
- **What you learn:** you always sign in on the platform's own host, and the session is then carried to the subdomain by a one-time link.
- **Steps:**
  1. Signed out, the visitor is sent to the subdomain's sign-in page, which immediately redirects to the same page on the platform's host with an absolute `returnTo`.
  2. If already signed in there, the page asks for a hand-off and is sent straight back without seeing anything.
  3. Otherwise they sign in (ACC-03 or ACC-06). The server answers with a one-time `{subdomain}_endgame/auth/handoff?code=…` link that lasts one minute.
  4. Edge on the subdomain redeems the code, sets a cookie for that host only, and redirects into the app.
- **You know it worked when:** the app opens on the subdomain address.
- **Variations and refusals:**
  - Hand-off asked for with no session: 401, "There is no session at this app to hand off; sign in first."
  - `returnTo` outside the app's two addresses: Edge replaces it with the app's home; the control plane answers 400 `invalid_return_to`.
  - Expired or failed link: ACC-09.
- **Where:** `AuthPages.HandleAsync`, `AuthPages.RedeemAsync`, `AppIdentityService.HandoffAsync` and `RedeemHandoffAsync`. `POST /api/app-auth/{appId}/handoff`, `POST /internal/access/handoff`.
- **Reachable from:** UI
- **Covered by tests:** `AppAccessTests.A_session_on_the_path_host_is_handed_off_once_to_the_subdomain_host`, `A_return_address_outside_the_apps_own_addresses_is_refused`; `EdgePipelineTests.On_the_organisation_subdomain_sign_in_moves_to_the_platforms_host…`, `A_hand_off_sets_the_subdomains_own_session_cookie_once…`; `EdgeRoutingTests.A_return_address_must_be_inside…`; `acceptance.spec.ts` test 4; `addresses.spec.ts`.

### ACC-09 Follow an expired or failed sign-in link
- **Who:** member or end user
- **Starts at:** a hand-off link that is used, older than a minute, or broken
- **Needs:** nothing
- **Level:** Core
- **Learn first:** ACC-08
- **What you learn:** sign-in links work once, for a minute.
- **Steps:**
  1. Expired: the page reads **"This sign-in link has expired"**, "Sign-in links work once, for a minute. Sign in again to continue." (410).
  2. Control plane failed: **"Sign-in is unavailable just now"**, "Endgame could not finish signing you in. Please try again in a moment." (503).
  3. Both offer **"Sign in again"**.
- **You know it worked when:** after **"Sign in again"**, the app opens.
- **Variations and refusals:** none found.
- **Where:** `AuthPages.RedeemAsync`, `AuthPage.WriteMessageAsync`.
- **Reachable from:** UI
- **Covered by tests:** `EdgePipelineTests` hand-off test.

### ACC-10 Be refused at an app while signed in
- **Who:** a member with no role on a private app; an end user of an app now private or unshared
- **Starts at:** the app's address
- **Needs:** signed in
- **Level:** Foundation
- **Learn first:** ACC-01
- **What you learn:** being signed in is not the same as having access.
- **Steps:** Edge's check answers deny. The page reads **"You don't have access to this app"**, "You are signed in, but this app has not been shared with you. Ask its owner for access." (403).
- **You know it worked when:** that page shows.
- **Variations and refusals:**
  - The same wording is used when the app is private and sharing is irrelevant.
  - Not verified from code: an archived app answers deny even to anonymous visitors, if Edge still routes it.
- **Where:** `AppGate.RefuseAsync`, `UnavailablePage.cs`.
- **Reachable from:** UI
- **Covered by tests:** `AppAccessTests` private-app test; `EdgeRoutingTests.Every_page_is_plain_language_and_branded`.

### ACC-11 Sign out of an app
- **Who:** app end user; member
- **Starts at:** the app's own **"Sign out"** link (the template's user menu), which goes to `{app}_endgame/auth/sign-out`
- **Needs:** signed in
- **Level:** Foundation
- **Learn first:** ACC-04 or ACC-01
- **What you learn:** an end user's sign-out ends that app's session. A member signing out from an app ends their console session too.
- **Steps:**
  1. Edge forwards the cookies. If the console session cookie is present (the platform's host), it calls the console sign-out, ending the console session and every app session. Otherwise it ends just this app's session.
  2. Edge deletes this app's cookie whatever the answer and redirects to `returnTo` or the app's home.
  3. A private or shared app then asks for sign-in again.
- **You know it worked when:** the app shows **"Sign in"**, or the sign-in page.
- **Variations and refusals:**
  - It is a plain link with an effect; there is no confirmation.
  - On the subdomain only that host's session ends; the console session on the platform's host stays.
- **Where:** `AuthPages.SignOutAsync`, `appkit/sdk-web/src/router.ts` (`signOutUrl`), `appkit/template/web/src/UserMenu.tsx`. `POST /api/app-auth/{appId}/sign-out`, `POST /api/auth/logout`.
- **Reachable from:** UI
- **Covered by tests:** `EdgePipelineTests.Signing_out_ends_the_session_through_the_control_plane…`.

### ACC-12 Lose access when an app is unshared or made private
- **Who:** app end user
- **Starts at:** an Admin stops sharing the app, or changes its access (another reader covers that control)
- **Needs:** the person was an end user
- **Level:** Core
- **Learn first:** ACC-04
- **What you learn:** taking access away takes effect at once.
- **Steps:**
  1. On unshare, their sessions end at once and the next request asks them to sign in. Signing in is refused with "This app is not shared with that address."
  2. When the app is made private, existing sessions stop resolving at the app and Edge's next check denies them (ACC-10). Edge may reuse a previous answer briefly, for a few seconds.
- **You know it worked when:** the sign-in page or the refusal page appears.
- **Variations and refusals:** none found.
- **Where:** `AppIdentityService.UnshareAsync`, `ResolveAsync`, `CheckAsync`.
- **Reachable from:** UI
- **Covered by tests:** `AppAccessTests` shared-app test (unshare half).

### ACC-13 Use the development sign-in at an app
- **Who:** developer or tester
- **Starts at:** an app's sign-in or sign-up page
- **Needs:** development sign-in enabled (ID-03)
- **Level:** Developer
- **Learn first:** ID-03, ACC-02
- **What you learn:** tests can sign in as a member or a visitor without a passkey, still within the app's access rule.
- **Steps:**
  1. The sign-in page shows **"Development sign-in"**, "This deployment allows signing in without a passkey, for testing only.", an **"E-mail address"** field, **"As a member"**, and **"As a visitor"** (shared or public apps only).
  2. **"As a member"** signs in a console account (the default development account if no e-mail is given).
  3. **"As a visitor"** creates or finds an end user, where the app admits them.
  4. The sign-up page offers **"Continue without a passkey"** for public apps only.
- **You know it worked when:** the app opens signed in.
- **Variations and refusals:**
  - The private and not-shared refusals from ACC-05 and ACC-06.
  - "Continue without a passkey" is hidden on shared apps even though the server would admit an address the app is shared with.
- **Where:** `AuthPage.cs`, `AppIdentityService.DevelopmentSignInAsync`. `POST /api/app-auth/{appId}/development`.
- **Reachable from:** UI
- **Covered by tests:** `acceptance.spec.ts` test 4; `addresses.spec.ts`.

### ACC-14 Visit a paused app
- **Who:** any visitor
- **Starts at:** the app's address
- **Needs:** the organisation is past its overdraft limit, or a monthly budget above the app is spent
- **Level:** Core
- **Learn first:** ACC-01
- **What you learn:** running out of credits pauses an app without losing anything.
- **Steps:** no credits left: **"This app is paused"**, "Its organisation has used up its credits. Nothing has been lost — it will be back as soon as they are topped up." Budget spent: **"This app is paused"**, "It has used this month's budget. Nothing has been lost — it will be back as soon as the budget is raised or the month turns." Both are 503 and the app is never woken.
- **You know it worked when:** after a top-up or a raised budget, the app opens again.
- **Variations and refusals:** none found.
- **Where:** `AppGate.InvokeAsync`, `UnavailablePage.cs`.
- **Reachable from:** UI
- **Covered by tests:** `EdgePipelineTests.A_paused_app_gets_its_holding_page_and_is_never_woken`; `acceptance.spec.ts` "13. at the overdraft limit the app is paused…"; `ControlPlaneDebtsTests.At_the_overdraft_limit_work_stops_and_apps_pause…`.

### ACC-15 Visit a sleeping, slow, busy or crashed app
- **Who:** any visitor who is admitted
- **Starts at:** the app's address
- **Needs:** the app is asleep
- **Level:** Core
- **Learn first:** ACC-01
- **What you learn:** a sleeping app wakes on the first visit; the visitor just waits.
- **Steps:** the request waits while Edge wakes the app, and concurrent visitors share one wake. The page then loads, with a wake-time header added.
- **You know it worked when:** the app loads after a short delay.
- **Variations and refusals** (each a 503 page):
  - Timed out: **"This app is taking longer than usual"**, "It is still starting. Please try again in a few seconds." (Retry-After 3).
  - No room on the host: **"This app could not start just now"**, "Endgame is very busy at the moment. Please try again in a minute."
  - Crashed: **"This app has stopped for a moment"**, "Something went wrong inside it. It will be started again shortly — please try again in a moment."
  - The app fails mid-request: the crashed page, or **"This app is temporarily unavailable"**.
  - There is no "waking up" page.
- **Where:** `AppGate.cs`, `Runtime/AppRuntime.cs`, `UnavailablePage.cs`.
- **Reachable from:** UI
- **Covered by tests:** `AppRuntimeTests`; `EdgeRoutingTests.Every_page_is_plain_language_and_branded`.

### ACC-16 Visit an unpublished or unreachable app
- **Who:** any visitor
- **Starts at:** the app's address
- **Needs:** nothing
- **Level:** Core
- **Learn first:** ACC-01
- **What you learn:** an address can exist before the app's first version does.
- **Steps:**
  - Not published: **"This app isn't ready yet"**, "It has an address, but its first version has not been published. Please check back soon."
  - Unknown to Edge, or the access check unavailable: **"This app is temporarily unavailable"**, "Endgame could not reach it just now. Please try again in a moment."
  - Paths under `_platform` from the public side: 404.
  - Declared webhooks (`POST hooks/{name}`) reach even a private app without a session.
- **You know it worked when:** the matching page shows.
- **Variations and refusals:** none further.
- **Where:** `AppGate.cs`.
- **Reachable from:** UI
- **Covered by tests:** `EdgePipelineTests.Platform_callbacks_are_never_routed…`, `Declared_webhooks_and_only_those_reach_a_private_app…`; `EdgeRoutingTests.Availability_follows_the_version_and_the_pause`.

---

## Shell

### SHL-01 Switch between normal and technical mode
- **Who:** any signed-in person
- **Starts at:** the header toggle **"Normal"** / **"Technical"** (group "Mode")
- **Needs:** signed in
- **Level:** Foundation
- **Learn first:** ID-02
- **What you learn:** normal mode never names infrastructure; technical mode shows ids, raw events and protocol names.
- **Steps:** click **"Technical"**. It looks pressed, screens add ids and raw detail, and a **"System"** link appears beside the toggle. The choice is remembered in this browser and survives a reload.
- **You know it worked when:** **"Technical"** is the pressed option and, for example, the AI assistants heading reads **"MCP access tokens"**.
- **Variations and refusals:** a private window that refuses storage keeps the mode for the session only.
- **Where:** `AppShell.tsx` (`ModeToggle`), `store/uiSlice.ts`, `store/index.ts`.
- **Reachable from:** UI
- **Covered by tests:** `App.test.tsx` "keeps system status behind technical mode, and remembers the mode"; `breadth.spec.ts` "a normal-mode run never prints…".

### SHL-02 Reach system status from normal mode
- **Who:** any signed-in person
- **Starts at:** `/system`
- **Needs:** signed in
- **Level:** Core
- **Learn first:** SHL-01
- **What you learn:** system status is technical detail, shown only in technical mode.
- **Steps:** in normal mode the page reads **"System status is technical detail"**, "It names the services Endgame runs on, so it is shown in technical mode only.", with **"Switch to technical mode"**. Clicking it shows the status.
- **You know it worked when:** the status view replaces the notice.
- **Variations and refusals:** none found.
- **Where:** `App.tsx` (`SystemRoute`).
- **Reachable from:** UI
- **Covered by tests:** `App.test.tsx`.

### SHL-03 Use the header and breadcrumbs
- **Who:** any signed-in person
- **Starts at:** any screen's header
- **Needs:** signed in
- **Level:** Foundation
- **Learn first:** ID-02
- **What you learn:** the breadcrumb always says where you are, and the mark always goes home.
- **Steps:**
  1. **"Endgame home"** (the mark) goes to `/`.
  2. The breadcrumb "Where you are" shows links for earlier steps and the current page as plain text. On the home screen the earlier steps re-select a level in place.
  3. Labels longer than 48 characters are cut, with the full text on hover.
  4. On a phone only the last two steps show, after "…", and the header uses at most two rows: mark, location and sign-out first, then the mode toggle and the balance.
- **You know it worked when:** clicking a step lands on that level.
- **Variations and refusals:** none found.
- **Where:** `AppShell.tsx` (`Breadcrumb`), `HomeView.tsx` (`crumbsFor`).
- **Reachable from:** UI
- **Covered by tests:** `console.spec.ts` "shows the tree from the API, and selection scopes the breadcrumb…" and "the header is at most two rows…".

### SHL-04 Skip to the content
- **Who:** keyboard and screen-reader users
- **Starts at:** the first Tab on any console screen
- **Needs:** nothing
- **Level:** Foundation
- **Learn first:** none
- **What you learn:** the header can be skipped.
- **Steps:** press Tab. **"Skip to the content"** appears top left; Enter moves focus to the main area.
- **You know it worked when:** focus lands on the main content.
- **Variations and refusals:** none found.
- **Where:** `AppShell.tsx`.
- **Reachable from:** UI
- **Covered by tests:** none found.

### SHL-05 Recognise God mode
- **Who:** operator
- **Starts at:** every console screen
- **Needs:** your e-mail is in the operator list (ID-11)
- **Level:** Operator
- **Learn first:** ID-11
- **What you learn:** operators always know they are in God mode, and that every entry is logged for the Owner.
- **Steps:** a coral band labelled "God mode" shows **"GOD MODE"**. Outside an organisation it reads "You are a FrostAura operator. Entering an organisation is logged where its Owner can read it." On `/?organisation={slug}` it reads "You are inside {slug} as a FrostAura operator. Your entry is logged where its Owner can read it." Everywhere except `/operator` there is an **"Every organisation"** link.
- **You know it worked when:** the band is visible.
- **Variations and refusals:** on every screen other than `/`, the band does not name the organisation you are inside, even while you are in one.
- **Where:** `features/shell/GodModeBand.tsx`.
- **Reachable from:** UI
- **Covered by tests:** `breadth.spec.ts` God-mode tests (`provisions an organisation…`, `is closed to anyone who is not an operator`); not verified whether they check the band's text.

### SHL-06 Arrive at an unknown console address
- **Who:** any signed-in person
- **Starts at:** a console address that matches nothing
- **Needs:** signed in
- **Level:** Foundation
- **Learn first:** ID-02
- **What you learn:** a stale link gets a plain answer and a way back.
- **Steps:** the page reads **"Nothing lives at this address"**, "The link may be old, or the thing it pointed to was removed.", with **"Back to the org chart"**.
- **You know it worked when:** the button returns to `/`.
- **Variations and refusals:** any crash inside a screen is caught and shown as a failure, never a blank page.
- **Where:** `App.tsx` (`NotFound`, `ErrorBoundary`).
- **Reachable from:** UI
- **Covered by tests:** `App.test.tsx` "answers an unknown address plainly".

---

## Gaps and oddities found

1. **Invited members cannot register through the console.**
   - The sign-in form sends only name and e-mail; the code field is missing (`SignInView.tsx`, `passkeyRegisterOptions` in `api.ts`).
   - The invitation e-mail, the People screen ("They use it to make their passkey") and the pending-row text ("they sign in with the code they were given") all point to a step that does not exist.
   - The control plane supports it (`SignInTests`).
   - The same blocks the Owner of an organisation an operator provisions.
2. **Changing the role of someone with no passkey silently issues a new code.** The one they were e-mailed stops working, and the console throws the new code away (`PATCH /api/members` calls `GrantAsync`, which issues the code; `api.ts` keeps only `member`).
3. **The console and the server disagree on what your role is.**
   - The console takes your *highest* grant on the chain (`lib/roles.ts` `roleAt`); the server takes the *deepest* (`RoleResolver`).
   - Example: an organisation Admin who is a Viewer in one division sees the **"Invite someone"** form at that division, but the list fails with "Only an Admin or the Owner can see the people here", and invites are refused.
4. **People below the organisation omit grants set above** (the Owner, organisation-wide Admins).
   - "No one holds a role in X yet" can be untrue.
   - "Set at {node}" only ever means a node *beneath*.
5. ~~Add-another-passkey exists only in the API~~ — fixed (ID-08). Formerly: The passkey count in `/api/me` is never shown, and UC-101 lists the feature as built.
6. ~~After sign-in the console always lands on `/`~~ — fixed (ID-02). Formerly: The address you asked for is lost.
7. ~~One organisation per person in the console~~ — fixed on "Your account" (ID-09); the header switcher waits for the shell to mount it. Formerly: It opens the first membership and has no switcher.
8. ~~The AI assistants list shows keys from every organisation without naming which~~ — fixed (AST-03). Formerly: it showed keys from every organisation without naming which organisation each belongs to.
9. **MCP does not match "anything possible in the UI is possible over MCP":**
   - no tools for sharing an app, keys, notification read marks, top-up requests, the operator log, employee memory or the dashboard;
   - `member_invite` never e-mails the code and returns it to the assistant;
   - not verified: an Owner's key probably cannot grant Admin, because it is capped at Admin.
10. **Edge wording:**
    - the share e-mail says choose "Create an account", but Edge's link says "Create your sign-in";
    - the access-denied page says "has not been shared with you" even for a private app.
11. **"Continue without a passkey" is hidden on shared apps**, although the server would admit a shared address.
12. **A member signing out from inside an app also ends their console session** and all app sessions (on the platform's host). It is a plain link with no confirmation.
13. **The operator log's normal-mode text** shows overdraft changes and top-up request decisions only as "Acted on the organisation".
14. **The God-mode band names the organisation you entered only on `/`.**
15. **Code lifetimes differ:** member invitations last 7 days, app shares 14 days. Neither screen says which.
16. **There is no "resend invitation" control.** Re-inviting is the only way to send a new code.
17. **Not verified:** an archived app, if still routed, shows anonymous visitors the "You are signed in…" refusal. A role-less account made by the development sign-in probably reaches a first-run screen whose naming step the server refuses.
