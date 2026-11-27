import { approxCredits, formatCredits, formatNumber } from "@/lib/format";
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

/**
 * What a message costs, before it is sent (D77). The usual figure leads; a ceiling far above it (more than 20 times) is
 * said as a separate sentence, so "at most 169, usually about 0" never reads as a 169-credit message.
 */
export function messageCostLine(credits: number, ceiling: number | null): string {
  if (ceiling === null) return `A message here is estimated at ${approxCredits(credits)}.`;
  if (ceiling > 20 * Math.max(credits, 0.01)) {
    const usual = credits < 1 ? "Usually well under 1 credit." : `Usually about ${formatCredits(credits)}.`;
    return `${usual} It can never cost more than ${formatNumber(ceiling)}, the most its steps could cost; it is charged at what it actually costs.`;
  }
  const usual = credits < 0.1 ? approxCredits(credits) : `about ${formatCredits(credits)}`;
  return `A message here costs at most ${formatCredits(ceiling)}, usually ${usual}; it is charged at what it actually costs.`;
}

/**
 * The same, as one short line under the composer (finding 23): the figures only, the same words before and after a
 * reload; the full sentence ({@link messageCostLine}) is its tooltip.
 */
export function messageCostShort(credits: number, ceiling: number | null): string {
  if (ceiling === null) return `A message here is estimated at ${approxCredits(credits)}.`;
  if (ceiling > 20 * Math.max(credits, 0.01)) {
    const usual = credits < 1 ? "well under 1 credit" : `about ${formatCredits(credits)}`;
    return `A message here usually costs ${usual}, never more than ${formatNumber(ceiling)}.`;
  }
  const usual = credits < 0.1 ? "less than 0.1" : `about ${formatNumber(credits)}`;
  return `A message here costs at most ${formatCredits(ceiling)}, usually ${usual}.`;
}
