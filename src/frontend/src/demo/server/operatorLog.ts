import { newId, user, type World } from "./world";

/**
 * God mode is never silent (`OperatorActionLog.cs`): every change an operator makes inside an
 * organisation they entered as an Admin is one entry in its operator log, `admin.<endpoint>`, with
 * the plain title its Owner reads. Nothing from the request body is recorded. A handler for a new
 * endpoint that changes something adds its title here.
 */
const TITLES: Record<string, string> = {
  "PATCH organisations/{id}": "Renamed, suspended or reinstated the organisation",
  "POST members": "Gave someone a role",
  "PATCH members/{membershipId}": "Changed someone's role",
  "DELETE members/{membershipId}": "Removed someone's role",
  "POST members/{membershipId}/invitation": "Sent someone a new invitation code",
  "PUT credits/overdraft": "Set a tighter overdraft limit",
  "PUT secrets": "Set a secret",
  "DELETE secrets": "Removed a secret",
  "POST apps/{id}/shares": "Shared an app",
  "DELETE apps/{id}/shares": "Stopped sharing an app",
  "POST apps/{id}/settings": "Changed how an app runs or who may open it",
  "POST apps/{id}/versions/{commit}/restore": "Restored an earlier version of an app",
  "POST apps/{id}/ask": "Asked a question of an app's data",
  "POST apps/{id}/dashboard": "Saved a question to an app's dashboard",
  "DELETE apps/{id}/dashboard/{questionId}": "Removed a question from an app's dashboard",
  "POST ideas": "Started research on an idea",
  "POST ideas/{id}/decision": "Decided on a verdict",
  "POST ideas/suggestions": "Asked for ideas from the portfolio",
  "POST runs/{id}/pause": "Paused a piece of work",
  "POST runs/{id}/resume": "Resumed a piece of work",
  "POST runs/{id}/cancel": "Cancelled a piece of work",
  "POST runs/{runId}/approvals/{approvalId}": "Answered an approval",
  "POST runs/{id}/retry": "Started stopped work again",
  "POST apps/{id}/changes": "Asked for a change to an app",
  "POST conversations": "Wrote in a conversation",
  "POST hires/{id}/accept": "Accepted a hire",
  "POST hires/{id}/decline": "Declined a hire",
  "PATCH hires/{id}": "Changed a hire proposal",
  "POST hires": "Asked for a hire",
  "PATCH employees/{id}": "Changed an employee",
  "POST employees/{id}/stop": "Stopped a contractor",
  "POST employees/{id}/reassign": "Moved an employee",
  "POST employees/{id}/release": "Let an employee go",
  "POST employees/{id}/rehire": "Rehired an employee",
  "POST employees/{id}/memory": "Added to an employee's memory",
  "PATCH employees/{id}/memory/{entryId}": "Corrected an employee's memory",
  "DELETE employees/{id}/memory/{entryId}": "Removed from an employee's memory",
  "POST employees/{id}/reviews": "Started a review of an employee's memory",
  "PUT autonomy": "Changed how much is decided automatically",
  "DELETE autonomy": "Removed an autonomy setting",
  "PUT autonomy/rule-sets": "Changed a stage's rules",
  "DELETE autonomy/rule-sets": "Removed a stage's rules",
  "POST tokens": "Made a key for an AI assistant",
  "DELETE tokens/{id}": "Revoked an AI assistant's key",
  "POST ideas/suggestions/{id}/take": "Took a suggested idea",
  "POST ideas/suggestions/{id}/dismiss": "Dismissed a suggested idea",
};

/** Routes registered with a placeholder for the last segment name their concrete action here. */
function key(method: string, pattern: string, path: string): string {
  const last = path.split("/").pop() ?? "";
  return `${method} ${pattern.replace(/\{(action|decision)\}$/, last)}`;
}

export function logOperatorAction(world: World, method: string, pattern: string, path: string) {
  const acted = world.actedAsOperator ?? [];
  world.actedAsOperator = [];
  const op = user(world, world.sessionUserId);
  if (!op?.isOperator || acted.length === 0) return;
  const name = key(method, pattern, path);
  const title = TITLES[name] ?? "Changed something as an Admin";
  for (const org of acted) {
    world.operatorLog.unshift({
      id: newId(world, "op"),
      organisation: org,
      at: new Date().toISOString(),
      action: `admin.${name.replace(/[^A-Za-z]+/g, "-").replace(/^-|-$/g, "")}`,
      operator: { id: op.id, email: op.email, displayName: op.displayName },
      detail: { title, scope: org, method, path: `/api/${path}` },
    });
  }
  world.changed.push("OperatorAccess");
}
