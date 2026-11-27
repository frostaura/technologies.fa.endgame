import { IDS, ORG, PEOPLE } from "./default";
import { defineScenario } from "./scenarios";
import { uuidFor, type World } from "../server/world";
import { titleOf } from "../server/http";
import type { Idea } from "@/store/types";

/**
 * Verdict and idea pages in the states the default world does not show (docs/flows/03-the-factory.md):
 * a verdict already decided — dropped, overruled, built — and a verdict as real research writes one,
 * long and messy: a 200-character idea, a two-line headline, a summary in several paragraphs, 21
 * products already sold, 41 sources (some with very long addresses), 14 signals of demand and four
 * earlier overrules. The suggestions page with real-sized cards, many of them, and a long division name
 * is here too. Each edits the default world; `host.ts` imports this file after `scenarios.ts`.
 */

export const VERDICTS = {
  ideaLong: uuidFor("idea:verdicts:long"),
  ideaLongRedLine: uuidFor("idea:verdicts:long-red-line"),
};

const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();
const idea = (w: World, id: string) => w.ideas.find((i) => i.id === id);

/** A finished research run for an idea added here, cloned from one the default world already holds. */
function researchRunFor(w: World, from: string, i: Idea) {
  const source = w.runs.find((r) => r.run.ideaId === from && r.run.kind === "research");
  if (!source) return;
  const copy = JSON.parse(JSON.stringify(source)) as typeof source;
  copy.run.id = i.runId;
  copy.run.ideaId = i.id;
  copy.run.title = `Research: ${i.title}`;
  copy.run.scope = i.scope ?? ORG;
  w.runs.push(copy);
}

function addIdea(w: World, key: string, text: string, scope: string, extra: Partial<Idea>): Idea {
  const id = extra.id ?? uuidFor(`idea:verdicts:${key}`);
  const i: Idea = {
    id,
    title: titleOf(text),
    text,
    constraints: [],
    status: "verdict",
    runId: uuidFor(`run:research:${id}`),
    scope,
    research: { estimatedCredits: 11, spentCredits: 11.2, by: "Wren" },
    verdict: null,
    decision: null,
    record: { total: 0, build: 0, change: 0, doNotBuild: 0, overruled: [] },
    redLine: null,
    history: [],
    tryAgain: null,
    ...extra,
  };
  w.ideas.push(i);
  researchRunFor(w, IDS.ideaVans, i);
  return i;
}

defineScenario({
  name: "verdict-dropped",
  title: "A verdict you dropped",
  apply: (w) => {
    const i = idea(w, IDS.ideaVans);
    if (i) Object.assign(i, { status: "decided", decision: { choice: "drop", at: at(90), by: PEOPLE.owner.displayName, overruled: false, runId: null, via: "person" } });
  },
  route: "/ideas/{idea}",
  featured: { idea: IDS.ideaVans },
});

defineScenario({
  name: "verdict-overruled",
  title: "A do-not-build verdict you overruled",
  apply: (w) => {
    const i = idea(w, IDS.ideaVans);
    if (i) Object.assign(i, { status: "decided", decision: { choice: "overrule", at: at(40), by: PEOPLE.owner.displayName, overruled: true, runId: uuidFor(`run:research:${IDS.ideaVans}`), via: "person" } });
  },
  route: "/ideas/{idea}",
  featured: { idea: IDS.ideaVans },
});

/**
 * A verdict reached without a single web search — what a research run whose rules held back `web_search`, or
 * whose model answered from what it already knew, writes: products named from memory with no address, signals
 * with no source, every strand at 0 searches and 0 sources, low confidence. The page says once that nothing
 * was searched and never counts that knowledge as evidence it read.
 */
defineScenario({
  name: "verdict-no-search",
  title: "A verdict reached without any web search",
  apply: (w) => {
    const i = idea(w, IDS.ideaVans);
    if (!i?.verdict) return;
    const v = JSON.parse(JSON.stringify(i.verdict)) as Record<string, unknown> & { existing: { products: { name: string; does: string; sources: string[] }[] }; demand: Record<string, unknown> };
    v.existing.products = [
      ...v.existing.products.map((p) => ({ ...p, sources: [] })),
      { name: "Onfleet", does: "Delivery tracking with a live map link for each customer.", sources: [] },
      { name: "Tookan", does: "Dispatch and tracking for small fleets.", sources: [] },
    ];
    v.demand = { evidence: "Customers of small shops rarely ask where the van is; they ask when it will arrive.", signals: [{ text: "Couriers' own apps already send a live map link, so customers have one.", source: null }] };
    v.method = {
      strands: ["existing products", "the gap", "demand"].map((t, n) => ({ id: ["existing", "gap", "demand"][n], title: `Looked at ${t}`, searches: 0, sources: 0, confidence: "low" })),
      searches: 0,
      sources: [],
      confidence: "low",
    };
    Object.assign(i, { verdict: v });
  },
  route: "/ideas/{idea}",
  featured: { idea: IDS.ideaVans },
});

defineScenario({ name: "verdict-decided", title: "A verdict you chose to build", route: "/ideas/{idea}", featured: { idea: IDS.ideaReadingList, run: IDS.runBuildReadingList } });

defineScenario({ name: "verdict-researching", title: "An idea still being researched", route: "/ideas/{idea}", featured: { idea: IDS.ideaTides, run: IDS.runResearchTides } });

const LONG_IDEA =
  "A spoiler-safe discussion space for our book club: every member marks how far they have read, each thread is locked to a chapter, and nobody sees a comment about a page they have not reached yet, with a weekly digest of what opened up.";

const PRODUCTS: [string, string, string][] = [
  ["Chapterly", "Every comment is locked to the chapter it came from; only readers at that point see it.", "https://chapterly.example"],
  ["Pagemark Clubs", "Spoiler notes pinned to your progress that open when you pass them.", "https://pagemark.example/clubs"],
  ["Shelfwise", "Buddy reads and read-alongs with comments locked until you reach that point.", "https://shelfwise.example/features/buddy-reads-and-readalongs-with-progress-locked-comments"],
  ["Fablehall", "Free chapter-based spoiler-free club discussion rooms; over a million installs.", "https://fablehall.example"],
  ["Debrief Club", "Checkpoint-gated spoiler-safe debriefs for clubs and buddy reads.", "https://debrief.example"],
  ["Hushread", "Spoilers blurred until each member reaches that point; clubs capped at 20.", "https://hushread.example"],
  ["Readalong (open source, readalong/readalong-server)", "A self-hosted server for progress-gated discussion.", "https://code.example/readalong/readalong-server"],
  ["Margins", "Shared margin notes that unlock by page.", "https://margins.example"],
  ["Bookbond", "Club scheduling with chapter checkpoints.", "https://bookbond.example"],
  ["Inkling Circles", "Private reading circles with progress bars.", "https://inkling-circles.example"],
  ["Tomeline", "A timeline of discussion by percentage read.", "https://tomeline.example"],
  ["Spinewise", "Library-app add-on for club threads.", "https://spinewise.example"],
  ["Quire", "Club discussion inside an e-reader.", "https://quire.example"],
  ["Lantern Reads", "Guided reads with locked prompts per chapter.", "https://lantern-reads.example"],
  ["Folio Friends", "Friends-only reading rooms.", "https://folio-friends.example"],
  ["Gatefold (open source, gatefold/club)", "Self-hosted club app with spoiler gating.", "https://code.example/gatefold/club"],
  ["Pageturn", "Book club planner with spoiler tags.", "https://pageturn.example"],
  ["Hearthshelf", "Small-club reading log and chat.", "https://hearthshelf.example"],
  ["Bookish Rooms", "Topic rooms that open by chapter.", "https://bookish-rooms.example"],
  ["Novella Notes", "Per-chapter notes for clubs.", "https://novella-notes.example"],
  ["Spoilerguard (open source, spoilerguard/bot)", "A chat bot that hides spoilers by progress.", "https://code.example/spoilerguard/bot"],
];

const SIGNALS = [
  "Chapterly is free to join and Pagemark Clubs are free with a 0.99 a month tier, so the going price for this feature is close to nothing.",
  "Fablehall's free spoiler-free rooms sit behind over a million installs and thirty thousand reviews, meaning the free option already has scale.",
  "Fablehall Plus 5.99 a month, Shelfwise Plus 4.99 a month and Bookbond Premium 60 a year show clubs will pay for software, but not specifically for spoiler protection.",
  "A developer on a readers' forum described building this exact chapter-counter idea, and threads asking for chapter-by-chapter discussion are three and six years old with no follow-through.",
  "A 200,000-member reading community enforces a strict spoiler policy with bans, showing the pain is real but currently managed by rules rather than a paid product.",
  "Club research finds 15% of group members report problems with members who have not finished the book, and a quarter of leavers cite it.",
  "No waiting list, pre-order or usage figures were found for any of the small entrants, including Hushread, Chapterly and Debrief Club.",
  "Multiple competing products already ship exactly this feature — progress-gated comments and spoiler-locked threads — so the idea is not new.",
  "Shelfwise locks buddy-read comments until each reader reaches that point in the book, and its support pages confirm comments are tied to a page or percentage.",
  "Fablehall advertises spoiler-free chat rooms organised by chapter or episode and claims over 2,000 free clubs and 10,000 book clubs.",
  "People already pay for adjacent book-club software, between 2.99 a month and 180 a year, but none of it sells on spoilers alone.",
  "A comparison review names four of these products as spoiler workarounds, and notes that group chats rely on manual spoiler tags and track no progress.",
  "Hearthshelf has a paid per-club model at 49.99 a year covering nine members and is in early access, suggesting the club-plus-progress format can be charged for.",
  "I found no waiting-list or pre-order demand signal for a spoiler-safe discussion product specifically, and no published revenue or user counts for the smaller entrants.",
];

const SIGNAL_SOURCES = [
  "https://chapterly.example/pricing",
  "https://stores.example/apps/details?id=com.fablehall.reader&reviews=all&sort=newest",
  "https://pagemark.example/blog/best-book-club-apps-compared-spoiler-free-discussion-2026",
  "https://community.readers-forum.example/r/bookclub/comments/1l9q6ow/strict_spoiler_policy_with_temporary_bans_for_members_who_post_ahead",
  "https://community.readers-forum.example/r/books/comments/18tdpa1/are_there_any_sites_apps_that_do_book_discussions_chapter_by_chapter",
  "https://clubresearch.example/reports/reading-groups-2026",
];

const SOURCES = [...new Set([...PRODUCTS.map(([, , u]) => u), ...SIGNAL_SOURCES, ...Array.from({ length: 14 }, (_, n) => `https://reviews.example/book-club-software/${n + 1}`)])];

function longVerdict(redLine: boolean) {
  const summary = redLine
    ? "The app secretly monitors members' reading habits to report them to an outside body, functioning as a surveillance and authoritarian tool designed to track and control people against their interest."
    : [
        "The strongest case against is that this exact product already exists, many times over and mostly free: Chapterly, Pagemark Clubs, Debrief Club, Shelfwise, Fablehall, Hushread and three open-source self-hosted projects all lock discussion to a reader's progress, and none of them show revenue or waiting lists worth chasing.",
        "The pain behind it is real, but the evidence of demand for a new entrant is thin: old forum wish threads and one survey statistic about members who do not finish the book, with no sign that clubs would pay extra for the discussion layer.",
        "Our only advantage is that the club, the accounts and the progress marks already exist — that is a distribution channel, not an unmet need. Do not build it as a product; revisit only if our own members demonstrably go quiet or leave because of spoilers.",
      ].join("\n\n");
  return {
    outcome: "do-not-build",
    headline: redLine
      ? "This idea crosses FrostAura's surveillance red line, so it will not be built."
      : "The feature is already free in a dozen apps; being next to our reading list is not a gap",
    summary,
    against: redLine
      ? [summary]
      : [
          "At least a dozen products already do progress-gated, spoiler-safe club discussion, several free and one with over a million installs, so we would be paying to enter a crowded, price-collapsed feature market. The only unique thing we offer is that it sits inside our existing reading list and accounts, which is where it would live rather than a reason anyone would choose it, and there is no evidence members would post more or pay more because of it.",
        ],
    existing: redLine
      ? { products: [], evidence: "Not researched: the idea crosses a red line, so no market research was done." }
      : {
          evidence:
            "Spoiler-locked, progress-gated club discussion is a shipped, commodity feature: Chapterly locks every comment to its chapter, Pagemark Clubs uncovers notes as your percentage passes them, Debrief Club unlocks discussion checkpoint by checkpoint, and Shelfwise and Fablehall both lock comments until readers reach that point.",
          products: PRODUCTS.map(([name, does, url]) => ({ name, does, sources: [url] })),
        },
    gap: redLine
      ? { evidence: "Not researched: the idea crosses a red line, so no market research was done." }
      : {
          evidence:
            "The only genuinely unclaimed space is running this as a discussion layer inside a reading list people already use, with accounts and progress already in place — every rival is a standalone app or website requiring its own account and its own tracking. That is a convenience for our members, not a need nobody serves.",
        },
    demand: redLine
      ? { evidence: "Not researched: the idea crosses a red line, so no market research was done.", evidenceFound: false }
      : {
          evidence:
            "People clearly dislike spoilers, but no evidence was found that anyone wants a new, separate spoiler-safe discussion product or would pay for one. The signs are old forum requests, a policed spoiler policy in a large reading community, and one survey statistic.",
          signals: SIGNALS.map((text, n) => ({ text, source: n < SIGNAL_SOURCES.length ? SIGNAL_SOURCES[n] : null })),
        },
    suggestedChange: null,
    wouldChange: redLine
      ? { text: "Nothing the market could show: only an idea whose purpose is clear of the red line could be researched.", changeLabel: null, estimateCredits: null }
      : { text: "Evidence that our own club members go quiet or leave because of spoilers, and that they would post in-thread between meetings, would change this verdict — not the fact that the feature is easy for us to add.", changeLabel: null, estimateCredits: null },
    placement: { division: null, project: null, app: null, name: "Spoiler-safe Discussion" },
    redLines: redLine
      ? { breached: true, line: "surveillance", reasoning: summary }
      : { breached: false, line: null, reasoning: "It is a book discussion tool with progress markers; it involves no tobacco, gambling, finance, weapons, animal harm, or watching people against their interest, so none of the four red lines apply." },
    method: redLine
      ? { strands: [{ id: "red-lines", title: "Checked the idea against FrostAura's red lines", searches: 0, sources: 0, confidence: "high" }], searches: 0, confidence: "high", sources: [] }
      : {
          strands: [
            { id: "existing", title: "Looked for existing products", sources: 18, searches: 6, confidence: "medium" },
            { id: "gap", title: "Looked for what they leave undone", sources: 8, searches: 8, confidence: "medium" },
            { id: "demand", title: "Looked for evidence people will pay", sources: 9, searches: 7, confidence: "medium" },
          ],
          searches: 21,
          confidence: "medium",
          sources: SOURCES,
        },
    rulesApplied: redLine ? ["A red line was found, so nothing may be built."] : ["No evidence of demand was found, so the verdict is do not build."],
  };
}

/** Four earlier ideas overruled against research, so "When you overruled" holds real-sized entries. */
function overruledHistory(w: World) {
  const past: [string, string, string][] = [
    ["servicing", "A shared equipment-servicing log for the club's regulators and cylinders, with a reminder when each is due.", ORG],
    ["compressor", "A compressor service log for the dive club: members sign in and record each service with the date it was done, the hours run and who did it.", ORG],
    ["reading", "A reading-list app for a small book club: members sign in, add books with a title, author and a one-line note, mark a book as reading or finished.", ORG],
    ["boat-dives", "A sign-up sheet for club boat dives: members sign in, see the next dives, and join a dive once to claim a seat on the boat.", ORG],
  ];
  for (const [key, text, scope] of past)
    addIdea(w, key, text, scope, {
      status: "decided",
      verdict: { ...longVerdict(false), headline: "Do not build it." } as never,
      decision: { choice: "overrule", at: at(9 * 24 * 60), by: PEOPLE.owner.displayName, overruled: true, runId: null, via: "person" },
    });
}

defineScenario({
  name: "verdict-long",
  title: "A verdict as real research writes it: long, with 21 products and 41 sources",
  apply: (w) => {
    addIdea(w, "long", LONG_IDEA, `${ORG}/learning`, { id: VERDICTS.ideaLong, constraints: ["Members sign in"], verdict: longVerdict(false) as never });
    overruledHistory(w);
  },
  route: "/ideas/{idea}",
  featured: { idea: VERDICTS.ideaLong },
});

defineScenario({
  name: "verdict-long-red-line",
  title: "A red-line verdict whose reasoning research wrote three times",
  apply: (w) => {
    addIdea(w, "long-red-line", "An app that quietly records which members read which books and when, and reports anyone reading banned titles to the club's regional federation every month.", `${ORG}/technologies`, {
      id: VERDICTS.ideaLongRedLine,
      verdict: longVerdict(true) as never,
      redLine: "surveillance",
      research: { estimatedCredits: 11, spentCredits: 0.01, by: "Wren" },
    });
    overruledHistory(w);
  },
  route: "/ideas/{idea}",
  featured: { idea: VERDICTS.ideaLongRedLine },
});

defineScenario({
  name: "suggestions-long",
  title: "Ideas from the portfolio: five real-sized suggestions, three taken or set aside",
  apply: (w) => {
    const suggestion = (key: string, status: "open" | "taken" | "dismissed", m: number, s: { title: string; idea: string; gap: string; whyUs: string; reuses: string[] }) =>
      w.suggestions.push({ id: uuidFor(`suggestion:verdicts:${key}`), scope: ORG, runId: uuidFor("run:verdicts:suggest"), status, ideaId: status === "taken" ? IDS.ideaAllergen : null, createdAt: new Date(Date.now() - m * 60_000).toISOString(), ...s });
    suggestion("trip-board", "open", 22 * 60, {
      title: "Dive trip leader readiness board",
      idea: "The trip leader opens one page per trip and sees who is coming, whose certification is still valid, whose kit has been serviced recently and who has gone quiet. Members sign in and keep only their own details up to date, and the leader can nudge the people who are not ready yet with one reminder.",
      gap: "Today the leader stitches this together from messages, spreadsheets and memory, and every free dive checklist works only on one person's own phone, so nobody can see the whole group's readiness before a trip.",
      whyUs: "We already run Dive Trip Ready for this club, one of our members leads these trips, and our own research into dive readiness tools found that the leader's view is the one thing no free product covers.",
      reuses: ["Dive Trip Ready", "Dive Trip Ready", "the organisation's sign-in", "A packing checklist for our dive club trips"],
    });
    suggestion("waiting", "open", 40, { title: "A course waiting list", idea: "When a course is full, take names and offer the next place automatically.", gap: "Full courses turn people away with no way back in.", whyUs: "Course Notes already knows every course and who is on it.", reuses: ["Course Notes' enrolments", "the organisation's sign-in"] });
    suggestion("reorder", "open", 40, { title: "Weekly stock reorder email", idea: "Every Friday, email the supplier the items below their usual level.", gap: "Reorders are written by hand from the count sheet.", whyUs: "Stock Counter already counts every item weekly.", reuses: ["Stock Counter's counts", "the platform's email service"] });
    suggestion("rota-swaps", "open", 3 * 60, { title: "Shift swaps the rota can approve on its own, within the rules the kitchen already keeps", idea: "Staff offer a shift, a colleague with the right training takes it, and the rota approves the swap when it keeps every rule.", gap: "Swaps are agreed in a group chat and the rota is corrected by hand, often after the shift.", whyUs: "Shift Rota already holds every shift, every person's training and the kitchen's rules.", reuses: ["Shift Rota's shifts", "Shift Rota's rules", "the organisation's sign-in"] });
    suggestion("deposits", "open", 5 * 60, { title: "Table deposits for large bookings", idea: "Bookings of eight or more leave a deposit, returned when they arrive.", gap: "Large tables that do not arrive cost an evening's covers.", whyUs: "Table bookings already takes every booking.", reuses: ["Table bookings"] });
    suggestion("allergen", "taken", 3 * 24 * 60, { title: "Allergen labels for the kitchen", idea: "Pick a dish, print its allergen label with today's date and use-by.", gap: "Labels are handwritten and allergens are missed.", whyUs: "Court booking's café menu already lists every dish.", reuses: ["the café menu"] });
    suggestion("lockers", "dismissed", 2 * 24 * 60, { title: "Locker hire by the session", idea: "Members book a locker with their court and get its code on their phone.", gap: "Lockers are handed out at the desk with paper keys.", whyUs: "Court booking already knows every session.", reuses: ["Court booking's sessions"] });
    suggestion("loyalty", "dismissed", 4 * 24 * 60, { title: "A loyalty card for the café", idea: "Every tenth coffee free, on the phone.", gap: "Paper cards are lost.", whyUs: "The café menu is already online.", reuses: ["the café menu"] });
  },
  route: "/suggestions?scope=northwind",
});
