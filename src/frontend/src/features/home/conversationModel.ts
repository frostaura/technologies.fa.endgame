/**
 * What the conversation shows of a run's messages. The runner closes every run with a word of its
 * own (a message from "runner" with no `code`); in a conversation the reply already is that word,
 * so once a run has replied its closing word is never printed beside it — not as a repeat of the
 * reply (D49), and not as "technical mode has the details" in place of it (D10). Notices that carry
 * a code (the budget ran out, waiting for budget) are news of their own and always stay.
 */

export interface SaidLine {
  from: string | null;
  text: string;
  code?: string | null;
}

export function isReply(m: SaidLine): boolean {
  return m.from !== "owner" && m.from !== "runner";
}

/** The runner's notices worth printing for one run, given what it replied. */
export function noticesToShow<T extends SaidLine>(messages: readonly T[]): T[] {
  const replies = new Set(messages.filter(isReply).map((m) => normalise(m.text)));
  const seen = new Set<string>();
  return messages.filter((m) => {
    if (m.from !== "runner") return false;
    const key = normalise(m.text);
    if (seen.has(key) || replies.has(key)) return false;
    if (!m.code && replies.size > 0) return false;
    seen.add(key);
    return true;
  });
}

/** The conversation's history with each run's closing word left out where that run replied. */
export function withoutClosingRepeats<T extends SaidLine & { runId: string }>(messages: readonly T[]): T[] {
  const replied = new Set(messages.filter(isReply).map((m) => m.runId));
  return messages.filter((m) => m.from !== "runner" || !!m.code || !replied.has(m.runId));
}

/** Replies with the same words said twice in one run are printed once. */
export function distinctReplies<T extends SaidLine>(messages: readonly T[]): T[] {
  const seen = new Set<string>();
  return messages.filter((m) => {
    if (!isReply(m)) return false;
    const key = normalise(m.text);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalise(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
