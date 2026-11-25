/**
 * Which page each hosted app shows, and the seed data behind it. Every app in the demo world is a
 * small app built on the kit's template; each has a page of its own, picked here by the app's name
 * or, failing that, by its project's slug in its address (so a renamed app keeps its page). An app
 * this table does not know — one a story or a typed idea built — gets a page made from its name.
 * Invented throughout: no real company or person, every address on `.example`.
 */
import type { HostedApp } from "./types";

export type AppPageKey =
  | "reading-list"
  | "court-booking"
  | "course-notes"
  | "tutor-match"
  | "stock-counter"
  | "shift-rota"
  | "pre-orders"
  | "homework"
  | "tide-board"
  | "generic";

const BY_NAME: Record<string, AppPageKey> = {
  "club reading list": "reading-list",
  "court booking": "court-booking",
  "course notes": "course-notes",
  "tutor match": "tutor-match",
  "stock counter": "stock-counter",
  "shift rota": "shift-rota",
  "pre-orders": "pre-orders",
  "homework planner": "homework",
  "harbour tide board": "tide-board",
};

const BY_PROJECT: Record<string, AppPageKey> = {
  "book-club": "reading-list",
  "court-booking": "court-booking",
  "course-notes": "course-notes",
  "tutor-match": "tutor-match",
  "stock-counter": "stock-counter",
  "shift-rota": "shift-rota",
  orders: "pre-orders",
  homework: "homework",
  "tide-board": "tide-board",
};

/** The project's slug in an app's path address: `/<org>/<division>/<project>/<app>/`. */
function projectOf(address: string): string | null {
  try {
    const parts = new URL(/^[a-z]+:\/\//i.test(address) ? address : `https://${address}`).pathname.split("/").filter(Boolean);
    return parts.length >= 3 ? (parts[parts.length - 2] ?? null) : null;
  } catch {
    return null;
  }
}

/** The path inside the app without its query, fragment or trailing slash: "" is the home page. */
export const routeOf = (rest: string) => rest.split(/[?#]/)[0]?.replace(/\/+$/, "") ?? "";

export function pageKeyFor(app: Pick<HostedApp, "name" | "addresses">): AppPageKey {
  const byName = BY_NAME[app.name.trim().toLowerCase()];
  if (byName) return byName;
  const project = projectOf(app.addresses.path);
  return (project && BY_PROJECT[project]) || "generic";
}

// ---------------------------------------------------------------------------------------------
// Dates: everything is placed relative to today, so the pages never look stale
// ---------------------------------------------------------------------------------------------

export const dayFrom = (today: Date, days: number) => {
  const d = new Date(today);
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return d;
};

/** The Monday of today's week. */
export const mondayOf = (today: Date) => dayFrom(today, -((today.getDay() + 6) % 7));

// ---------------------------------------------------------------------------------------------
// Court booking: Northwind's eight squash courts, sold in 40-minute slots from 06:20 to 22:20
// ---------------------------------------------------------------------------------------------

export const COURTS = [1, 2, 3, 4, 5, 6, 7, 8] as const;

/** Every slot's start, 06:20 to 21:40 (the last one ends at 22:20). */
export const ALL_SLOTS: string[] = Array.from({ length: 24 }, (_, i) => {
  const minutes = 6 * 60 + 20 + i * 40;
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
});

/** The evening, the part of the day the page opens on: 17:00 to 21:40. */
export const EVENING_SLOTS = ALL_SLOTS.slice(ALL_SLOTS.indexOf("17:00"));

export const SLOT_MINUTES = 40;

export const slotEnd = (start: string) => ALL_SLOTS[ALL_SLOTS.indexOf(start) + 1] ?? "22:20";

/** League night holds four courts for two hours. */
export const LEAGUE = { courts: [5, 6, 7, 8], slots: ["19:00", "19:40", "20:20"], name: "Wednesday league" } as const;

/** Courts other members have booked this evening (who is never shown: a member sees only their own). */
export const BOOKED: ReadonlySet<string> = new Set([
  "1 17:00", "1 17:40", "1 18:20", "1 19:00", "1 19:40", "1 20:20",
  "2 17:40", "2 18:20", "2 19:00", "2 19:40",
  "3 17:00", "3 19:00", "3 19:40", "3 20:20",
  "4 17:40", "4 18:20", "4 19:40", "4 21:00",
  "5 17:00", "5 17:40", "5 18:20",
  "6 17:40", "6 18:20", "6 21:00",
  "7 18:20", "7 21:00", "7 21:40",
  "8 17:00", "8 18:20",
]);

/** The signed-in member's own booking this evening, and the playing minutes left on their account. */
export const OWN_BOOKING = { court: 3, start: "18:20" } as const;
export const OWN_MINUTES = 280;

export const slotKey = (court: number, start: string) => `${court} ${start}`;

// ---------------------------------------------------------------------------------------------
// Course Notes: the children's cookery school, this term
// ---------------------------------------------------------------------------------------------

export interface CourseNote {
  session: number;
  title: string;
  /** Days from today; negative is past. */
  day: number;
  text: string;
}

export interface Course {
  id: string;
  name: string;
  ages: string;
  tutor: string;
  when: string;
  notes: CourseNote[];
}

export const COURSES: Course[] = [
  {
    id: "little-bakers",
    name: "Little Bakers",
    ages: "Ages 7–9",
    tutor: "Marta Kowalczyk",
    when: "Tuesdays, 16:00",
    notes: [
      { session: 6, title: "Cheese scones", day: -1, text: "Rub the butter in with fingertips only; cold hands make lighter scones. Everyone took four home." },
      { session: 5, title: "Shortbread fingers", day: -8, text: "Weighing on the scales went well. Next time, chill the dough for ten minutes before cutting." },
      { session: 4, title: "Soda bread", day: -15, text: "No yeast, no waiting. Two loaves came out flat: the oven door was opened too early." },
    ],
  },
  {
    id: "knife-skills",
    name: "Knife Skills for Juniors",
    ages: "Ages 10–12",
    tutor: "Dev Pillai",
    when: "Thursdays, 16:30",
    notes: [
      { session: 6, title: "Vegetable stir-fry", day: -6, text: "The claw grip, again, then batons and dice. Every child cut their own peppers and onions." },
      { session: 5, title: "Herb omelettes", day: -13, text: "Chopping herbs with a rocking knife. Bring an apron with a pocket next week." },
      { session: 7, title: "Fish cakes", day: 1, text: "Parents: tell Dev by Wednesday about any fish allergy. Potatoes are boiled before the class." },
    ],
  },
  {
    id: "teen-kitchen",
    name: "Teen Kitchen: Family Suppers",
    ages: "Ages 13–14",
    tutor: "Grace Oduya",
    when: "Saturdays, 10:00",
    notes: [
      { session: 5, title: "Lentil dal and flatbreads", day: -4, text: "Cooked for six on a budget of £9. The recipe card is in each folder." },
      { session: 4, title: "Roast chicken traybake", day: -11, text: "Food safety first: separate boards, and a thermometer check at 75 °C." },
      { session: 3, title: "Fresh pasta", day: -18, text: "Rolled by hand, no machine. Tagliatelle dries well overnight on a clean tea towel." },
    ],
  },
];

// ---------------------------------------------------------------------------------------------
// Tutor Match: the school's tutors, what they teach and when they are free
// ---------------------------------------------------------------------------------------------

export interface Tutor {
  name: string;
  subjects: string[];
  ages: string;
  availability: string;
  taking: boolean;
  about: string;
}

export const TUTORS: Tutor[] = [
  { name: "Marta Kowalczyk", subjects: ["Baking", "Pastry"], ages: "7–11", availability: "Tuesdays and Fridays after school", taking: true, about: "Bread, scones and the patience they need. Twelve years in a bakery before teaching." },
  { name: "Dev Pillai", subjects: ["Knife skills", "World kitchens"], ages: "10–14", availability: "Thursdays after school · Saturday mornings", taking: true, about: "Safe, confident knife work, then the dishes it opens up." },
  { name: "Grace Oduya", subjects: ["Family suppers", "Food safety"], ages: "12–14", availability: "Saturday mornings", taking: false, about: "Cooking a whole meal for a family, on time and on a budget." },
  { name: "Tomasz Brenner", subjects: ["Pastry", "Baking"], ages: "9–14", availability: "Wednesdays after school", taking: true, about: "Shortcrust, choux and the science of why butter must stay cold." },
  { name: "Leila Haddad", subjects: ["Vegetarian cooking", "World kitchens"], ages: "7–14", availability: "Mondays and Wednesdays after school", taking: true, about: "Vegetables first: mezze, soups and one-pot dishes." },
  { name: "Owen Carrick", subjects: ["Food safety", "Knife skills"], ages: "10–14", availability: "Sunday mornings", taking: false, about: "Hygiene certificates for older pupils, and the habits behind them." },
];

export const TUTOR_SUBJECTS = [...new Set(TUTORS.flatMap((t) => t.subjects))].sort();

// ---------------------------------------------------------------------------------------------
// Stock Counter: the café's and the shop's last count
// ---------------------------------------------------------------------------------------------

export interface StockItem {
  name: string;
  where: "Café" | "Shop";
  counted: number;
  par: number;
  unit: string;
  countedBy: string;
  /** Hours before now. */
  hoursAgo: number;
}

export const STOCK: StockItem[] = [
  { name: "Oat milk", where: "Café", counted: 6, par: 12, unit: "cartons", countedBy: "Jo Hartley", hoursAgo: 3 },
  { name: "Espresso beans", where: "Café", counted: 4, par: 5, unit: "kg", countedBy: "Jo Hartley", hoursAgo: 3 },
  { name: "Paper cups, 8 oz", where: "Café", counted: 620, par: 400, unit: "cups", countedBy: "Jo Hartley", hoursAgo: 3 },
  { name: "Bottled water", where: "Café", counted: 48, par: 36, unit: "bottles", countedBy: "Jo Hartley", hoursAgo: 3 },
  { name: "Squash balls, double yellow dot", where: "Shop", counted: 18, par: 24, unit: "tubes", countedBy: "Rory Walsh", hoursAgo: 26 },
  { name: "Replacement grips", where: "Shop", counted: 30, par: 20, unit: "grips", countedBy: "Rory Walsh", hoursAgo: 26 },
  { name: "Protective eyewear, junior", where: "Shop", counted: 7, par: 6, unit: "pairs", countedBy: "Rory Walsh", hoursAgo: 26 },
  { name: "Energy bars", where: "Shop", counted: 11, par: 24, unit: "bars", countedBy: "Rory Walsh", hoursAgo: 26 },
];

// ---------------------------------------------------------------------------------------------
// Shift Rota: this week's shifts at the café and the front desk
// ---------------------------------------------------------------------------------------------

export const SHIFTS = [
  { role: "Front desk", hours: "06:00–14:00" },
  { role: "Front desk", hours: "14:00–22:30" },
  { role: "Café", hours: "07:00–15:00" },
  { role: "Café", hours: "15:00–21:00" },
] as const;

export const STAFF = ["Theo Marsh", "Ellie Brandt", "Joaquin Reyes", "Femi Adebayo", "Hana Sato", "Rory Walsh"] as const;

/** Who works shift `s` on day `d` (0 is Monday): a fixed rotation, so the week reads the same each time. */
export const rostered = (s: number, d: number) => STAFF[(s * 2 + d) % STAFF.length] ?? STAFF[0];

/** Shifts with a swap asked for: `shift day`. */
export const SWAPS: ReadonlySet<string> = new Set(["1 4", "3 5"]);

// ---------------------------------------------------------------------------------------------
// Pre-orders: Quayside Bakery's orders for collection
// ---------------------------------------------------------------------------------------------

export type OrderStatus = "received" | "baking" | "ready" | "collected";

export const ORDER_STATUS: Record<OrderStatus, string> = { received: "Received", baking: "Baking", ready: "Ready to collect", collected: "Collected" };

export interface PreOrder {
  number: number;
  customer: string;
  items: string[];
  /** Days from today, and the collection time. */
  day: number;
  at: string;
  status: OrderStatus;
}

export const ORDERS: PreOrder[] = [
  { number: 1041, customer: "Nadia F.", items: ["2 × sourdough loaf", "6 × cinnamon bun"], day: 0, at: "08:00", status: "collected" },
  { number: 1042, customer: "Callum R.", items: ["1 × seeded rye", "4 × almond croissant"], day: 0, at: "11:30", status: "ready" },
  { number: 1043, customer: "Wren Hollis", items: ["1 × birthday sponge, lemon, 8 slices"], day: 0, at: "16:00", status: "baking" },
  { number: 1044, customer: "Mo Tran", items: ["12 × sausage roll", "12 × cheese straw"], day: 1, at: "09:00", status: "received" },
  { number: 1045, customer: "Bea Lindgren", items: ["3 × white bloomer"], day: 1, at: "12:00", status: "received" },
  { number: 1046, customer: "St Anselm's choir", items: ["40 × mince pie", "2 × fruit loaf"], day: 2, at: "17:30", status: "received" },
];

// ---------------------------------------------------------------------------------------------
// Homework Planner: Northfield Tutors' pupils and what is due
// ---------------------------------------------------------------------------------------------

export type HomeworkStatus = "set" | "handed-in" | "marked";

export const HOMEWORK_STATUS: Record<HomeworkStatus, string> = { set: "Set", "handed-in": "Handed in", marked: "Marked" };

export interface Homework {
  pupil: string;
  subject: string;
  task: string;
  tutor: string;
  /** Days from today the work is due. */
  due: number;
  status: HomeworkStatus;
}

export const HOMEWORK: Homework[] = [
  { pupil: "Aisha K.", subject: "Maths", task: "Fractions worksheet 4: adding with unlike denominators", tutor: "Mr Ellery", due: 0, status: "handed-in" },
  { pupil: "Ben O.", subject: "English", task: "Write the opening page of a ghost story, 300 words", tutor: "Ms Varga", due: 0, status: "set" },
  { pupil: "Chloe D.", subject: "Science", task: "Label the parts of a flower and say what each does", tutor: "Dr Asante", due: 1, status: "set" },
  { pupil: "Aisha K.", subject: "French", task: "Learn twenty words for food; quiz on Friday", tutor: "Mme Roux", due: 2, status: "set" },
  { pupil: "Dev S.", subject: "Maths", task: "Long division: questions 1 to 15", tutor: "Mr Ellery", due: 3, status: "set" },
  { pupil: "Ben O.", subject: "Maths", task: "Times tables, 7s and 8s, against the clock", tutor: "Mr Ellery", due: -1, status: "marked" },
  { pupil: "Chloe D.", subject: "English", task: "Book review of the class reader", tutor: "Ms Varga", due: -2, status: "marked" },
];

// ---------------------------------------------------------------------------------------------
// Harbour Tide Board: high and low water at the harbour
// ---------------------------------------------------------------------------------------------

export interface Tide {
  kind: "High" | "Low";
  at: string;
  metres: number;
}

export const TIDES: { day: number; tides: Tide[] }[] = [
  { day: 0, tides: [{ kind: "Low", at: "03:12", metres: 0.9 }, { kind: "High", at: "09:27", metres: 4.6 }, { kind: "Low", at: "15:40", metres: 1.1 }, { kind: "High", at: "21:52", metres: 4.4 }] },
  { day: 1, tides: [{ kind: "Low", at: "04:01", metres: 1.0 }, { kind: "High", at: "10:15", metres: 4.5 }, { kind: "Low", at: "16:29", metres: 1.2 }, { kind: "High", at: "22:41", metres: 4.3 }] },
  { day: 2, tides: [{ kind: "Low", at: "04:53", metres: 1.1 }, { kind: "High", at: "11:06", metres: 4.3 }, { kind: "Low", at: "17:22", metres: 1.3 }, { kind: "High", at: "23:33", metres: 4.2 }] },
];

// ---------------------------------------------------------------------------------------------
// Any other app: what a small app replacing a shared spreadsheet holds in its first week
// ---------------------------------------------------------------------------------------------

export interface Entry {
  text: string;
  by: string;
  /** Days before today. */
  daysAgo: number;
  done: boolean;
}

export function genericEntries(name: string): Entry[] {
  return [
    { text: `Move last month's spreadsheet into ${name}`, by: "Robin Hale", daysAgo: 2, done: true },
    { text: `Agree who keeps ${name} up to date each week`, by: "Sasha Moreau", daysAgo: 1, done: false },
    { text: `Share ${name} with everyone who used the sheet`, by: "Robin Hale", daysAgo: 1, done: false },
    { text: `Check ${name} on a phone before Monday`, by: "Sasha Moreau", daysAgo: 0, done: false },
  ];
}
