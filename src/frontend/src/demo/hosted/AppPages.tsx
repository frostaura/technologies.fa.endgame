import { useState, type JSX } from "react";
import { cn } from "@/lib/utils";
import { AppNotFound, HostedAppShell, PageHeading, type AppPageProps } from "./AppShell";
import {
  BOOKED,
  COURSES,
  COURTS,
  dayFrom,
  EVENING_SLOTS,
  genericEntries,
  HOMEWORK,
  HOMEWORK_STATUS,
  LEAGUE,
  mondayOf,
  ORDER_STATUS,
  ORDERS,
  OWN_BOOKING,
  OWN_MINUTES,
  pageKeyFor,
  routeOf,
  rostered,
  SHIFTS,
  SLOT_MINUTES,
  slotEnd,
  slotKey,
  STOCK,
  SWAPS,
  TIDES,
  TUTOR_SUBJECTS,
  TUTORS,
  type AppPageKey,
  type HomeworkStatus,
  type OrderStatus,
} from "./apps";
import { Badge, Card, CardContent, CardHeader, CardTitle, KitButton, Label, Select } from "./kit";
import { ReadingListApp } from "./ReadingListApp";
import type { HostedApp } from "./types";

const dayName = (d: Date) => new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long" }).format(d);
const shortDay = (d: Date) => new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short" }).format(d);
const relativeDay = (days: number, today: Date) => (days === 0 ? "Today" : days === 1 ? "Tomorrow" : days === -1 ? "Yesterday" : shortDay(dayFrom(today, days)));

/** A home page and its name for "Back to …" on an address the app has no page for. */
type Home = { title: string; Page: (props: AppPageProps) => JSX.Element };

const HOMES: Record<Exclude<AppPageKey, "reading-list">, Home> = {
  "court-booking": { title: "the courts", Page: CourtBookingPage },
  "course-notes": { title: "the course notes", Page: CourseNotesPage },
  "tutor-match": { title: "the tutors", Page: TutorMatchPage },
  "stock-counter": { title: "the stock count", Page: StockCounterPage },
  "shift-rota": { title: "the rota", Page: ShiftRotaPage },
  "pre-orders": { title: "the orders", Page: PreOrdersPage },
  homework: { title: "the homework", Page: HomeworkPage },
  "tide-board": { title: "the tides", Page: TideBoardPage },
  generic: { title: "the list", Page: GenericPage },
};

/** The app behind the Edge's pages: each app in the demo shows a page of its own in the kit's shell. */
export function HostedAppPage({ app, ...props }: AppPageProps & { app: Pick<HostedApp, "name" | "addresses"> }) {
  const key = pageKeyFor(app);
  if (key === "reading-list") return <ReadingListApp {...props} />;
  const { title, Page } = HOMES[key];
  return (
    <HostedAppShell {...props} testId="hosted-app-page" page={key}>
      {routeOf(props.rest) === "" ? <Page {...props} /> : <AppNotFound {...props} backTo={title} />}
    </HostedAppShell>
  );
}

// ---------------------------------------------------------------------------------------------
// Court booking
// ---------------------------------------------------------------------------------------------

function CourtBookingPage({ me }: AppPageProps) {
  const today = new Date();
  const [mine, setMine] = useState<string[]>(me ? [slotKey(OWN_BOOKING.court, OWN_BOOKING.start)] : []);
  const minutes = OWN_MINUTES - (mine.length - 1) * SLOT_MINUTES;
  const league = (court: number, start: string) => (LEAGUE.courts as readonly number[]).includes(court) && (LEAGUE.slots as readonly string[]).includes(start);
  const free = COURTS.reduce((n, c) => n + EVENING_SLOTS.filter((s) => !BOOKED.has(slotKey(c, s)) && !league(c, s) && !mine.includes(slotKey(c, s))).length, 0);
  const book = (key: string) => setMine((m) => (m.includes(key) ? m : [...m, key]));
  const cancel = (key: string) => setMine((m) => m.filter((k) => k !== key));

  return (
    <section className="flex flex-col gap-6" data-testid="page-home">
      <PageHeading title="Book a court" summary={`${dayName(today)} · this evening · ${free} slots free · 40-minute slots, paid in playing minutes`} />
      {me ? (
        <Card data-testid="own-bookings">
          <CardHeader>
            <CardTitle>Your bookings</CardTitle>
            <p className="text-sm text-ink-muted">{minutes} playing minutes left on your account</p>
          </CardHeader>
          <CardContent>
            {mine.length === 0 ? (
              <p className="text-sm text-ink-muted">Nothing booked today. Choose a free slot below.</p>
            ) : (
              <ul className="flex flex-wrap gap-3">
                {mine.map((key) => {
                  const [court, start] = key.split(" ");
                  return (
                    <li key={key} className="flex items-center gap-3 rounded-sm border bg-ground px-4 py-2 text-sm" data-testid="own-booking">
                      <span className="font-semibold">Court {court}</span>
                      <span>
                        {start}–{slotEnd(start ?? "")}
                      </span>
                      <KitButton variant="ghost" size="sm" onClick={() => cancel(key)}>
                        Cancel
                      </KitButton>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      ) : (
        <p className="text-sm text-ink-muted">Sign in to book a court with your playing minutes.</p>
      )}
      <div className="overflow-x-auto rounded-md border bg-surface shadow-card">
        <table className="w-full border-collapse text-sm" aria-label="Courts this evening" data-testid="court-grid">
          <thead>
            <tr className="border-b">
              <th scope="col" className="px-4 py-3 text-left font-semibold">
                Court
              </th>
              {EVENING_SLOTS.map((s) => (
                <th key={s} scope="col" className="px-2 py-3 text-center font-mono text-xs font-semibold text-ink-muted">
                  {s}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {COURTS.map((court) => (
              <tr key={court} className="border-b last:border-b-0" data-testid="court-row">
                <th scope="row" className="px-4 py-2 text-left font-semibold">
                  Court {court}
                </th>
                {EVENING_SLOTS.map((start) => {
                  const key = slotKey(court, start);
                  return (
                    <td key={start} className="px-1 py-2 text-center">
                      {mine.includes(key) ? (
                        <Badge tone="primary">Yours</Badge>
                      ) : league(court, start) ? (
                        <Badge tone="attention">League</Badge>
                      ) : BOOKED.has(key) ? (
                        <span className="text-xs text-ink-muted">Booked</span>
                      ) : me ? (
                        <KitButton variant="outline" size="sm" onClick={() => book(key)} aria-label={`Book court ${court} at ${start}`}>
                          Book
                        </KitButton>
                      ) : (
                        <Badge tone="success">Free</Badge>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-ink-muted">
        {LEAGUE.name} holds courts {LEAGUE.courts.join(", ")} from {LEAGUE.slots[0]} to {slotEnd(LEAGUE.slots[LEAGUE.slots.length - 1] ?? "")}. Courts open from 06:20 to 22:20.
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Course Notes
// ---------------------------------------------------------------------------------------------

function CourseNotesPage() {
  const today = new Date();
  const notes = COURSES.reduce((n, c) => n + c.notes.length, 0);
  return (
    <section className="flex flex-col gap-6" data-testid="page-home">
      <PageHeading title="This term's notes" summary={`Autumn term · ${COURSES.length} courses · ${notes} notes from the tutors`} />
      <ul className="grid gap-4 lg:grid-cols-3" aria-label="Courses" data-testid="course-list">
        {COURSES.map((course) => (
          <li key={course.id} data-testid="course-item">
            <Card className="flex h-full flex-col">
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <CardTitle>{course.name}</CardTitle>
                  <Badge>{course.ages}</Badge>
                </div>
                <p className="text-sm text-ink-muted">
                  {course.tutor} · {course.when}
                </p>
              </CardHeader>
              <CardContent>
                <ol className="flex flex-col gap-4">
                  {[...course.notes].sort((a, b) => b.day - a.day).map((note) => (
                    <li key={note.session} className="flex flex-col gap-1 border-t pt-4" data-testid="course-note">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-semibold">
                          Session {note.session}: {note.title}
                        </p>
                        {note.day > 0 ? <Badge tone="primary">Next</Badge> : null}
                      </div>
                      <p className="text-xs text-ink-muted">{relativeDay(note.day, today)}</p>
                      <p className="text-sm text-ink">{note.text}</p>
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Tutor Match
// ---------------------------------------------------------------------------------------------

function TutorMatchPage() {
  const [subject, setSubject] = useState("");
  const shown = TUTORS.filter((t) => !subject || t.subjects.includes(subject));
  const taking = shown.filter((t) => t.taking).length;
  return (
    <section className="flex flex-col gap-6" data-testid="page-home">
      <PageHeading title="Find a tutor" summary={`${shown.length} ${shown.length === 1 ? "tutor" : "tutors"} · ${taking} taking new pupils`}>
        <div className="flex items-center gap-2">
          <Label htmlFor="subject" className="text-xs">
            Subject
          </Label>
          <Select id="subject" data-testid="tutor-subject" value={subject} onChange={(e) => setSubject(e.target.value)}>
            <option value="">Any subject</option>
            {TUTOR_SUBJECTS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </div>
      </PageHeading>
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="Tutors" data-testid="tutor-list">
        {shown.map((t) => (
          <li key={t.name} data-testid="tutor-item">
            <Card className="flex h-full flex-col">
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <CardTitle>{t.name}</CardTitle>
                  <Badge tone={t.taking ? "success" : "neutral"}>{t.taking ? "Taking new pupils" : "Full this term"}</Badge>
                </div>
                <p className="text-sm text-ink-muted">Ages {t.ages}</p>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col gap-3">
                <div className="flex flex-wrap gap-2">
                  {t.subjects.map((s) => (
                    <Badge key={s} tone="primary">
                      {s}
                    </Badge>
                  ))}
                </div>
                <p className="text-sm text-ink">{t.about}</p>
                <p className="mt-auto text-xs text-ink-muted">Free: {t.availability}</p>
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Stock Counter
// ---------------------------------------------------------------------------------------------

function StockCounterPage() {
  const low = STOCK.filter((s) => s.counted < s.par).length;
  const ago = (h: number) => (h < 24 ? `${h} hours ago` : "Yesterday");
  return (
    <section className="flex flex-col gap-6" data-testid="page-home">
      <PageHeading title="Today's count" summary={`${STOCK.length} items counted · ${low} below par`} />
      <div className="overflow-x-auto rounded-md border bg-surface shadow-card">
        <table className="w-full border-collapse text-sm" aria-label="Counted items" data-testid="stock-list">
          <thead>
            <tr className="border-b text-left">
              {["Item", "Where", "Counted", "Par", "Level", "Last counted"].map((h) => (
                <th key={h} scope="col" className="px-4 py-3 font-semibold">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {STOCK.map((s) => (
              <tr key={s.name} className="border-b last:border-b-0" data-testid="stock-item">
                <th scope="row" className="px-4 py-3 text-left font-semibold">
                  {s.name}
                </th>
                <td className="px-4 py-3 text-ink-muted">{s.where}</td>
                <td className="px-4 py-3">
                  {s.counted} {s.unit}
                </td>
                <td className="px-4 py-3 text-ink-muted">{s.par}</td>
                <td className="px-4 py-3">{s.counted < s.par ? <Badge tone="attention">Below par</Badge> : <Badge tone="success">Enough</Badge>}</td>
                <td className="px-4 py-3 text-xs text-ink-muted">
                  {s.countedBy} · {ago(s.hoursAgo)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Shift Rota
// ---------------------------------------------------------------------------------------------

function ShiftRotaPage({ me }: AppPageProps) {
  const today = new Date();
  const monday = mondayOf(today);
  const days = Array.from({ length: 7 }, (_, d) => dayFrom(monday, d));
  const todayIndex = (today.getDay() + 6) % 7;
  return (
    <section className="flex flex-col gap-6" data-testid="page-home">
      <PageHeading title="This week's rota" summary={`Week of ${dayName(monday)} · ${SHIFTS.length * 7} shifts · ${SWAPS.size} swaps asked for`} />
      <div className="overflow-x-auto rounded-md border bg-surface shadow-card">
        <table className="w-full border-collapse text-sm" aria-label="Shifts this week" data-testid="rota">
          <thead>
            <tr className="border-b">
              <th scope="col" className="px-4 py-3 text-left font-semibold">
                Shift
              </th>
              {days.map((d, i) => (
                <th key={i} scope="col" className={cn("px-3 py-3 text-left font-semibold", i === todayIndex && "bg-primary-tint")}>
                  {shortDay(d)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {SHIFTS.map((shift, s) => (
              <tr key={s} className="border-b align-top last:border-b-0" data-testid="shift-row">
                <th scope="row" className="px-4 py-3 text-left">
                  <span className="block font-semibold">{shift.role}</span>
                  <span className="font-mono text-xs text-ink-muted">{shift.hours}</span>
                </th>
                {days.map((_, d) => {
                  const who = rostered(s, d);
                  return (
                    <td key={d} className={cn("px-3 py-3", d === todayIndex && "bg-primary-tint")}>
                      <span className={me?.displayName === who ? "font-semibold text-primary" : "text-ink"}>{who}</span>
                      {SWAPS.has(`${s} ${d}`) ? (
                        <span className="mt-1 block">
                          <Badge tone="attention">Swap asked</Badge>
                        </span>
                      ) : null}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Pre-orders
// ---------------------------------------------------------------------------------------------

const ORDER_TONE: Record<OrderStatus, "neutral" | "primary" | "success" | "attention"> = { received: "neutral", baking: "attention", ready: "success", collected: "neutral" };

function PreOrdersPage() {
  const today = new Date();
  const open = ORDERS.filter((o) => o.status !== "collected").length;
  const days = [...new Set(ORDERS.map((o) => o.day))].sort((a, b) => a - b);
  return (
    <section className="flex flex-col gap-6" data-testid="page-home">
      <PageHeading title="Orders for collection" summary={`${ORDERS.length} orders · ${open} still to collect`} />
      {days.map((day) => (
        <div key={day} className="flex flex-col gap-3">
          <h2 className="font-display text-base font-semibold">{day === 0 ? `Today, ${shortDay(today)}` : relativeDay(day, today)}</h2>
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label={`Orders, ${relativeDay(day, today)}`} data-testid="order-list">
            {ORDERS.filter((o) => o.day === day).map((o) => (
              <li key={o.number} data-testid="order-item">
                <Card className="flex h-full flex-col">
                  <CardHeader>
                    <div className="flex items-start justify-between gap-3">
                      <CardTitle>
                        #{o.number} · {o.customer}
                      </CardTitle>
                      <Badge tone={ORDER_TONE[o.status]}>{ORDER_STATUS[o.status]}</Badge>
                    </div>
                    <p className="text-sm text-ink-muted">Collect at {o.at}</p>
                  </CardHeader>
                  <CardContent>
                    <ul className="flex flex-col gap-1 text-sm text-ink">
                      {o.items.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Homework Planner
// ---------------------------------------------------------------------------------------------

const HOMEWORK_TONE: Record<HomeworkStatus, "neutral" | "primary" | "success"> = { set: "primary", "handed-in": "success", marked: "neutral" };

function HomeworkPage() {
  const today = new Date();
  const due = HOMEWORK.filter((h) => h.status === "set").length;
  const sorted = [...HOMEWORK].sort((a, b) => a.due - b.due);
  return (
    <section className="flex flex-col gap-6" data-testid="page-home">
      <PageHeading title="Homework this week" summary={`${HOMEWORK.length} pieces this week · ${due} still to hand in`} />
      <ul className="flex flex-col gap-3" aria-label="Homework" data-testid="homework-list">
        {sorted.map((h, i) => (
          <li key={i} data-testid="homework-item">
            <Card>
              <CardContent className="flex flex-wrap items-center justify-between gap-4 pt-5">
                <div className="flex min-w-0 flex-col gap-1">
                  <p className="text-sm font-semibold">
                    {h.subject} · {h.task}
                  </p>
                  <p className="text-xs text-ink-muted">
                    {h.pupil} · set by {h.tutor}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-ink-muted">Due {Math.abs(h.due) <= 1 ? relativeDay(h.due, today).toLowerCase() : relativeDay(h.due, today)}</span>
                  <Badge tone={HOMEWORK_TONE[h.status]}>{HOMEWORK_STATUS[h.status]}</Badge>
                </div>
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Harbour Tide Board
// ---------------------------------------------------------------------------------------------

function TideBoardPage() {
  const today = new Date();
  return (
    <section className="flex flex-col gap-6" data-testid="page-home">
      <PageHeading title="Tides at the harbour" summary="High and low water for the next three days, in the harbour's local time" />
      <ul className="grid gap-4 lg:grid-cols-3" aria-label="Tides" data-testid="tide-list">
        {TIDES.map(({ day, tides }) => (
          <li key={day} data-testid="tide-day">
            <Card className="h-full">
              <CardHeader>
                <CardTitle>{day === 0 ? `Today, ${shortDay(today)}` : relativeDay(day, today)}</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="flex flex-col gap-2 text-sm">
                  {tides.map((t) => (
                    <li key={t.at} className="flex items-center justify-between gap-3">
                      <Badge tone={t.kind === "High" ? "primary" : "neutral"}>{t.kind} water</Badge>
                      <span className="font-mono">{t.at}</span>
                      <span className="text-ink-muted">{t.metres.toFixed(1)} m</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Any other app
// ---------------------------------------------------------------------------------------------

function GenericPage({ appName, me }: AppPageProps) {
  const [entries, setEntries] = useState(() => genericEntries(appName));
  const open = entries.filter((e) => !e.done).length;
  const toggle = (i: number) => setEntries((list) => list.map((e, j) => (j === i ? { ...e, done: !e.done } : e)));
  const ago = (d: number) => (d === 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`);
  return (
    <section className="flex flex-col gap-6" data-testid="page-home">
      <PageHeading title={appName} summary={`Kept here instead of the shared spreadsheet · ${open} open, ${entries.length - open} done`} />
      <ul className="flex flex-col gap-3" aria-label="Entries" data-testid="entry-list">
        {entries.map((e, i) => (
          <li key={e.text} data-testid="entry-item">
            <Card>
              <CardContent className="flex flex-wrap items-center justify-between gap-4 pt-5">
                <div className="flex min-w-0 flex-col gap-1">
                  <p className="text-sm font-semibold">{e.text}</p>
                  <p className="text-xs text-ink-muted">
                    Added by {e.by} · {ago(e.daysAgo)}
                  </p>
                </div>
                {me ? (
                  <KitButton variant={e.done ? "ghost" : "outline"} size="sm" onClick={() => toggle(i)}>
                    {e.done ? "Done" : "Mark done"}
                  </KitButton>
                ) : (
                  <Badge tone={e.done ? "success" : "neutral"}>{e.done ? "Done" : "Open"}</Badge>
                )}
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>
    </section>
  );
}
