import { describe, expect, it } from "vitest";
import { formatCredits, formatNumber, headlineCredits, headlineNumber, percent, possessive, share, signedNumber, tidyCreditAmounts } from "./format";
import { spentAgainst } from "./estimates";
import { needLines } from "@/features/home/needsYouModel";

describe("formatNumber: one precision rule (ARCH-011)", () => {
  it("never shows a signed zero: a debt too small to show reads 0", () => {
    // Found on the real stack: an organisation 0.005 credits into its overdraft read "-0 credits left".
    expect(formatNumber(-0.004)).toBe("0");
    expect(formatCredits(-0.001)).toBe("0 credits");
    expect(formatNumber(-0)).toBe("0");
  });

  it("is whole from 10, up to two decimals below, and writes a debt with a true minus tight to its digits", () => {
    expect(formatNumber(-0.06)).toBe("\u22120.06");
    expect(formatNumber(2.46)).toBe("2.46");
    expect(formatNumber(7.5)).toBe("7.5");
    expect(formatNumber(2.9)).toBe("2.9");
    expect(formatNumber(-12.4)).toBe("\u221212");
    expect(formatNumber(-120)).toBe("\u2212120");
    expect(formatNumber(9548)).toBe("9,548");
    expect(signedNumber(3000)).toBe("+3,000");
    expect(signedNumber(-120)).toBe("\u2212120");
  });
});

describe("small amounts (D12)", () => {
  it("never rounds a real cost to nothing", () => {
    expect(formatNumber(0.05)).toBe("0.05");
    expect(formatNumber(0.04)).toBe("0.04");
    expect(formatCredits(0.045)).toBe("0.05 credits");
    expect(formatCredits(0.001)).toBe("<0.01 credits");
    expect(formatNumber(0)).toBe("0");
  });

  it("is singular only when what shows is exactly 1", () => {
    expect(formatCredits(1)).toBe("1 credit");
    expect(formatCredits(1.001)).toBe("1 credit");
    expect(formatCredits(1.5)).toBe("1.5 credits");
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
    expect(tidyCreditAmounts("Only 0.253 credit is left; version 1.2.3 stays.")).toBe("Only 0.25 credit is left; version 1.2.3 stays.");
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

describe("a headline figure", () => {
  it("follows the same rule as every other number", () => {
    expect(headlineNumber(0.001)).toBe("<0.01");
    expect(headlineNumber(0)).toBe("0");
    expect(headlineNumber(4.84)).toBe("4.84");
    expect(headlineNumber(1234)).toBe("1,234");
    expect(headlineCredits(1)).toBe("1 credit");
  });
});

describe("spent against an estimate", () => {
  it("never raises an alarm against an estimate too small to measure", () => {
    expect(spentAgainst(0.1, 0, true)).toMatchObject({ label: "Spent", caption: "Under 1 credit, as estimated", meter: null, over: false });
    expect(spentAgainst(3, 0.4, false)).toMatchObject({ label: "Spent so far", caption: "Estimated under 1 credit", meter: null });
  });

  it("draws a bar only while the work is under way, red only past a real estimate", () => {
    expect(spentAgainst(19, 56, true)).toMatchObject({ label: "Spent", caption: "34% of the 56 estimated", meter: null });
    expect(spentAgainst(16, 12.3, false).meter).toMatchObject({ value: 100, tone: "bad" });
  });
});
