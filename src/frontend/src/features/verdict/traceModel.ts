import type { TimelineItem } from "../runs/timeline";

export type TraceLine = { key: string; title: string; outcome: string | null; state: "working" | "done" | "stopped" };

/**
 * The research run's parts, as the run's own page names them — each strand and the judging, once, with how it
 * ended. The run's own messages ("Work started", what was asked) stay on the run's page.
 */
export function traceLines(items: readonly TimelineItem[], stopped: boolean): TraceLine[] {
  const lines: TraceLine[] = items.flatMap((item) => (item.kind === "group" ? [{ key: item.key, title: item.title, outcome: item.outcome, state: item.status }] : []));
  if (!stopped) return lines;
  // A run that stopped leaves nothing working: whatever was under way when it stopped is where it stopped; when
  // every part it began had finished, it stopped before the verdict was written.
  const ended = lines.map((l) => (l.state === "working" ? { ...l, state: "stopped" as const } : l));
  return ended.some((l) => l.state === "stopped") ? ended : [...ended, { key: "stopped", title: "Writing the verdict", outcome: null, state: "stopped" as const }];
}

