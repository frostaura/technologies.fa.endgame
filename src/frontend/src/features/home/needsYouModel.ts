import { formatCredits, formatNumber, tidyCreditAmounts } from "@/lib/format";
import { firstSentence, plainDetail, shortTitle } from "@/lib/plain";
import type { NeedsYou, VerdictOutcome } from "@/store/types";

const SAYS: Record<VerdictOutcome, string> = { build: "build", change: "change", "do-not-build": "do not build" };

/** Opening phrases research writes before the substance; they say nothing on their own. */
const PREAMBLE = /^(the case against(,)? (argued )?first\.?|verdict:\s*)/i;

/** A figure written to six places ("277.323824 credits") read the way the console writes figures ("277 credits") (D44). */
export function tidyFigures(text: string): string {
  return text.replace(/(?<![\d.])\d+\.\d{3,}(?![\d.])/g, (n) => formatNumber(Number(n)));
}

/** The first sentence that says something, skipping research's own preamble. */
export function meaningfulLine(detail: string | null, max = 150): string | null {
  if (!detail) return null;
  let rest = tidyCreditAmounts(tidyFigures(detail)).replace(/\s+/g, " ").trim();
  for (let i = 0; i < 3 && PREAMBLE.test(rest); i++) rest = rest.replace(PREAMBLE, "").trim();
  return rest ? firstSentence(rest, max) : null;
}

/**
 * What a "needs you" card says: one headline and one line, never more. A verdict's whole summary
 * belongs on the verdict page; the card only says what research concluded and why, in a line.
 */
export function needLines(item: NeedsYou): { headline: string; line: string; technical: string | null } {
  // A card raised before the plain-detail fix may carry a raw tool line as its detail: technical mode only (R2-5).
  const { detail, technical } = plainDetail(item.detail, item.kind === "approval" ? item.technical : null);
  return { ...cardLines({ ...item, detail } as NeedsYou), technical };
}

function cardLines(item: NeedsYou): { headline: string; line: string } {
  switch (item.kind) {
    case "verdict": {
      const headline = /^research says/i.test(item.title) ? shortTitle(item.title, 90) : `Research says ${SAYS[item.verdict]} “${shortTitle(item.title.replace(/^a verdict is waiting:\s*/i, ""), 60)}”`;
      return { headline, line: meaningfulLine(item.detail) ?? (item.verdict === "do-not-build" ? "Read it, or overrule." : "Read it, then decide.") };
    }
    case "hire":
      return { headline: shortTitle(item.title, 90), line: `About ${formatCredits(item.expectedMonthlyCredits)} a month.${item.detail ? ` ${meaningfulLine(item.detail, 110) ?? ""}` : ""}`.trim() };
    case "approval":
      return { headline: shortTitle(tidyFigures(item.title), 90), line: meaningfulLine(item.detail) ?? "It waits until you answer." };
    case "idle":
      return { headline: shortTitle(item.title, 90), line: meaningfulLine(item.detail) ?? "Let it go, or give it work." };
  }
}
