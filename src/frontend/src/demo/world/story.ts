/**
 * The words of the demo's story: what research found for each idea, the verdict it reached, and
 * the plan a build follows. Invented throughout — every organisation, product, person and source
 * is made up, and every address is on an `.example` domain. Scripts read a story by its key; an
 * idea typed into the demo gets {@link storyFor}'s generic one, shaped by its own words.
 */

export interface Strand {
  id: "existing" | "gap" | "demand";
  title: string;
  brief: string;
  findings: string[];
  sources: string[];
}

export interface PlanItemStory {
  id: string;
  /** What the owner reads. */
  text: string;
  /** Technical mode's detail: files, endpoints, tests. */
  detail: string;
  check: string;
  covers: string[];
}

export interface Story {
  key: string;
  /** The app's name once built. */
  name: string;
  /** Where placement puts it: an existing or new division, and the project's slug. */
  division: { slug: string; name: string };
  project: string;
  strands: Strand[];
  verdict: Record<string, unknown>;
  headline: string;
  plan: {
    summary: string;
    requirements: { id: string; text: string }[];
    items: PlanItemStory[];
    leftOut: { requirement: string; text: string; reason: string }[];
  };
  /** The plan item sent back once and repaired, and why. */
  sentBack: { item: string; fault: string; evidence: string } | null;
  finding: { item: string; file: string; line: number; problem: string; fix: string } | null;
}

const existing = (brief: string): Strand["brief"] => brief;

export const STORIES: Record<string, Story> = {
  "reading-list": {
    key: "reading-list",
    name: "Club Reading List",
    division: { slug: "learning", name: "Learning" },
    project: "book-club",
    headline: "A shared shelf the supper club will actually use",
    strands: [
      {
        id: "existing",
        title: "Looked for existing products",
        brief: existing("Existing products: find every product, service or open-source project that already does this or a large part of it. Name each, say what it does, and give its price and its users where you can."),
        findings: [
          "Shelfwise offers public reading shelves with follow-a-friend, free, and has no private group lists.",
          "Paperlane runs paid book-club spaces from 4 a month per club, aimed at clubs of 30 or more.",
          "Most small clubs in the forums keep a shared spreadsheet or a pinned chat message.",
        ],
        sources: ["https://shelfwise.example/clubs", "https://paperlane.example/pricing", "https://forum.readers.example/t/small-club-tools"],
      },
      {
        id: "gap",
        title: "Looked for what they leave undone",
        brief: "The gap: what do existing products leave undone, do badly, or price out of reach for the people this is for? Look for complaints, reviews and forum threads.",
        findings: [
          "Small clubs complain that public shelves show their reading to strangers.",
          "Paperlane's per-club price is too much for a club of eight that meets monthly.",
          "Nobody shows 'what everyone is reading right now' on one screen without an account elsewhere.",
        ],
        sources: ["https://reviews.example/paperlane", "https://forum.readers.example/t/private-shelf"],
      },
      {
        id: "demand",
        title: "Looked for evidence people will pay",
        brief: "Demand: evidence that real people want this and would pay — searches, communities, waiting lists, people paying for workarounds. Say plainly if you find none.",
        findings: [
          "The Northwind supper club already keeps its list in a shared sheet that eleven members edit.",
          "Two neighbouring clubs asked the café for the same list after seeing it.",
        ],
        sources: ["https://forum.readers.example/t/club-sheet-template"],
      },
    ],
    verdict: {
      outcome: "build",
      headline: "A shared shelf the supper club will actually use",
      summary:
        "The supper club already runs this by hand in a shared sheet, and the public reading apps either show the club's reading to strangers or charge per club. A private list behind the organisation's own sign-in, on a phone, is small, cheap to run, and replaces a sheet eleven people already edit.",
      against: [
        "Free public shelves exist, and a keen member could use one of them today.",
        "The list is only as good as the members who keep it up; a quiet club will leave it stale.",
      ],
      existing: {
        products: [
          { name: "Shelfwise", does: "Public reading shelves with follow-a-friend; free; no private group lists.", sources: ["https://shelfwise.example/clubs"] },
          { name: "Paperlane", does: "Paid book-club spaces from 4 a month per club, built for large clubs.", sources: ["https://paperlane.example/pricing"] },
        ],
        evidence: "Two products come close, but one is public and the other is priced for clubs five times this size.",
      },
      gap: { evidence: "No product found keeps a small club's list private, on one screen, without asking each member to join another service." },
      demand: {
        evidence: "The demand is the club's own: a sheet in daily use, and two clubs asking for a copy.",
        signals: [
          { text: "Eleven members edit the club's shared sheet each month.", source: "https://forum.readers.example/t/club-sheet-template" },
          { text: "Two neighbouring clubs asked for the same list after seeing it.", source: null },
        ],
      },
      wouldChange: null,
      placement: { division: "learning", project: "book-club", app: "web", name: "Club Reading List" },
      redLines: { breached: false, line: null, reasoning: "A private reading list harms no one and watches no one." },
      method: { strands: [], searches: 14, confidence: "high", contractors: 3, argued: "The case against was argued first." },
    },
    plan: {
      summary:
        "A private reading list for the supper club: members sign in, add books with a note, mark what they are reading or have finished, and see on one screen what everyone is reading now. The list itself first, then the screens, then the app's own documents.",
      requirements: [
        { id: "R1", text: "Members sign in before they see the list." },
        { id: "R2", text: "A member adds a book with its title, author and a one-line note." },
        { id: "R3", text: "A member marks their book as reading or finished." },
        { id: "R4", text: "Everyone sees what each member is reading now." },
        { id: "R5", text: "It works on a phone." },
        { id: "R6", text: "Members get a reminder before each meeting." },
      ],
      items: [
        {
          id: "backend-books",
          text: "Keep the club's books: add one, read the list newest first, and change a book's status — signed-in members only.",
          detail:
            "api/Books/Book.cs (Title, Author, Note, Status enum, AddedById, AddedByName, AddedAt), AppDb DbSet, a fresh InitialCreate migration, BooksEndpoints.cs with list, read by id, create and update-status (signed in only). api.tests/BooksApiTests.cs covers the round trip, 401 for signed-out writes, 400 for a missing title, 404 for a missing book.",
          check: "make lint and make test pass; a signed-out POST answers 401 with signInUrl.",
          covers: ["R1", "R2", "R3"],
        },
        {
          id: "frontend-books",
          text: "The screens: the list as cards, a book's page with one button to move its status on, and a form to add a book, laid out for a phone first.",
          detail:
            "web/src/books/: BooksPage, BookDetailPage (status button), NewBookPage (signed-in guard), routes in App.tsx, Vitest tests for loading, empty, loaded and failed states.",
          check: "make lint and make test pass; the status button works at a 375-pixel width.",
          covers: ["R2", "R3", "R4", "R5"],
        },
        {
          id: "docs-and-shell",
          text: "Write down what the app is, what it keeps and the decisions taken, so the next person to change it starts from the truth.",
          detail: "docs/app.md, docs/data.md, docs/decisions.md and AppShellTests updated for the book routes; PROGRESS.md records the work.",
          check: "make test passes; the docs describe the books app and nothing else.",
          covers: ["R4"],
        },
      ],
      leftOut: [
        { requirement: "R6", text: "Members get a reminder before each meeting.", reason: "Meetings are not part of this idea yet; reminders need a meeting date to remind about. It is a small change once meetings exist." },
      ],
    },
    sentBack: {
      item: "frontend-books",
      fault: "On a phone-width screen the status button sits under the bottom bar and cannot be pressed.",
      evidence: "At 375 pixels wide the 'Mark as finished' button is covered by the fixed footer; tapping it does nothing. The list and the form are fine.",
    },
    finding: {
      item: "Identity and access — ownership is checked: a member changes only what is theirs",
      file: "api/Books/BooksEndpoints.cs",
      line: 94,
      problem: "Changing a book's status looks the book up by id alone, so any signed-in member can change any member's book.",
      fix: "Look the book up by id and by the member who added it; answer not-found otherwise.",
    },
  },
  "tide-board": {
    key: "tide-board",
    name: "Harbour Tide Board",
    division: { slug: "learning", name: "Learning" },
    project: "tide-board",
    headline: "Worth building: the café's own tide board, on its own screen",
    strands: [
      {
        id: "existing",
        title: "Looked for existing products",
        brief: "Existing products: find every product, service or open-source project that already does this or a large part of it.",
        findings: ["Tidecharts sells a general tide table app for 2 a month.", "The harbour authority publishes a weekly tide table as a printable sheet."],
        sources: ["https://tidecharts.example", "https://harbour-authority.example/tides"],
      },
      {
        id: "gap",
        title: "Looked for what they leave undone",
        brief: "The gap: what do existing products leave undone?",
        findings: ["None of them shows the next high water and the café's opening hours together on a screen by the door."],
        sources: ["https://reviews.example/tidecharts"],
      },
      {
        id: "demand",
        title: "Looked for evidence people will pay",
        brief: "Demand: evidence that real people want this and would pay.",
        findings: ["Staff answer 'when is high water?' about thirty times a day in summer."],
        sources: ["https://forum.harbourside.example/t/tide-questions"],
      },
    ],
    verdict: {
      outcome: "build",
      headline: "Worth building: the café's own tide board, on its own screen",
      summary: "A board by the door that shows the next tides beside the café's hours answers the question staff hear most in summer, from data the harbour already publishes.",
      against: ["A printed tide table by the till does most of this for free."],
      existing: { products: [{ name: "Tidecharts", does: "A general tide table app for 2 a month.", sources: ["https://tidecharts.example"] }], evidence: "General tide apps exist; none is a board for one place." },
      gap: { evidence: "Nothing shows the tides and the café's hours together." },
      demand: { evidence: "Thirty questions a day in summer.", signals: [{ text: "Staff answer the tide question about thirty times a day in summer.", source: "https://forum.harbourside.example/t/tide-questions" }] },
      wouldChange: null,
      placement: { division: "learning", project: "tide-board", app: "web", name: "Harbour Tide Board" },
      redLines: { breached: false, line: null, reasoning: null },
      method: { strands: [], searches: 9, confidence: "medium", contractors: 3 },
    },
    plan: generic("Harbour Tide Board").plan,
    sentBack: null,
    finding: null,
  },
};

/** The generic story for an idea typed into the demo, shaped by its own words. */
export function storyFor(text: string, key?: string | null): Story {
  if (key && STORIES[key]) return STORIES[key];
  const name = nameFrom(text);
  const red = redLineIn(text);
  const g = generic(name);
  if (red) {
    g.verdict = {
      outcome: "do-not-build",
      headline: "Not on Endgame: this crosses a red line",
      summary: `${red.reasoning} FrostAura never builds it, and no one can overrule that.`,
      against: [red.reasoning],
      existing: { products: [], evidence: "Not looked into further once the red line was found." },
      gap: { evidence: "Not looked into." },
      demand: { evidence: "No evidence was gathered for an idea that crosses a red line.", evidenceFound: false },
      wouldChange: { text: "Nothing would change this verdict while the idea watches people without their consent.", changeLabel: null, estimateCredits: null },
      redLines: { breached: true, line: red.line, reasoning: red.reasoning },
      method: { strands: [], searches: 3, confidence: "high", contractors: 3 },
      rulesApplied: ["A red line was found, so nothing may be built."],
    };
    g.headline = "Not on Endgame: this crosses a red line";
  }
  return g;
}

function nameFrom(text: string): string {
  const words = text
    .replace(/^(an?|the)\s+/i, "")
    .split(/[\s,.:;]+/)
    .filter((w) => w.length > 2 && !/^(app|for|that|which|with|and|the|our|who|lets?)$/i.test(w))
    .slice(0, 3);
  const name = words.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
  return name || "New App";
}

function redLineIn(text: string): { line: string; reasoning: string } | null {
  const t = text.toLowerCase();
  if (/(track|follow|monitor|watch|locat).{0,40}(staff|employee|worker|people|phone)|(staff|employee).{0,40}(track|follow|locat|whereabouts)|surveil/.test(t))
    return { line: "surveillance", reasoning: "It follows people without their meaningful consent, which is surveillance tooling." };
  if (/gambl|betting|casino|slot machine/.test(t)) return { line: "tobacco-gambling-finance", reasoning: "It is built around exploitative gambling." };
  if (/payday loan|loan shark/.test(t)) return { line: "tobacco-gambling-finance", reasoning: "It is predatory finance." };
  if (/weapon|munition/.test(t)) return { line: "weapons", reasoning: "It is a weapon or serves one against civilians." };
  return null;
}

function generic(name: string): Story {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "new-app";
  return {
    key: "generic",
    name,
    division: { slug: "studio", name: "Studio" },
    project: slug.length >= 2 ? slug : "new-app",
    headline: `Worth building: ${name}, kept small`,
    strands: [
      {
        id: "existing",
        title: "Looked for existing products",
        brief: "Existing products: find every product, service or open-source project that already does this or a large part of it. Name each, say what it does, and give its price and its users where you can.",
        findings: [`Two general-purpose tools cover part of ${name}, neither for an organisation this size.`, "Most small teams in the forums keep this in a spreadsheet."],
        sources: ["https://directory.example/tools", "https://forum.smallteams.example/t/spreadsheets"],
      },
      {
        id: "gap",
        title: "Looked for what they leave undone",
        brief: "The gap: what do existing products leave undone, do badly, or price out of reach for the people this is for? Look for complaints, reviews and forum threads.",
        findings: ["Reviewers say the general tools take a day to set up and charge per seat.", "Nothing found works well on a phone."],
        sources: ["https://reviews.example/general-tools"],
      },
      {
        id: "demand",
        title: "Looked for evidence people will pay",
        brief: "Demand: evidence that real people want this and would pay — searches, communities, waiting lists, people paying for workarounds. Say plainly if you find none.",
        findings: ["The organisation's own people already do this by hand every week."],
        sources: ["https://forum.smallteams.example/t/weekly-chore"],
      },
    ],
    verdict: {
      outcome: "build",
      headline: `Worth building: ${name}, kept small`,
      summary: `The work is already done by hand every week, the general tools are priced per seat and slow to set up, and a small app on the organisation's own sign-in replaces the spreadsheet for very little each month.`,
      against: ["A shared spreadsheet does most of this today, for nothing.", "If the people who keep it up stop, the app will go stale like the sheet did."],
      existing: {
        products: [
          { name: "Tallyboard", does: "A general tracking tool, 6 a seat a month.", sources: ["https://directory.example/tools"] },
          { name: "Sheetkit", does: "Spreadsheet templates for small teams; free.", sources: ["https://forum.smallteams.example/t/spreadsheets"] },
        ],
        evidence: "General tools exist; none is shaped for this organisation.",
      },
      gap: { evidence: "Set-up time, per-seat prices and no phone layout." },
      demand: { evidence: "The demand is the organisation's own weekly chore.", signals: [{ text: "The work is done by hand every week today.", source: null }] },
      wouldChange: null,
      placement: { division: "studio", project: slug, app: "web", name },
      redLines: { breached: false, line: null, reasoning: null },
      method: { strands: [], searches: 12, confidence: "medium", contractors: 3 },
    },
    plan: {
      summary: `${name}: what it keeps first, then the screens to use it on a phone, then the app's own documents.`,
      requirements: [
        { id: "R1", text: "People sign in before they use it." },
        { id: "R2", text: "They add, change and remove entries." },
        { id: "R3", text: "It works on a phone." },
      ],
      items: [
        { id: "backend", text: "Keep the entries and let signed-in people add, change and remove them.", detail: "api/Entries: entity, migration, endpoints (list, read, create, update, delete), API tests.", check: "make lint and make test pass.", covers: ["R1", "R2"] },
        { id: "frontend", text: "The screens to use it, phone first.", detail: "web/src/entries: list, detail and form pages with their four states; Vitest tests.", check: "make lint and make test pass.", covers: ["R2", "R3"] },
        { id: "docs", text: "Write down what the app is and what it keeps.", detail: "docs/app.md, docs/data.md, docs/decisions.md.", check: "The docs describe the app.", covers: ["R1"] },
      ],
      leftOut: [],
    },
    sentBack: null,
    finding: null,
  };
}
