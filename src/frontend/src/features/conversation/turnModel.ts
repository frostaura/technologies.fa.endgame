import type { ConversationAttachment, ConversationMessage, ConversationTurn, RunEvent } from "@/store/types";
import { isReply } from "../home/conversationModel";

/**
 * A conversation's thread as turns (ARCH-012): each message a person sent, and everything its run said and did after
 * it, in one fixed order — who answers, the steps it took, its reply, any approval it asked for (answered, a receipt;
 * waiting, the question itself), the reply after that answer in a bubble of its own, then the work it started.
 */

export interface SaidLine {
  seq: number;
  text: string;
  by: string | null;
}

export interface HistoryTurn {
  key: string;
  runId: string;
  /** The person's own message, with who sent it; null for a turn whose opening message fell outside the history. */
  owner: { text: string; by: string | null; attachments: ConversationAttachment[]; at: string } | null;
  replies: SaidLine[];
  /** Endgame's own notices (a budget stop, a closing word), each with its reason. */
  notices: (SaidLine & { code: string | null })[];
  info: ConversationTurn | null;
}

/** The history as turns, one per run, in the order they were said. Bookkeeping messages are already left out by the server. */
export function turnsOf(messages: readonly ConversationMessage[], info: readonly ConversationTurn[]): HistoryTurn[] {
  const byRun = new Map<string, HistoryTurn>();
  const order: HistoryTurn[] = [];
  const infos = new Map(info.map((t) => [t.runId, t]));
  for (const m of messages) {
    let turn = byRun.get(m.runId);
    if (!turn) {
      turn = { key: `${m.runId}-${m.seq}`, runId: m.runId, owner: null, replies: [], notices: [], info: infos.get(m.runId) ?? null };
      byRun.set(m.runId, turn);
      order.push(turn);
    }
    if (m.from === "owner") {
      if (turn.owner) {
        turn.owner.text = [turn.owner.text, m.text].filter(Boolean).join("\n\n");
        turn.owner.attachments.push(...m.attachments);
      } else turn.owner = { text: m.text, by: m.by, attachments: [...m.attachments], at: m.at };
    } else if (m.from === "runner") turn.notices.push({ seq: m.seq, text: m.text, by: null, code: m.code });
    else if (isReply(m)) turn.replies.push({ seq: m.seq, text: m.text, by: m.by });
  }
  return order;
}

/** An approval the turn asked for, as the thread keeps it once answered: what was proposed, the answer, by whom, when, the note. */
export interface Receipt {
  id: string;
  seq: number;
  question: string;
  answer: "approved" | "rejected" | "expired" | "pending";
  by: string | null;
  at: string | null;
  note: string | null;
}

/** Every approval in a run's log, in order, with its answer when it has one. */
export function receiptsOf(events: readonly RunEvent[]): Receipt[] {
  const out = new Map<string, Receipt>();
  for (const e of events) {
    const p = e.payload ?? {};
    if (e.type === "approval.requested") {
      const id = text(p.approvalId) ?? `approval-${e.seq}`;
      out.set(id, { id, seq: e.seq, question: text(p.title) ?? text(p.question) ?? "Your approval was asked for.", answer: "pending", by: null, at: null, note: null });
    } else if (e.type === "approval.answered") {
      const r = out.get(text(p.approvalId) ?? "");
      if (!r) continue;
      const answer = text(p.answer);
      r.answer = answer === "approved" || answer === "rejected" || answer === "expired" ? answer : "approved";
      r.by = text(p.byName);
      r.at = e.at || null;
      r.note = text(p.comment) ?? text(p.note);
    }
  }
  return [...out.values()];
}

export type Segment = { kind: "bubble"; lines: SaidLine[] } | { kind: "approval"; receipt: Receipt };

/**
 * A turn's replies and approvals in the order they happened: replies before an approval in one bubble, the approval
 * (its receipt once answered), and what was said after it in a bubble of its own — never one bubble mixing the two.
 */
export function segmentsOf(replies: readonly SaidLine[], receipts: readonly Receipt[]): Segment[] {
  const items: ({ seq: number; line: SaidLine } | { seq: number; receipt: Receipt })[] = [...replies.map((line) => ({ seq: line.seq, line })), ...receipts.map((receipt) => ({ seq: receipt.seq, receipt }))].sort((a, b) => a.seq - b.seq);
  const out: Segment[] = [];
  for (const item of items) {
    if ("receipt" in item) out.push({ kind: "approval", receipt: item.receipt });
    else {
      const last = out[out.length - 1];
      if (last?.kind === "bubble") last.lines.push(item.line);
      else out.push({ kind: "bubble", lines: [item.line] });
    }
  }
  return out;
}

/** How long ago an answer was given, as a time of day for today and a date before. */
export function answeredAt(at: string | null, now: Date = new Date()): string | null {
  if (!at) return null;
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return null;
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay ? d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** A turn's run ended with nothing said for it — no reply and no notice — so the thread says so and offers to ask again. */
export function interrupted(status: string | null, replies: number, notices: number): boolean {
  return (status === "failed" || status === "cancelled") && replies === 0 && notices === 0;
}

function text(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}
