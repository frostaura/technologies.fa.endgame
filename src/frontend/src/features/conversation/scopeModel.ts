import { formatNumber } from "@/lib/format";
import type { Tree, TreeApp, TreeProject, Worker } from "@/store/types";
import type { Selection } from "@/store/uiSlice";

/**
 * What the conversation reads from the tree for the level it is at (ARCH-012): the apps and
 * employees beneath it (for "@"), and three things worth asking, built from what is really there.
 */

export interface ScopeApp {
  app: TreeApp;
  project: TreeProject;
  scope: string;
  trail: string[];
}

export interface ScopeEmployee {
  worker: Worker;
  /** The level the employee works at, a path of slugs. */
  scope: string;
  trail: string[];
}

export interface ScopeContents {
  apps: ScopeApp[];
  projects: { project: TreeProject; trail: string[] }[];
  employees: ScopeEmployee[];
}

function within(scope: string, path: string): boolean {
  return path === scope || path.startsWith(`${scope}/`);
}

/** Everything at and beneath a scope. */
export function contentsOf(tree: Tree, scope: string): ScopeContents {
  const org = tree.organisation;
  const out: ScopeContents = { apps: [], projects: [], employees: [] };
  if (!org) return out;
  const seen = new Set<string>();
  const add = (workers: Worker[], path: string, trail: string[]) => {
    for (const w of workers) {
      if (w.kind !== "employee" || seen.has(w.id) || !within(scope, path)) continue;
      seen.add(w.id);
      out.employees.push({ worker: w, scope: path, trail: [...trail, w.name] });
    }
  };
  add(org.workers, org.slug, [org.name]);
  for (const d of tree.divisions) {
    if (d.archived) continue;
    const dPath = `${org.slug}/${d.slug}`;
    add(d.workers, dPath, [org.name, d.name]);
    for (const p of d.projects) {
      if (p.archived) continue;
      const pPath = `${dPath}/${p.slug}`;
      if (within(scope, pPath) || within(pPath, scope)) add(p.workers, pPath, [org.name, d.name, p.name]);
      if (within(scope, pPath)) out.projects.push({ project: p, trail: [org.name, d.name, p.name] });
      for (const a of p.apps) {
        if (a.archived) continue;
        const aPath = `${pPath}/${a.slug}`;
        add(a.workers, aPath, [org.name, d.name, p.name, a.name]);
        if (within(scope, aPath)) out.apps.push({ app: a, project: p, scope: aPath, trail: [org.name, d.name, p.name, a.name] });
      }
    }
  }
  return out;
}

/** Up to three questions worth asking here, each from something that is really there. */
export function suggestedPrompts(tree: Tree, selection: Selection): string[] {
  const out: string[] = [];
  const push = (text: string | null) => {
    if (text && !out.includes(text) && out.length < 3) out.push(text);
  };
  const name = selection.trail[selection.trail.length - 1] ?? "";
  if (selection.kind === "employee") {
    const worker = contentsOf(tree, tree.organisation?.slug ?? "").employees.find((e) => e.worker.id === selection.employeeId)?.worker;
    push(worker?.activity ? `How is it going: ${worker.activity.replace(/[.]$/, "").toLowerCase()}?` : null);
    push(worker?.idle ? "You have had nothing to do for a while. What would you work on next?" : null);
    push("What do you remember about how we work here?");
    push("What are you working on, and what is next?");
    return out;
  }
  const here = contentsOf(tree, selection.scope);
  const down = here.apps.find((a) => a.app.health === "down");
  push(down ? `Why is ${down.app.name} down, and what would fix it?` : null);
  const waiting = tree.needsYou.length;
  if (selection.kind === "organisation") push(waiting > 0 ? `${waiting === 1 ? "One thing waits" : `${waiting} things wait`} for me. Which comes first?` : null);
  const busiest = [...here.apps].sort((a, b) => b.app.spend.monthCredits - a.app.spend.monthCredits)[0];
  push(busiest && busiest.app.spend.monthCredits > 0 ? `Why has ${busiest.app.name} cost ${formatNumber(busiest.app.spend.monthCredits)} credits this month?` : null);
  const building = here.projects.find((p) => p.project.progress);
  push(building ? `How far along is ${building.project.name}?` : null);
  if (selection.kind === "app" && here.apps[0]) push(`Who has used ${here.apps[0].app.name} this week?`);
  const idle = here.employees.find((e) => e.worker.idle);
  push(idle ? `What should ${idle.worker.name} work on next?` : null);
  push(here.apps.length > 1 ? `Which of the ${here.apps.length} apps in ${name} needs attention first?` : null);
  push(here.apps.length === 0 && selection.kind !== "app" ? `What could ${name} build first?` : null);
  const someone = here.employees[0];
  push(someone ? `What is ${someone.worker.name} working on, and what is next?` : null);
  push(selection.kind !== "organisation" ? `What has changed in ${name} this week?` : null);
  return out;
}

/** Where "@" sends a message: an employee or an app beneath this level. */
export interface Target {
  key: string;
  label: string;
  detail: string;
  kind: "employee" | "app";
  scope: string;
  trail: string[];
  employeeId?: string;
}

export function targetsOf(contents: ScopeContents, selection: { scope: string; employeeId?: string }): Target[] {
  const employees: Target[] = contents.employees
    .filter((e) => e.worker.id !== selection.employeeId)
    .map((e) => ({ key: `e:${e.worker.id}`, label: e.worker.name, detail: e.worker.role, kind: "employee", scope: e.scope, trail: e.trail, employeeId: e.worker.id }));
  const apps: Target[] = contents.apps.filter((a) => a.scope !== selection.scope).map((a) => ({ key: `a:${a.app.id}`, label: a.app.name, detail: `App in ${a.project.name}`, kind: "app", scope: a.scope, trail: a.trail }));
  return [...employees, ...apps];
}

/** Every employee's id by name in the organisation: the run log names who holds a task, the avatar's colour needs their id. */
export function employeeIds(tree: Tree): Map<string, string> {
  const out = new Map<string, string>();
  const add = (workers: Worker[]) => {
    for (const w of workers) if (w.kind === "employee" && !out.has(w.name)) out.set(w.name, w.id);
  };
  if (tree.organisation) add(tree.organisation.workers);
  for (const d of tree.divisions) {
    add(d.workers);
    for (const p of d.projects) {
      add(p.workers);
      for (const a of p.apps) add(a.workers);
    }
  }
  return out;
}
