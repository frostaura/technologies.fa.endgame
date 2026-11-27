import { useMemo } from "react";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { shortTitle } from "@/lib/plain";
import { useActiveTree } from "@/lib/useActiveOrganisation";
import type { Selection } from "@/store/uiSlice";
import { ConversationDock } from "../home/ConversationDock";
import { namesFor } from "../home/treeModel";
import type { ShellConversation } from "../shell/AppShell";

/** The level a scope path names, by its depth: organisation, division, project, app. */
export function levelOf(scope: string): Exclude<Selection["kind"], "employee"> {
  const depth = scope.split("/").filter(Boolean).length;
  return depth <= 1 ? "organisation" : depth === 2 ? "division" : depth === 3 ? "project" : "app";
}

/**
 * A page's conversation, scoped to the page's subject (ARCH-012), for the shell to dock beside it: an app's page talks
 * to that app, an employee's page to that employee, a piece of work's page and a verdict's page to the level the work
 * or the idea belongs to. Null `subject` (still loading, or a subject nobody talks to) gives the page none.
 */
export function usePageConversation(subject: { scope: string; employeeId?: string; name?: string } | null): ShellConversation | undefined {
  const tree = useActiveTree().data;
  const scope = subject?.scope ?? null;
  const employeeId = subject?.employeeId;
  const name = subject?.name;
  return useMemo(() => {
    if (!tree?.organisation || !scope) return undefined;
    const names = namesFor(tree, scope);
    const selection: Selection = employeeId
      ? { scope, kind: "employee", trail: [...names, name ?? "Employee"], employeeId }
      : { scope, kind: levelOf(scope), trail: names };
    const who = selection.trail[selection.trail.length - 1] ?? tree.organisation.name;
    return {
      label: `Talk to ${shortTitle(who, 32)}`,
      content: (
        <ErrorBoundary name="The conversation" resetKey={scope + (employeeId ?? "")}>
          <ConversationDock tree={tree} selection={selection} />
        </ErrorBoundary>
      ),
    };
  }, [tree, scope, employeeId, name]);
}
