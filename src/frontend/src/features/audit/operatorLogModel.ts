/** Admin actions whose title the control plane takes from its own description of the endpoint, said plainly here. */
const ADMIN_PLAIN: Record<string, string> = {
  EstimateConversation: "Asked what a message in the conversation would cost",
};

/**
 * Everything else an operator changed inside the organisation, as an Admin. The control plane titles each change;
 * one it has no title for carries the endpoint's own description ("What one message in the conversation at a scope
 * (or with one employee) is expected to cost, and the most it can"), which is API wording and never shown as the
 * line (real-stack 56): a known one is said plainly, any other as what it was.
 */
export function adminLine(action: string, title: string | null): string {
  if (!action.startsWith("admin.")) return "Acted on the organisation";
  const known = ADMIN_PLAIN[action.slice("admin.".length)];
  if (known) return `As an Admin: ${known}`;
  if (!title || apiWording(title)) return "Changed something as an Admin";
  return `As an Admin: ${title}`;
}

/** An endpoint's description rather than a title: long, a question word first, or a parenthesis aside. */
function apiWording(title: string): boolean {
  return title.length > 60 || /^(What|Which|How|Whether|Returns?|Gets?|Lists?)\b/.test(title) || /[()]/.test(title);
}
