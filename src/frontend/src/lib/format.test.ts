import { describe, expect, it } from "vitest";
import { formatCredits, formatNumber, headlineCredits, headlineNumber, percent, possessive, share, tidyCreditAmounts } from "./format";
import { needLines } from "@/features/home/needsYouModel";

describe("formatNumber", () => {
  it("never shows a signed zero: a debt smaller than a tenth of a credit reads 0", () => {
    // Found on the real stack: an organisation 0.005 credits into its overdraft read "-0 credits left".
    expect(formatNumber(-0.005049)).toBe("0");
    expect(formatCredits(-0.04)).toBe("0 credits");
    expect(formatNumber(-0)).toBe("0");
  });

  it("keeps one decimal below ten and the sign of a real debt", () => {
    expect(formatNumber(-0.06)).toBe("-0.1");
    expect(formatNumber(2.46)).toBe("2.5");
    expect(formatNumber(-12.4)).toBe("-12");
    expect(formatNumber(9548)).toBe("9,548");
  });
});

describe("small amounts (D12)", () => {
  it("never rounds a real cost to nothing", () => {
    expect(formatNumber(0.05)).toBe("0.1");
    expect(formatNumber(0.04)).toBe("0.04");
    expect(formatCredits(0.045)).toBe("0.05 credits");
    expect(formatCredits(0.001)).toBe("less than 0.01 credits");
    expect(formatNumber(0)).toBe("0");
  });
});

describe("share (D16)", () => {
  it("is the true percentage, past 100, while percent stays clamped for a bar", () => {
    expect(share(16, 12.3)).toBe(130);
    expect(percent(16, 12.3)).toBe(100);
    expect(share(1, 0)).toBe(0);
  });
});

describe("possessive", () => {
  it("adds an apostrophe and s, or only the apostrophe after an s", () => {
    expect(possessive("Acme")).toBe("Acme’s");
    expect(possessive("Harbour Tutors")).toBe("Harbour Tutors’");
  });
});

describe("credit amounts in a server's sentence (D44)", () => {
  it("are rounded as the console rounds them, and nothing else is touched", () => {
    expect(tidyCreditAmounts("277.323824 credits are left in the budget.")).toBe("277 credits are left in the budget.");
    expect(tidyCreditAmounts("Only 0.25 credit is left; version 1.2.3 stays.")).toBe("Only 0.3 credit is left; version 1.2.3 stays.");
    expect(tidyCreditAmounts("12,345.678 credits")).toBe("12,346 credits");
  });

  it("on a needs-you card", () => {
    const raw = needLines({ kind: "approval", id: "a2", title: "Try again: Dive Trip Ready?", detail: "try_again: 075ba848-…", scope: "acme" } as never);
    // R2-5: a card raised before the plain-detail fix keeps its tool line for technical mode only.
    expect(raw).toMatchObject({ line: "It waits until you answer.", technical: "try_again: 075ba848-…" });
    const card = needLines({ kind: "approval", id: "a1", title: "Start this work? Estimated 0.5 credits.", detail: "277.323824 credits are left in the budget.", scope: "acme" } as never);
    expect(card.line).toBe("277 credits are left in the budget.");
  });
});

describe("a headline figure (R2-2)", () => {
  it("reads 0 when the amount rounds below a tenth, and the sentence form keeps the detail", () => {
    expect(headlineNumber(0.001)).toBe("0");
    expect(headlineNumber(0.04)).toBe("0");
    expect(headlineCredits(0.001)).toBe("0 credits");
    expect(formatCredits(0.001)).toBe("less than 0.01 credits");
  });

  it("reads every other amount as formatNumber does", () => {
    expect(headlineNumber(0)).toBe("0");
    expect(headlineNumber(0.06)).toBe("0.1");
    expect(headlineNumber(4.84)).toBe("4.8");
    expect(headlineNumber(1234)).toBe("1,234");
    expect(headlineCredits(1)).toBe("1 credit");
  });
});
