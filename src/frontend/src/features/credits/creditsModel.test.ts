import { describe, expect, it } from "vitest";
import { paceLine } from "./creditsModel";

describe("paceLine", () => {
  it("never says about 0 months", () => {
    expect(paceLine({ balance: 0, monthsLeftAtPace: 0, overdraft: null })).toBe("Nothing is left to spend. A top-up starts the work again.");
    expect(paceLine({ balance: 50, monthsLeftAtPace: 0.3, overdraft: null })).toBe("At this month’s pace, it runs out within the month.");
    expect(paceLine({ balance: 500, monthsLeftAtPace: 3.4, overdraft: null })).toBe("At this month’s pace, about 3 months.");
    expect(paceLine({ balance: 500, monthsLeftAtPace: null, overdraft: null })).toContain("no pace to project");
  });

  it("says what is left of the overdraft when below zero, using the tighter of the two limits", () => {
    expect(paceLine({ balance: -200, monthsLeftAtPace: 0, overdraft: { frostauraLimit: 3000, ownLimit: 1000, limits: [] } })).toBe("You are below zero. 800 credits more can be spent before work stops; the next top-up settles the debt first.");
    expect(paceLine({ balance: -1000, monthsLeftAtPace: null, overdraft: { frostauraLimit: 1000, ownLimit: null, limits: [] } })).toContain("at your limit");
  });
});
