import { describe, expect, it } from "vitest";
import { formatCredits, formatNumber, possessive } from "./format";

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

describe("possessive", () => {
  it("adds an apostrophe and s, or only the apostrophe after an s", () => {
    expect(possessive("Acme")).toBe("Acme’s");
    expect(possessive("Harbour Tutors")).toBe("Harbour Tutors’");
  });
});
