import type { BadgeTone } from "@/components/ui/badge";
import { formatNumber } from "@/lib/format";
import type { DerivedPlan, DerivedRun, DerivedTask, PlanItem } from "./runModel";

/** A run's tasks as its page says them: under the part of the plan each is for, and the rest on their own. */

/**
 * Whether the work has tasks the plan does not already show. A part's tasks (its build and its checks) are said under that part
 * in the plan, so the Tasks card holds only the rest — a review, or the tasks of work with no plan yet — and is not drawn
 * until there is one: an empty card saying so was noise.
 */
export function hasLooseTasks(derived: Pick<DerivedRun, "tasks" | "plan">): boolean {
  return derived.tasks.some((t) => !partOfTask(t, derived.plan));
}

/** The plan item a task is for: its build carries the item's words, its checks "Check: " and the same words. */
export function partOfTask(task: DerivedTask, plan: DerivedPlan | null): PlanItem | undefined {
  const words = task.summary.startsWith("Check: ") ? task.summary.slice("Check: ".length) : task.summary;
  return plan?.items.find((i) => i.text === words);
}

export const TASK_STATUS: Record<DerivedTask["status"], { label: string; tone: BadgeTone }> = {
  open: { label: "To do", tone: "neutral" },
  working: { label: "In progress", tone: "info" },
  done: { label: "Done", tone: "good" },
  failed: { label: "Did not succeed", tone: "bad" },
};

/** A part's tasks named by what each is — its build and its checks — rather than by the part's words again. */
export function partTasks(item: PlanItem, tasks: readonly DerivedTask[]): { task: DerivedTask; role: string }[] {
  const out: { task: DerivedTask; role: string }[] = [];
  let checks = 0;
  for (const task of tasks) {
    const check = task.summary.startsWith("Check: ");
    if ((check ? task.summary.slice("Check: ".length) : task.summary) !== item.text) continue;
    if (check) checks += 1;
    out.push({ task, role: check ? (checks === 1 ? "Check" : `Check ${formatNumber(checks)}`) : item.id === "keep" ? "Check again" : "Build" });
  }
  return out;
}

/** A task's state in a few words after its name: "Build: done by Rosa", "Check 2: in progress, Kasper". */
function taskWords(role: string, task: DerivedTask): string {
  const state = TASK_STATUS[task.status].label.toLowerCase();
  if (!task.holder) return `${role}: ${state}`;
  return task.status === "done" ? `${role}: ${state} by ${task.holder}` : `${role}: ${state}, ${task.holder}`;
}

/**
 * The line's phrases: checks in a row that ended the same way for the same holder are said once ("3 checks: done by Nadia"),
 * so a part sent back four times reads as four checks, not four phrases.
 */
export function taskPhrases(tasks: readonly { task: DerivedTask; role: string }[]): { key: string; text: string; failed: boolean }[] {
  const out: { key: string; text: string; failed: boolean; role: string; task: DerivedTask; n: number }[] = [];
  for (const t of tasks) {
    const last = out.at(-1);
    if (last && t.role.startsWith("Check") && last.role.startsWith("Check") && last.task.status === t.task.status && last.task.holder === t.task.holder) {
      last.n += 1;
      last.text = taskWords(`${formatNumber(last.n)} checks`, t.task);
      continue;
    }
    out.push({ key: t.task.id, text: taskWords(t.role, t.task), failed: t.task.status === "failed", role: t.role, task: t.task, n: 1 });
  }
  return out.map(({ key, text, failed }) => ({ key, text, failed }));
}
