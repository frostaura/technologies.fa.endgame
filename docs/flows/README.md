# Every flow in Endgame

Everything a person, an operator, an app's end user, an AI assistant or the host's administrator can do in Endgame, each written as one flow from where it starts to where it truly ends. It is the source for the product documentation and for the academy.

**Read from the code, not from the other docs.** On 2026-11-25 five readers each took one area and read the screens, the endpoints, the assistant tools, the edge, the app kit and the Makefile end to end. Where a flow could not be settled from code it says *not verified from code*. Nothing was run to produce it, so a flow's steps are what the code does, not a recording of a session.

**321 flows** in five files:

| File | Covers | Flows |
| --- | --- | --- |
| [Identity and access](01-identity-and-access.md) | Signing in, people and roles, AI-assistant keys and MCP, opening apps as a member or end user, the shell. | 48 |
| [The organisation, home and conversations](02-organisation-home-and-conversations.md) | The home screen, the tree of divisions, projects and apps, the two graph views, conversations, notifications, system status. | 75 |
| [The factory](03-the-factory.md) | From an idea to a running app: ideas, research and the verdict, runs, plan, build, check, review, publish, autonomy and rule sets, changing an app. | 62 |
| [Workforce, credits and God mode](04-workforce-credits-and-god-mode.md) | Hiring, employees and contractors, employee memory, credits, budgets and the overdraft, the operator's screens. | 45 |
| [Apps, secrets, hosting and operations](05-apps-secrets-hosting-and-operations.md) | The app page, asking about an app, versions and export, sharing, secrets, what a hosted app can use, sleep and wake, running the platform. | 91 |

## How to read a flow

| Field | What it says |
| --- | --- |
| **Who** | The role that can do it. Roles: Viewer, Builder, Admin, Owner; operator is FrostAura in God mode. |
| **Starts at** | The screen and address, or the command. |
| **Needs** | What must already be true. |
| **Level** | Where it belongs in the academy (below). |
| **Learn first** | The flows a learner should have done before it. |
| **What you learn** | The one idea the flow teaches. |
| **Steps** | What the person does and what Endgame then shows, with on-screen words quoted exactly. |
| **You know it worked when** | What on screen confirms it. |
| **Variations and refusals** | Every other branch found: validation, permission refusals, empty states, limits. |
| **Where** | The screen file and the endpoint or assistant tool behind it. |
| **Reachable from** | A screen, or only the API, an assistant (MCP) or the command line. |
| **Covered by tests** | The tests that exercise it. |

## The academy path

Five tracks, each in the order the files give them. A lesson can only teach what has a screen, so each track lists the flows a learner can do in the console and counts the rest separately. The **Operator** track is FrostAura's own handbook and is not for clients.

### Foundation — 77 flows, 75 with a screen

What every person needs on day one: signing in, reading the home screen, starting an idea, reading a verdict, opening an app.

| Flow | What | Reached by | Area |
| --- | --- | --- | --- |
| ID-01 | Create the first passkey on a fresh install | Screen | [Identity and access](01-identity-and-access.md) |
| ID-02 | Sign in to the console with a passkey | Screen | [Identity and access](01-identity-and-access.md) |
| ID-04 | Arrive signed out at any console address | Screen | [Identity and access](01-identity-and-access.md) |
| ID-05 | Recover from a failed session check | Screen | [Identity and access](01-identity-and-access.md) |
| ID-06 | Sign out of the console | Screen | [Identity and access](01-identity-and-access.md) |
| ID-07 | Try to register without an invitation, or with one through the console | Screen | [Identity and access](01-identity-and-access.md) |
| ID-09 | See who you are and every role you hold, and switch organisation | Screen | [Identity and access](01-identity-and-access.md) |
| PPL-08 | Accept an invitation and register as an invited member | Screen | [Identity and access](01-identity-and-access.md) |
| ACC-01 | Open a private app as a member who has a role | Screen | [Identity and access](01-identity-and-access.md) |
| ACC-02 | Arrive signed out at a private or shared app | Screen | [Identity and access](01-identity-and-access.md) |
| ACC-03 | A member signs in at an app's sign-in page | Screen | [Identity and access](01-identity-and-access.md) |
| ACC-04 | Register at a shared app as an invited person | Screen | [Identity and access](01-identity-and-access.md) |
| ACC-05 | Register as an end user of a public app | Screen | [Identity and access](01-identity-and-access.md) |
| ACC-06 | An end user signs back in | Screen | [Identity and access](01-identity-and-access.md) |
| ACC-07 | Open a public app with no sign-in | Screen | [Identity and access](01-identity-and-access.md) |
| ACC-10 | Be refused at an app while signed in | Screen | [Identity and access](01-identity-and-access.md) |
| ACC-11 | Sign out of an app | Screen | [Identity and access](01-identity-and-access.md) |
| SHL-01 | Switch between normal and technical mode | Screen | [Identity and access](01-identity-and-access.md) |
| SHL-03 | Use the header and breadcrumbs | Screen | [Identity and access](01-identity-and-access.md) |
| SHL-04 | Skip to the content | Screen | [Identity and access](01-identity-and-access.md) |
| SHL-06 | Arrive at an unknown console address | Screen | [Identity and access](01-identity-and-access.md) |
| ORG-01 | Arrive with no organisation (first run) | Screen | [The organisation, home and conversations](02-organisation-home-and-conversations.md) |
| ORG-02 | Name the first organisation, together with the first idea | Screen | [The organisation, home and conversations](02-organisation-home-and-conversations.md) |
| ORG-03 | Arrive with no organisation once one already exists (refused self-sign-up) | Screen | [The organisation, home and conversations](02-organisation-home-and-conversations.md) |
| ORG-04 | Read the organisation band and the header | Screen | [The organisation, home and conversations](02-organisation-home-and-conversations.md) |
| ORG-05 | Read "needs you" and follow a card to its subject | Screen | [The organisation, home and conversations](02-organisation-home-and-conversations.md) |
| ORG-07 | Select a level, and go back up with the breadcrumb | Screen | [The organisation, home and conversations](02-organisation-home-and-conversations.md) |
| ORG-08 | Read a division on the chart | Screen | [The organisation, home and conversations](02-organisation-home-and-conversations.md) |
| ORG-09 | Read a project card and watch its work | Screen | [The organisation, home and conversations](02-organisation-home-and-conversations.md) |
| ORG-10 | Read an app row and open the app | Screen | [The organisation, home and conversations](02-organisation-home-and-conversations.md) |
| ORG-11 | Read the workforce on the chart | Screen | [The organisation, home and conversations](02-organisation-home-and-conversations.md) |
| ORG-12 | An empty organisation (no divisions yet) | Screen | [The organisation, home and conversations](02-organisation-home-and-conversations.md) |
| ONT-04 | Read either graph on a phone or with a screen reader | Screen | [The organisation, home and conversations](02-organisation-home-and-conversations.md) |
| TALK-01 | Talk to the whole organisation | Screen | [The organisation, home and conversations](02-organisation-home-and-conversations.md) |
| TALK-02 | Talk to a division | Screen | [The organisation, home and conversations](02-organisation-home-and-conversations.md) |
| TALK-03 | Talk to a project | Screen | [The organisation, home and conversations](02-organisation-home-and-conversations.md) |
| TALK-11 | Read what was said before, after a reload or a return visit | Screen | [The organisation, home and conversations](02-organisation-home-and-conversations.md) |
| NOTE-01 | See how many notices are unread | Screen | [The organisation, home and conversations](02-organisation-home-and-conversations.md) |
| NOTE-02 | Open the latest notices in place (desktop) | Screen | [The organisation, home and conversations](02-organisation-home-and-conversations.md) |
| NOTE-03 | Read the full feed | Screen | [The organisation, home and conversations](02-organisation-home-and-conversations.md) |
| NOTE-04 | Follow a notice to its subject | Screen | [The organisation, home and conversations](02-organisation-home-and-conversations.md) |
| NOTE-05 | Mark one notice read | Screen | [The organisation, home and conversations](02-organisation-home-and-conversations.md) |
| NOTE-06 | Mark every notice read | Screen | [The organisation, home and conversations](02-organisation-home-and-conversations.md) |
| NOTE-07 | An empty feed | Screen | [The organisation, home and conversations](02-organisation-home-and-conversations.md) |
| SYS-06 | Open an address that does not exist | Screen | [The organisation, home and conversations](02-organisation-home-and-conversations.md) |
| SYS-09 | The console opens, or cannot check who you are | Screen | [The organisation, home and conversations](02-organisation-home-and-conversations.md) |
| SYS-10 | Home fails to load | Screen | [The organisation, home and conversations](02-organisation-home-and-conversations.md) |
| IDEA-01 | Name your organisation and describe your first idea | Screen | [The factory](03-the-factory.md) |
| IDEA-02 | Describe a new idea in an existing organisation | Screen | [The factory](03-the-factory.md) |
| IDEA-03 | Read the research estimate before starting | Screen | [The factory](03-the-factory.md) |
| VERD-01 | Follow research live | Screen | [The factory](03-the-factory.md) |
| VERD-02 | Open an idea's verdict page | Screen | [The factory](03-the-factory.md) |
| VERD-03 | Read every section of a verdict | Screen | [The factory](03-the-factory.md) |
| VERD-05 | Build on a "build" verdict | Screen | [The factory](03-the-factory.md) |
| VERD-09 | Drop the idea | Screen | [The factory](03-the-factory.md) |
| VERD-10 | See research refuse an idea over a red line | Screen | [The factory](03-the-factory.md) |
| VERD-13 | Read a decision already taken | Screen | [The factory](03-the-factory.md) |
| RUN-01 | Open a run and follow it live | Screen | [The factory](03-the-factory.md) |
| RUN-02 | Read a run in normal mode | Screen | [The factory](03-the-factory.md) |
| BLD-10 | See the app published privately | Automatic | [The factory](03-the-factory.md) |
| CRED-01 | Read the balance, the pace and this month's spending | Screen | [Workforce, credits and God mode](04-workforce-credits-and-god-mode.md) |
| CRED-02 | Read spending and caps by level | Screen | [Workforce, credits and God mode](04-workforce-credits-and-god-mode.md) |
| CRED-08 | What happens at zero, at halfway and at the limit, and what a top-up restores | Automatic | [Workforce, credits and God mode](04-workforce-credits-and-god-mode.md) |
| APP-01 | Open an app's page | Screen | [Apps, secrets, hosting and operations](05-apps-secrets-hosting-and-operations.md) |
| APP-02 | Read the Health, Visits today, Typical response and Cost this month tiles | Screen | [Apps, secrets, hosting and operations](05-apps-secrets-hosting-and-operations.md) |
| APP-03 | Open the hosted app from its page | Screen | [Apps, secrets, hosting and operations](05-apps-secrets-hosting-and-operations.md) |
| ASK-04 | Ask something else | Screen | [Apps, secrets, hosting and operations](05-apps-secrets-hosting-and-operations.md) |
| SHR-01 | Read how to start sharing when an app is private or public | Screen | [Apps, secrets, hosting and operations](05-apps-secrets-hosting-and-operations.md) |
| SEC-07 | Move between levels on the secrets page | Screen | [Apps, secrets, hosting and operations](05-apps-secrets-hosting-and-operations.md) |
| KIT-01 | A member signs in to a private app (path address) | Screen | [Apps, secrets, hosting and operations](05-apps-secrets-hosting-and-operations.md) |
| KIT-03 | An invited person registers at a shared app with their code | Screen | [Apps, secrets, hosting and operations](05-apps-secrets-hosting-and-operations.md) |
| KIT-04 | A returning end user signs in with their passkey | Screen | [Apps, secrets, hosting and operations](05-apps-secrets-hosting-and-operations.md) |
| KIT-06 | A visitor opens a public app signed out | Screen | [Apps, secrets, hosting and operations](05-apps-secrets-hosting-and-operations.md) |
| KIT-07 | A signed-in person without access is refused | Screen | [Apps, secrets, hosting and operations](05-apps-secrets-hosting-and-operations.md) |
| KIT-08 | Sign out of an app | Screen | [Apps, secrets, hosting and operations](05-apps-secrets-hosting-and-operations.md) |
| HOST-01 | A sleeping app wakes on a visit | Screen | [Apps, secrets, hosting and operations](05-apps-secrets-hosting-and-operations.md) |
| HOST-06 | Reach an app at either of its two addresses | Screen | [Apps, secrets, hosting and operations](05-apps-secrets-hosting-and-operations.md) |

### Core — 124 flows, 114 with a screen

Running an organisation day to day: people, hiring, credits, the app page, secrets, notifications, autonomy.

| Flow | What | Reached by | Area |
| --- | --- | --- | --- |
| ID-08 | Add another passkey to your own account | Screen | [Identity and access](01-identity-and-access.md) |
| ID-10 | Read the operator access log | Screen | [Identity and access](01-identity-and-access.md) |
| PPL-01 | See the people at a level, and what each role may do | Screen | [Identity and access](01-identity-and-access.md) |
| PPL-02 | Switch the level being viewed | Screen | [Identity and access](01-identity-and-access.md) |
| PPL-03 | Invite a new person to a role | Screen | [Identity and access](01-identity-and-access.md) |
| PPL-04 | Grant a role to someone who already has a passkey | Screen | [Identity and access](01-identity-and-access.md) |
| PPL-05 | Send a fresh code to a pending invitee | Screen | [Identity and access](01-identity-and-access.md) |
| PPL-06 | Change someone's role | Screen | [Identity and access](01-identity-and-access.md) |
| PPL-07 | Remove someone's grant | Screen | [Identity and access](01-identity-and-access.md) |
| ACC-08 | Use the organisation-subdomain address | Screen | [Identity and access](01-identity-and-access.md) |
| ACC-09 | Follow an expired or failed sign-in link | Screen | [Identity and access](01-identity-and-access.md) |
| ACC-12 | Lose access when an app is unshared or made private | Screen | [Identity and access](01-identity-and-access.md) |
| ACC-14 | Visit a paused app | Screen | [Identity and access](01-identity-and-access.md) |
| ACC-15 | Visit a sleeping, slow, busy or crashed app | Screen | [Identity and access](01-identity-and-access.md) |
| ACC-16 | Visit an unpublished or unreachable app | Screen | [Identity and access](01-identity-and-access.md) |
| SHL-02 | Reach system status from normal mode | Screen | [Identity and access](01-identity-and-access.md) |
| ORG-06 | Use the shortcut row for the selected level | Screen | [The organisation, home and conversations](02-organisation-home-and-conversations.md) |
| ORG-13 | Home keeps itself live, and says when a refresh fails | Screen | [The organisation, home and conversations](02-organisation-home-and-conversations.md) |
| TREE-01 | Create a division by letting the factory place an idea | Screen | [The organisation, home and conversations](02-organisation-home-and-conversations.md) |
| TREE-05 | Put new work into an existing division | Screen | [The organisation, home and conversations](02-organisation-home-and-conversations.md) |
| TREE-13 | Manage a division from the console: what is actually there | Screen | [The organisation, home and conversations](02-organisation-home-and-conversations.md) |
| ONT-01 | Switch between the three views | Screen | [The organisation, home and conversations](02-organisation-home-and-conversations.md) |
| ONT-02 | Read "Who works on what" (desktop) | Screen | [The organisation, home and conversations](02-organisation-home-and-conversations.md) |
| ONT-03 | Read "How data flows" (desktop) | Screen | [The organisation, home and conversations](02-organisation-home-and-conversations.md) |
| ONT-05 | Open an employee or app from a graph | Screen | [The organisation, home and conversations](02-organisation-home-and-conversations.md) |
| ONT-06 | A graph that fails to load | Screen | [The organisation, home and conversations](02-organisation-home-and-conversations.md) |
| TALK-05 | Talk to an employee from the chart | Screen | [The organisation, home and conversations](02-organisation-home-and-conversations.md) |
| TALK-06 | Talk to an employee on their own page | Screen | [The organisation, home and conversations](02-organisation-home-and-conversations.md) |
| TALK-07 | Ask the conversation to start researching an idea | Screen | [The organisation, home and conversations](02-organisation-home-and-conversations.md) |
| TALK-09 | Decline what the conversation proposed | Screen | [The organisation, home and conversations](02-organisation-home-and-conversations.md) |
| TALK-10 | Ask the conversation for something it cannot do | Screen | [The organisation, home and conversations](02-organisation-home-and-conversations.md) |
| TALK-12 | See how a reply was reached | Screen | [The organisation, home and conversations](02-organisation-home-and-conversations.md) |
| TALK-13 | A message that is not sent | Screen | [The organisation, home and conversations](02-organisation-home-and-conversations.md) |
| TALK-14 | The reply's stream drops | Screen | [The organisation, home and conversations](02-organisation-home-and-conversations.md) |
| NOTE-08 | The feed fails to load | Screen | [The organisation, home and conversations](02-organisation-home-and-conversations.md) |
| NOTE-09 | Receive an urgent notice by e-mail | Automatic | [The organisation, home and conversations](02-organisation-home-and-conversations.md) |
| SYS-01 | Switch between normal and technical mode | Screen | [The organisation, home and conversations](02-organisation-home-and-conversations.md) |
| SYS-02 | Open system status in normal mode | Screen | [The organisation, home and conversations](02-organisation-home-and-conversations.md) |
| SYS-07 | A whole screen crashes | Screen | [The organisation, home and conversations](02-organisation-home-and-conversations.md) |
| SYS-08 | One panel crashes and the rest keeps working | Screen | [The organisation, home and conversations](02-organisation-home-and-conversations.md) |
| IDEA-04 | Start an idea with too few credits | Screen | [The factory](03-the-factory.md) |
| IDEA-05 | Start an idea by asking the docked conversation | Screen | [The factory](03-the-factory.md) |
| IDEA-07 | Ask for ideas from your portfolio | Screen | [The factory](03-the-factory.md) |
| IDEA-08 | Take a suggested idea into research | Screen | [The factory](03-the-factory.md) |
| IDEA-09 | Set a suggestion aside | Screen | [The factory](03-the-factory.md) |
| IDEA-10 | Review suggestions already taken or set aside | Screen | [The factory](03-the-factory.md) |
| VERD-04 | Read how often research says no, and how it was researched | Screen | [The factory](03-the-factory.md) |
| VERD-06 | Build a "change" verdict as described | Screen | [The factory](03-the-factory.md) |
| VERD-07 | Change the idea and have it researched again | Screen | [The factory](03-the-factory.md) |
| VERD-08 | Overrule a "do not build" | Screen | [The factory](03-the-factory.md) |
| VERD-11 | Let auto-mode decide after the verdict | Automatic | [The factory](03-the-factory.md) |
| VERD-12 | See that research did not finish | Screen | [The factory](03-the-factory.md) |
| RUN-04 | Pause a run | Screen | [The factory](03-the-factory.md) |
| RUN-05 | Resume a paused run | Screen | [The factory](03-the-factory.md) |
| RUN-06 | Cancel a run | Screen | [The factory](03-the-factory.md) |
| RUN-07 | Answer an approval a run is waiting on | Screen | [The factory](03-the-factory.md) |
| RUN-09 | See a run waiting for budget, and get it moving | Screen | [The factory](03-the-factory.md) |
| RUN-10 | See a run stop because the budget ran out mid-way | Screen | [The factory](03-the-factory.md) |
| RUN-11 | Read a failed run | Screen | [The factory](03-the-factory.md) |
| RUN-13 | Read what a run cost, and what was not charged | Screen | [The factory](03-the-factory.md) |
| RUN-14 | Follow the tasks of a run | Screen | [The factory](03-the-factory.md) |
| BLD-01 | See where the new app is placed | Automatic | [The factory](03-the-factory.md) |
| BLD-02 | See hires the factory proposes or makes | Screen | [The factory](03-the-factory.md) |
| BLD-03 | Read the plan: what you asked for, what was left out and why | Screen | [The factory](03-the-factory.md) |
| BLD-06 | Follow the build, one part at a time | Automatic | [The factory](03-the-factory.md) |
| BLD-07 | See each part checked in the running app | Automatic | [The factory](03-the-factory.md) |
| BLD-08 | See a failed part repaired, free, on a stronger model | Automatic | [The factory](03-the-factory.md) |
| BLD-09 | See the security review, and its one free fix | Automatic | [The factory](03-the-factory.md) |
| AUTO-01 | Read the autonomy in effect at a level | Screen | [The factory](03-the-factory.md) |
| AUTO-02 | Switch between auto-mode and checkpoints | Screen | [The factory](03-the-factory.md) |
| AUTO-03 | Turn a checkpoint on or off | Screen | [The factory](03-the-factory.md) |
| AUTO-04 | Go back to the inherited setting | Screen | [The factory](03-the-factory.md) |
| CHG-01 | Ask the conversation to change an app | Screen | [The factory](03-the-factory.md) |
| CHG-04 | Restore an earlier version | Screen | [The factory](03-the-factory.md) |
| HIRE-01 | Open the hiring screen for a part of the organisation | Screen | [Workforce, credits and God mode](04-workforce-credits-and-god-mode.md) |
| HIRE-02 | Read a hire proposal | Screen | [Workforce, credits and God mode](04-workforce-credits-and-god-mode.md) |
| HIRE-03 | Approve (hire) a proposal | Screen | [Workforce, credits and God mode](04-workforce-credits-and-god-mode.md) |
| HIRE-04 | Decline a proposal | Screen | [Workforce, credits and God mode](04-workforce-credits-and-god-mode.md) |
| HIRE-05 | Change a proposal before deciding | Screen | [Workforce, credits and God mode](04-workforce-credits-and-god-mode.md) |
| HIRE-06 | A hire made automatically in auto-mode | Automatic | [Workforce, credits and God mode](04-workforce-credits-and-god-mode.md) |
| EMP-01 | Read an employee's record | Screen | [Workforce, credits and God mode](04-workforce-credits-and-god-mode.md) |
| EMP-03 | Change or remove an employee's monthly budget | Screen | [Workforce, credits and God mode](04-workforce-credits-and-god-mode.md) |
| EMP-04 | Pause and resume an employee | Screen | [Workforce, credits and God mode](04-workforce-credits-and-god-mode.md) |
| EMP-05 | Let an employee go | Screen | [Workforce, credits and God mode](04-workforce-credits-and-god-mode.md) |
| EMP-06 | Deal with an idle employee | Screen | [Workforce, credits and God mode](04-workforce-credits-and-god-mode.md) |
| EMP-07 | See contractors and who reports to an employee | Screen | [Workforce, credits and God mode](04-workforce-credits-and-god-mode.md) |
| EMP-08 | Talk to an employee | Screen | [Workforce, credits and God mode](04-workforce-credits-and-god-mode.md) |
| EMP-09 | Rehire a former employee | Screen | [Workforce, credits and God mode](04-workforce-credits-and-god-mode.md) |
| MEM-01 | Read what an employee remembers | Screen | [Workforce, credits and God mode](04-workforce-credits-and-god-mode.md) |
| MEM-02 | Add something an employee should know | Screen | [Workforce, credits and God mode](04-workforce-credits-and-god-mode.md) |
| MEM-03 | Correct a memory entry | Screen | [Workforce, credits and God mode](04-workforce-credits-and-god-mode.md) |
| MEM-04 | Remove a memory entry | Screen | [Workforce, credits and God mode](04-workforce-credits-and-god-mode.md) |
| CRED-04 | Read estimates against cost, and what was not charged | Screen | [Workforce, credits and God mode](04-workforce-credits-and-god-mode.md) |
| CRED-07 | Ask FrostAura for a top-up | Screen | [Workforce, credits and God mode](04-workforce-credits-and-god-mode.md) |
| CRED-09 | How AI work and hosting become spending | Automatic | [Workforce, credits and God mode](04-workforce-credits-and-god-mode.md) |
| OP-10 | The Owner reads the operator log | Screen | [Workforce, credits and God mode](04-workforce-credits-and-god-mode.md) |
| APP-04 | Choose how the app runs: Sleeps when unused or Always on | Screen | [Apps, secrets, hosting and operations](05-apps-secrets-hosting-and-operations.md) |
| APP-06 | Make the app private or shared | Screen | [Apps, secrets, hosting and operations](05-apps-secrets-hosting-and-operations.md) |
| APP-07 | Make the app public, which only a person can do | Screen | [Apps, secrets, hosting and operations](05-apps-secrets-hosting-and-operations.md) |
| APP-08 | Read "What it uses" | Screen | [Apps, secrets, hosting and operations](05-apps-secrets-hosting-and-operations.md) |
| APP-09 | See the secrets an app can read, from its page | Screen | [Apps, secrets, hosting and operations](05-apps-secrets-hosting-and-operations.md) |
| ASK-01 | See what a question will cost before asking it | Screen | [Apps, secrets, hosting and operations](05-apps-secrets-hosting-and-operations.md) |
| ASK-02 | Ask the question and read the answer and its chart | Screen | [Apps, secrets, hosting and operations](05-apps-secrets-hosting-and-operations.md) |
| ASK-03 | Keep an answer on the dashboard | Screen | [Apps, secrets, hosting and operations](05-apps-secrets-hosting-and-operations.md) |
| ASK-05 | Read the dashboard | Screen | [Apps, secrets, hosting and operations](05-apps-secrets-hosting-and-operations.md) |
| ASK-06 | Take a question off the dashboard | Screen | [Apps, secrets, hosting and operations](05-apps-secrets-hosting-and-operations.md) |
| VER-01 | Read an app's version history | Screen | [Apps, secrets, hosting and operations](05-apps-secrets-hosting-and-operations.md) |
| VER-02 | Bring an earlier version back | Screen | [Apps, secrets, hosting and operations](05-apps-secrets-hosting-and-operations.md) |
| VER-03 | Download everything (the export) | Screen | [Apps, secrets, hosting and operations](05-apps-secrets-hosting-and-operations.md) |
| SHR-02 | See who a shared app is shared with | Screen | [Apps, secrets, hosting and operations](05-apps-secrets-hosting-and-operations.md) |
| SHR-03 | Invite an e-mail address | Screen | [Apps, secrets, hosting and operations](05-apps-secrets-hosting-and-operations.md) |
| SHR-04 | Stop sharing with someone | Screen | [Apps, secrets, hosting and operations](05-apps-secrets-hosting-and-operations.md) |
| SEC-01 | Open the secrets that apply at a level | Screen | [Apps, secrets, hosting and operations](05-apps-secrets-hosting-and-operations.md) |
| SEC-02 | Read what applies here and where it was set | Screen | [Apps, secrets, hosting and operations](05-apps-secrets-hosting-and-operations.md) |
| SEC-03 | Add a secret | Screen | [Apps, secrets, hosting and operations](05-apps-secrets-hosting-and-operations.md) |
| SEC-04 | Replace a secret set at this level | Screen | [Apps, secrets, hosting and operations](05-apps-secrets-hosting-and-operations.md) |
| SEC-06 | Remove a secret | Screen | [Apps, secrets, hosting and operations](05-apps-secrets-hosting-and-operations.md) |
| KIT-02 | Sign in on the organisation subdomain, through a hand-off | Screen | [Apps, secrets, hosting and operations](05-apps-secrets-hosting-and-operations.md) |
| KIT-05 | Anyone signs up to a public app | Screen | [Apps, secrets, hosting and operations](05-apps-secrets-hosting-and-operations.md) |
| HOST-02 | A wake that cannot complete | Screen | [Apps, secrets, hosting and operations](05-apps-secrets-hosting-and-operations.md) |
| HOST-03 | An app paused because a budget is spent | Screen | [Apps, secrets, hosting and operations](05-apps-secrets-hosting-and-operations.md) |
| HOST-04 | An app paused at the overdraft limit | Screen | [Apps, secrets, hosting and operations](05-apps-secrets-hosting-and-operations.md) |
| HOST-05 | A crashed app | Screen | [Apps, secrets, hosting and operations](05-apps-secrets-hosting-and-operations.md) |
| HOST-07 | An idle app goes to sleep | Automatic | [Apps, secrets, hosting and operations](05-apps-secrets-hosting-and-operations.md) |

### Advanced — 39 flows, 23 with a screen

For the person who owns the setup: rule sets, tighter limits, assistants, technical mode.

| Flow | What | Reached by | Area |
| --- | --- | --- | --- |
| AST-01 | Open the AI assistants screen and copy the addresses | Screen | [Identity and access](01-identity-and-access.md) |
| AST-02 | Make a key for an assistant | Screen | [Identity and access](01-identity-and-access.md) |
| AST-03 | See and revoke keys | Screen | [Identity and access](01-identity-and-access.md) |
| AST-04 | What a key can never do | API or assistant only | [Identity and access](01-identity-and-access.md) |
| AST-05 | Connect an assistant to the whole organisation | API or assistant only | [Identity and access](01-identity-and-access.md) |
| AST-06 | Connect an assistant to one app | API or assistant only | [Identity and access](01-identity-and-access.md) |
| ORG-19 | A person granted only part of the tree uses home | Screen | [The organisation, home and conversations](02-organisation-home-and-conversations.md) |
| TREE-07 | Archive or reactivate a division or project | API or assistant only | [The organisation, home and conversations](02-organisation-home-and-conversations.md) |
| TREE-11 | Describe a level: set context that its work inherits | API or assistant only | [The organisation, home and conversations](02-organisation-home-and-conversations.md) |
| TREE-12 | Read what applies at a level, and remove a value set there | API or assistant only | [The organisation, home and conversations](02-organisation-home-and-conversations.md) |
| TALK-08 | Ask the conversation to change a setting at this level | Screen | [The organisation, home and conversations](02-organisation-home-and-conversations.md) |
| TALK-15 | Talk when credits, a budget or the model connection run out | Screen | [The organisation, home and conversations](02-organisation-home-and-conversations.md) |
| SYS-03 | Read system status | Screen | [The organisation, home and conversations](02-organisation-home-and-conversations.md) |
| SYS-04 | System status cannot be read, or reads oddly | Screen | [The organisation, home and conversations](02-organisation-home-and-conversations.md) |
| RUN-03 | Read a run in technical mode | Screen | [The factory](03-the-factory.md) |
| RUN-08 | Approve the estimate before work starts | Screen | [The factory](03-the-factory.md) |
| RUN-12 | See a run recover after the Runner was interrupted | No route | [The factory](03-the-factory.md) |
| BLD-04 | Approve or reject the plan | Screen | [The factory](03-the-factory.md) |
| BLD-05 | See the build re-estimated from the plan | Automatic | [The factory](03-the-factory.md) |
| BLD-11 | See an operations hire for a recurring job | Automatic | [The factory](03-the-factory.md) |
| AUTO-05 | Set rules for a stage | Screen | [The factory](03-the-factory.md) |
| AUTO-06 | Remove the rules set here | Screen | [The factory](03-the-factory.md) |
| AUTO-07 | Change autonomy by asking the conversation | Screen | [The factory](03-the-factory.md) |
| CHG-02 | Describe a new idea about an existing app | Screen | [The factory](03-the-factory.md) |
| HIRE-07 | Propose a recurring contractor role as a permanent hire | Screen | [Workforce, credits and God mode](04-workforce-credits-and-god-mode.md) |
| HIRE-08 | A recurring role is proposed automatically when a contractor finishes | Automatic | [Workforce, credits and God mode](04-workforce-credits-and-god-mode.md) |
| EMP-02 | Reassign an employee | Screen | [Workforce, credits and God mode](04-workforce-credits-and-god-mode.md) |
| MEM-05 | Start a memory review | Screen | [Workforce, credits and God mode](04-workforce-credits-and-god-mode.md) |
| CRED-05 | Set the organisation's own overdraft limit | Screen | [Workforce, credits and God mode](04-workforce-credits-and-god-mode.md) |
| CRED-06 | Hold a division, project or app to a tighter limit | Screen | [Workforce, credits and God mode](04-workforce-credits-and-god-mode.md) |
| APP-05 | Set how many idle minutes pass before the app sleeps | API or assistant only | [Apps, secrets, hosting and operations](05-apps-secrets-hosting-and-operations.md) |
| APP-10 | Read "Underneath" in technical mode | Screen | [Apps, secrets, hosting and operations](05-apps-secrets-hosting-and-operations.md) |
| APP-11 | Set an app's own monthly credit cap | API or assistant only | [Apps, secrets, hosting and operations](05-apps-secrets-hosting-and-operations.md) |
| APP-12 | Set an app's own AI allowance | API or assistant only | [Apps, secrets, hosting and operations](05-apps-secrets-hosting-and-operations.md) |
| APP-13 | Rename or archive an app | API or assistant only | [Apps, secrets, hosting and operations](05-apps-secrets-hosting-and-operations.md) |
| APP-14 | Delete an app | API or assistant only | [Apps, secrets, hosting and operations](05-apps-secrets-hosting-and-operations.md) |
| ASK-07 | See the query and what failed, in technical mode | Screen | [Apps, secrets, hosting and operations](05-apps-secrets-hosting-and-operations.md) |
| SEC-05 | Override an inherited secret at a lower level | Screen | [Apps, secrets, hosting and operations](05-apps-secrets-hosting-and-operations.md) |
| KIT-20 | An AI assistant uses an app's own derived MCP tools | API or assistant only | [Apps, secrets, hosting and operations](05-apps-secrets-hosting-and-operations.md) |

### Developer — 40 flows, 3 with a screen

Through the API, an AI assistant or the app kit. Not console lessons.

| Flow | What | Reached by | Area |
| --- | --- | --- | --- |
| ID-03 | Use the development sign-in | Screen | [Identity and access](01-identity-and-access.md) |
| ACC-13 | Use the development sign-in at an app | Screen | [Identity and access](01-identity-and-access.md) |
| ORG-14 | Rename the organisation | API or assistant only | [The organisation, home and conversations](02-organisation-home-and-conversations.md) |
| ORG-16 | Delete the organisation | API or assistant only | [The organisation, home and conversations](02-organisation-home-and-conversations.md) |
| TREE-02 | Create a division directly | API or assistant only | [The organisation, home and conversations](02-organisation-home-and-conversations.md) |
| TREE-03 | Create a project directly | API or assistant only | [The organisation, home and conversations](02-organisation-home-and-conversations.md) |
| TREE-04 | Create an app node directly | API or assistant only | [The organisation, home and conversations](02-organisation-home-and-conversations.md) |
| TREE-06 | Rename a division, project or app | API or assistant only | [The organisation, home and conversations](02-organisation-home-and-conversations.md) |
| TREE-08 | Archive an app, or set an app's status by hand | API or assistant only | [The organisation, home and conversations](02-organisation-home-and-conversations.md) |
| TREE-09 | Delete a division, project or app | API or assistant only | [The organisation, home and conversations](02-organisation-home-and-conversations.md) |
| ONT-07 | Read the ontology by API or MCP | API or assistant only | [The organisation, home and conversations](02-organisation-home-and-conversations.md) |
| TALK-04 | Talk to an app | API or assistant only | [The organisation, home and conversations](02-organisation-home-and-conversations.md) |
| TALK-16 | Talk over MCP or the API | API or assistant only | [The organisation, home and conversations](02-organisation-home-and-conversations.md) |
| NOTE-10 | Read notices over MCP | API or assistant only | [The organisation, home and conversations](02-organisation-home-and-conversations.md) |
| SYS-05 | Read system status by API | API or assistant only | [The organisation, home and conversations](02-organisation-home-and-conversations.md) |
| IDEA-06 | Submit an idea to a division by API or MCP | API or assistant only | [The factory](03-the-factory.md) |
| CHG-05 | Give an employee a task on an app (internal only) | Automatic | [The factory](03-the-factory.md) |
| HIRE-09 | Ask for a new hire of your own choosing | API or assistant only | [Workforce, credits and God mode](04-workforce-credits-and-god-mode.md) |
| EMP-10 | Change an employee's name, role, mandate, tools, services, thinking power or manager | API or assistant only | [Workforce, credits and God mode](04-workforce-credits-and-god-mode.md) |
| MEM-06 | The employee writes and reads its own memory | Automatic | [Workforce, credits and God mode](04-workforce-credits-and-god-mode.md) |
| CRED-03 | Set, change or remove a monthly cap at a level | API or assistant only | [Workforce, credits and God mode](04-workforce-credits-and-god-mode.md) |
| KIT-09 | Use the development sign-in (development stacks only) | Screen | [Apps, secrets, hosting and operations](05-apps-secrets-hosting-and-operations.md) |
| KIT-10 | An app knows who is signed in, and their role | API or assistant only | [Apps, secrets, hosting and operations](05-apps-secrets-hosting-and-operations.md) |
| KIT-11 | An app keeps its own data | Command line | [Apps, secrets, hosting and operations](05-apps-secrets-hosting-and-operations.md) |
| KIT-12 | An app sends e-mail | API or assistant only | [Apps, secrets, hosting and operations](05-apps-secrets-hosting-and-operations.md) |
| KIT-13 | An app calls a model within its AI allowance | API or assistant only | [Apps, secrets, hosting and operations](05-apps-secrets-hosting-and-operations.md) |
| KIT-14 | An app reads a secret by name | API or assistant only | [Apps, secrets, hosting and operations](05-apps-secrets-hosting-and-operations.md) |
| KIT-15 | An app records telemetry, automatic and custom | API or assistant only | [Apps, secrets, hosting and operations](05-apps-secrets-hosting-and-operations.md) |
| KIT-16 | An app runs a recurring job on a schedule | API or assistant only | [Apps, secrets, hosting and operations](05-apps-secrets-hosting-and-operations.md) |
| KIT-17 | An outside device posts to a signed (HMAC) webhook | API or assistant only | [Apps, secrets, hosting and operations](05-apps-secrets-hosting-and-operations.md) |
| KIT-18 | A simple device posts to a shared-token webhook | API or assistant only | [Apps, secrets, hosting and operations](05-apps-secrets-hosting-and-operations.md) |
| KIT-19 | Unsigned or undeclared webhook calls are refused | API or assistant only | [Apps, secrets, hosting and operations](05-apps-secrets-hosting-and-operations.md) |
| KIT-21 | A developer builds an app on the kit by hand | Command line | [Apps, secrets, hosting and operations](05-apps-secrets-hosting-and-operations.md) |
| KIT-22 | A developer works on the kit itself | Command line | [Apps, secrets, hosting and operations](05-apps-secrets-hosting-and-operations.md) |
| OPS-04 | Lint everything | Command line | [Apps, secrets, hosting and operations](05-apps-secrets-hosting-and-operations.md) |
| OPS-05 | Build everything | Command line | [Apps, secrets, hosting and operations](05-apps-secrets-hosting-and-operations.md) |
| OPS-06 | Run the test suites | Command line | [Apps, secrets, hosting and operations](05-apps-secrets-hosting-and-operations.md) |
| OPS-09 | Run the merged-stack acceptance test | Command line | [Apps, secrets, hosting and operations](05-apps-secrets-hosting-and-operations.md) |
| OPS-10 | Run the factory proof with live models (opt-in, spends money) | Command line | [Apps, secrets, hosting and operations](05-apps-secrets-hosting-and-operations.md) |
| OPS-11 | Run the first version's acceptance tests with live models (opt-in) | Command line | [Apps, secrets, hosting and operations](05-apps-secrets-hosting-and-operations.md) |

### Operator — 36 flows, 13 with a screen

FrostAura only: God mode, provisioning and topping up organisations, prices, backups, Cloudflare, deploying.

| Flow | What | Reached by | Area |
| --- | --- | --- | --- |
| ID-11 | Set who is an operator, and whether the development sign-in can exist | Command line | [Identity and access](01-identity-and-access.md) |
| SHL-05 | Recognise God mode | Screen | [Identity and access](01-identity-and-access.md) |
| ORG-15 | Suspend or reinstate an organisation | API or assistant only | [The organisation, home and conversations](02-organisation-home-and-conversations.md) |
| ORG-17 | An operator with no organisation of their own lands in God mode | Screen | [The organisation, home and conversations](02-organisation-home-and-conversations.md) |
| ORG-18 | An operator reads an entered organisation's home | Screen | [The organisation, home and conversations](02-organisation-home-and-conversations.md) |
| OP-01 | Know you are in God mode, and what a non-operator sees | Screen | [Workforce, credits and God mode](04-workforce-credits-and-god-mode.md) |
| OP-02 | See every organisation | Screen | [Workforce, credits and God mode](04-workforce-credits-and-god-mode.md) |
| OP-03 | Set up an organisation for an invited Owner | Screen | [Workforce, credits and God mode](04-workforce-credits-and-god-mode.md) |
| OP-04 | Enter an organisation in God mode, and act there as Admin | Screen | [Workforce, credits and God mode](04-workforce-credits-and-god-mode.md) |
| OP-05 | Top up an organisation | Screen | [Workforce, credits and God mode](04-workforce-credits-and-god-mode.md) |
| OP-06 | Answer a top-up request | Screen | [Workforce, credits and God mode](04-workforce-credits-and-god-mode.md) |
| OP-07 | Set an organisation's deepest overdraft | Screen | [Workforce, credits and God mode](04-workforce-credits-and-god-mode.md) |
| OP-08 | Read every top-up made | Screen | [Workforce, credits and God mode](04-workforce-credits-and-god-mode.md) |
| OP-09 | Change the prices, and read the change history | Screen | [Workforce, credits and God mode](04-workforce-credits-and-god-mode.md) |
| OP-11 | Suspend or reinstate an organisation | API or assistant only | [Workforce, credits and God mode](04-workforce-credits-and-god-mode.md) |
| HOST-08 | A visitor sees the outage page when the machine is unreachable | Screen | [Apps, secrets, hosting and operations](05-apps-secrets-hosting-and-operations.md) |
| OPS-01 | Start the local stack | Command line | [Apps, secrets, hosting and operations](05-apps-secrets-hosting-and-operations.md) |
| OPS-02 | Stop the local stack, keeping or wiping its data | Command line | [Apps, secrets, hosting and operations](05-apps-secrets-hosting-and-operations.md) |
| OPS-03 | Build the images without starting them | Command line | [Apps, secrets, hosting and operations](05-apps-secrets-hosting-and-operations.md) |
| OPS-07 | The smoke test through the edge | Command line | [Apps, secrets, hosting and operations](05-apps-secrets-hosting-and-operations.md) |
| OPS-08 | Check the production stack file | Command line | [Apps, secrets, hosting and operations](05-apps-secrets-hosting-and-operations.md) |
| OPS-12 | Take a backup now | Command line | [Apps, secrets, hosting and operations](05-apps-secrets-hosting-and-operations.md) |
| OPS-13 | Nightly backups (automatic) | Automatic | [Apps, secrets, hosting and operations](05-apps-secrets-hosting-and-operations.md) |
| OPS-14 | List the backups | Command line | [Apps, secrets, hosting and operations](05-apps-secrets-hosting-and-operations.md) |
| OPS-15 | Verify a backup | Command line | [Apps, secrets, hosting and operations](05-apps-secrets-hosting-and-operations.md) |
| OPS-16 | Restore a backup | Command line | [Apps, secrets, hosting and operations](05-apps-secrets-hosting-and-operations.md) |
| OPS-17 | Rehearse a restore | Command line | [Apps, secrets, hosting and operations](05-apps-secrets-hosting-and-operations.md) |
| OPS-18 | Check the ops service's health | Command line | [Apps, secrets, hosting and operations](05-apps-secrets-hosting-and-operations.md) |
| OPS-19 | List the reserved host names | Command line | [Apps, secrets, hosting and operations](05-apps-secrets-hosting-and-operations.md) |
| OPS-20 | Plan the Cloudflare changes (dry run) | Command line | [Apps, secrets, hosting and operations](05-apps-secrets-hosting-and-operations.md) |
| OPS-21 | Apply the Cloudflare plan | Command line | [Apps, secrets, hosting and operations](05-apps-secrets-hosting-and-operations.md) |
| OPS-22 | Finish the Cloudflare setup in the dashboard by hand | Automatic | [Apps, secrets, hosting and operations](05-apps-secrets-hosting-and-operations.md) |
| OPS-23 | CI publishes the images | Automatic | [Apps, secrets, hosting and operations](05-apps-secrets-hosting-and-operations.md) |
| OPS-24 | First deploy on Portainer | Automatic | [Apps, secrets, hosting and operations](05-apps-secrets-hosting-and-operations.md) |
| OPS-25 | Redeploy automatically or by hand | Automatic | [Apps, secrets, hosting and operations](05-apps-secrets-hosting-and-operations.md) |
| OPS-26 | Go back to an earlier release | API or assistant only | [Apps, secrets, hosting and operations](05-apps-secrets-hosting-and-operations.md) |

### Not placed in a track — 5

Flows that do not exist yet or are purely automatic.

| Flow | What | Reached by | Area |
| --- | --- | --- | --- |
| AST-07 to AST-16 | What the assistant can do, by capability | API or assistant only | [Identity and access](01-identity-and-access.md) |
| TREE-10 | Move a division, project or app | No route | [The organisation, home and conversations](02-organisation-home-and-conversations.md) |
| BLD-12 | Design (icons and brand assets): not present | No route | [The factory](03-the-factory.md) |
| CHG-03 | Build again after a failed, cancelled or rejected build | No route | [The factory](03-the-factory.md) |
| CHG-06 | Change how an app runs or who may open it | API or assistant only | [The factory](03-the-factory.md) |

## What has no screen

| Reached by | Flows |
| --- | --- |
| Screen | 228 |
| API or assistant only | 43 |
| Command line | 24 |
| Automatic | 22 |
| No route | 4 |

## What the reading found

Each area file ends with its own full list of gaps and oddities. These are the ones that change what the product can be said to do. *Confirmed* means the orchestrator checked the code as well; *reported* means one reader found it and it has not been checked a second time.

### Fixed since the reading

| What | Flow | Status |
| --- | --- | --- |
| An invited person could not register: the sign-in screen had no field for the invitation code. | ID-07, PPL-08 | Fixed the same day; both flows now describe the screen with the field. |
| No second passkey, no way to switch organisation, and the address asked for was lost at sign-in. | ID-08, ID-09, ID-02 | Fixed: "Your account", the "Working in" switcher, and the kept address. |
| The console and the server disagreed on a person's role where grants at two levels differ. | PPL-01, PPL-03 | Fixed: the tree carries each node's role as the server resolves it. |
| Signing out left a blank page. | ID-06 | Fixed the same day, found in a browser. |

### Things the product cannot do from a screen

| What | Flows | Status |
| --- | --- | --- |
| **Change an app after it is built.** No screen, endpoint or assistant tool asks the factory to change an existing app. The Runner has a workflow that edits an app's code; nothing a person can reach starts it, and it does not republish. | CHG-01, CHG-02, CHG-05 | Confirmed |
| **Try again.** A failed or cancelled build, a rejected plan and a failed research run cannot be restarted, though several messages say they can. | CHG-03, VERD-12, RUN-10, RUN-11 | Confirmed |
| **Create, rename, archive or delete a division, project or app.** They appear when the factory places a built idea, or through the API or an assistant. Nothing can be moved by any route. | TREE-02 to TREE-10, TREE-13, ORG-14 | Confirmed |
| **Set a budget cap** at any level, or an app's own. Caps are shown and enforced; they can only be set through the API or an assistant. | CRED-03, APP-11, APP-12 | Confirmed |
| **Describe a level.** Context is set only through the API or an assistant. | TREE-11 | Reported |
| **Choose the division for a new idea** on the start screen. | IDEA-02, TREE-01 | Reported |
| **Talk to an app**, or answer a conversation's own approval inside the conversation. | TALK-04, TALK-07 | Reported |
| **Edit an employee** (name, role, mandate, tools, manager), raise a hire by hand, list released employees. | EMP-10, HIRE-09, EMP-09 | Reported |

### Things that do not do what the screen says

| What | Flows | Status |
| --- | --- | --- |
| **God mode follows the operator only onto the org chart.** Credits, Hiring, People, Secrets and the rest read the operator's own organisation. | OP-04 | Confirmed |
| **Setting up an organisation does not screen it against the red lines**, though the form says so and the project's rule 4 requires it. Only its name is checked. | OP-03 | Confirmed |
| **Talking to an employee is not answered by that employee.** The same general assistant answers, without the employee's memory or job; only the cost is charged to them. | TALK-05, TALK-06 | Confirmed |
| **Pausing an employee does not stop it being given work.** | EMP-04 | Reported |
| **After "Change the idea", the second verdict has no decision buttons**, and the requested change never reaches the build, which plans from the original wording. | VERD-06, VERD-07, VERD-11 | Reported |
| **"Asks you first" rules refuse instead of asking.** | AUTO-05 | Reported |
| **Two lines on the start screen are untrue in auto-mode:** "Nothing is built until you have seen the verdict", and that hires are "proposed". | IDEA-01, VERD-11, BLD-02 | Reported |
| **A conversation at a level is shared by everyone there**, each message drawn as "you". | TALK-11 | Reported |
| **A person granted only one division gets "not found" on the home screen.** | ORG-19 | Reported |
| **The system status endpoint answers without sign-in.** | SYS-05 | Confirmed |
| **Archiving a division or project does not stop its apps being served.** | TREE-07 | Reported |
| **The console's mock-API browser specs are run by nothing** in the Makefile or CI; only the smoke spec runs. | OPS-07 | Reported |
| **The design stage in the spec does not exist** as a stage in the build. | BLD-12 | Reported |

### What an AI assistant cannot do that the console can

Sharing an app, keys, marking notifications read, top-up requests, the operator log, an employee's memory, the app dashboard, dismissing a suggestion. Export, the overdraft and top-ups are absent on purpose. (AST-07 to AST-16.)

