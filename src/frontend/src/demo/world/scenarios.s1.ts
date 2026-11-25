import { IDS, ORG, PEOPLE } from "./default";
import { defineScenario, scenarioNamed, type Featured } from "./scenarios";
import { uuidFor, type World } from "../server/world";

/**
 * Scenarios for the identity-and-access flows (docs/flows/01-identity-and-access.md): apps in each
 * state a visitor meets at the Edge, a session check that fails, and the limits on assistant keys.
 * Registered by one import in `host.ts` (not `scenarios.ts`: this file calls its `defineScenario`,
 * so it must run after it); the names carry `s1-` so another file's scenarios never collide.
 */

const FEATURED: Featured = { idea: IDS.ideaAllergen, run: IDS.runBuildReadingList, app: IDS.tableBookings, employee: uuidFor(`employee:${ORG}/technologies/court-booking:engineer`), hire: uuidFor("hire:analyst") };

const appOf = (w: World, id: string) => w.apps.find((a) => a.id === id);

defineScenario({
  name: "s1-app-public",
  title: "Tutor Match is public: anyone may open it",
  apply: (w) => {
    const a = appOf(w, IDS.tutorMatch);
    if (a) a.access = "public";
  },
  route: "/__app/{app}/path/",
  featured: { ...FEATURED, app: IDS.tutorMatch },
  persona: "signed-out",
});

defineScenario({
  name: "s1-app-private",
  title: "Tutor Match is private: members with a role only",
  route: "/__app/{app}/path/",
  featured: { ...FEATURED, app: IDS.tutorMatch },
  persona: "signed-out",
});

defineScenario({
  name: "s1-app-not-published",
  title: "Tutor Match has an address but no published version yet",
  apply: (w) => {
    const a = appOf(w, IDS.tutorMatch);
    if (a) Object.assign(a, { status: "building", publishedAt: null, healthSummary: "Not published yet." });
  },
  route: "/__app/{app}/path/",
  featured: { ...FEATURED, app: IDS.tutorMatch },
});

defineScenario({
  name: "s1-app-unshared",
  title: "Court booking is no longer shared with its end users",
  apply: (w) => {
    w.shares = w.shares.filter((s) => !(s.appId === IDS.tableBookings && s.registered));
    const a = appOf(w, IDS.tableBookings);
    if (a) a.endUsers = 0;
  },
  route: "/__app/{app}/path/",
  featured: FEATURED,
  persona: "end-user",
});

defineScenario({
  name: "s1-app-made-private",
  title: "Court booking was made private after it was shared",
  apply: (w) => {
    const a = appOf(w, IDS.tableBookings);
    if (a) a.access = "private";
  },
  route: "/__app/{app}/path/",
  featured: FEATURED,
  persona: "end-user",
});

defineScenario({
  name: "s1-session-check-fails",
  title: "The control plane does not answer the first session check",
  apply: (w) => (w.sessionCheckFailures = 1),
  route: "/",
  featured: FEATURED,
});

defineScenario({
  name: "s1-keys-at-limit",
  title: "Mara already holds 50 live assistant keys",
  apply: (w) => {
    const live = w.tokens.filter((t) => t.userId === PEOPLE.owner.id && !t.revokedAt).length;
    const at = new Date(Date.now() - 3 * 86_400_000).toISOString();
    for (let i = live; i < 50; i++)
      w.tokens.push({ userId: PEOPLE.owner.id, id: uuidFor(`token:bulk:${i}`), name: `Build agent ${i + 1}`, organisation: ORG, role: "builder", prefix: `egp_b${String(i).padStart(3, "0")}`, createdAt: at, expiresAt: null, lastUsedAt: null, revokedAt: null, active: true });
  },
  route: "/assistants",
  featured: FEATURED,
  persona: "owner",
});

defineScenario({
  name: "s1-development-sign-in",
  title: "A development deployment on a fresh install: the development sign-in is offered",
  apply: (w) => {
    scenarioNamed("fresh-install")?.apply?.(w);
    // ENDGAME_DEV_USER_EMAIL, as a development stack sets it.
    w.developmentSignIn = { email: "dev@northwind.example" };
  },
  route: "/sign-in",
  persona: "signed-out",
});

defineScenario({
  name: "s1-development-apps",
  title: "A development deployment with Northwind's apps: the apps' pages offer the development sign-in",
  apply: (w) => (w.developmentSignIn = { email: "dev@northwind.example" }),
  route: "/__app/{app}/path/_endgame/auth/sign-in",
  featured: FEATURED,
  persona: "signed-out",
});
