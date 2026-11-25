import { describe, expect, it } from "vitest";
import type { BudgetLine } from "@/store/types";
import { capAbove, noCapLine, paceLine } from "./creditsModel";

describe("paceLine", () => {
  it("never says about 0 months", () => {
    expect(paceLine({ balance: 0, monthsLeftAtPace: 0, overdraft: null })).toBe("Nothing is left to spend, and there is no overdraft, so work waits for a top-up.");
    expect(paceLine({ balance: 50, monthsLeftAtPace: 0.3, overdraft: null })).toBe("At this month’s pace, it runs out within the month.");
    expect(paceLine({ balance: 500, monthsLeftAtPace: 3.4, overdraft: null })).toBe("At this month’s pace, about 3 months.");
    expect(paceLine({ balance: 500, monthsLeftAtPace: null, overdraft: null })).toContain("no pace to project");
  });

  it("says what is left of the overdraft when below zero, using the tighter of the two limits", () => {
    expect(paceLine({ balance: -200, monthsLeftAtPace: 0, overdraft: { frostauraLimit: 3000, ownLimit: 1000, limits: [] } })).toBe("You are below zero. 800 credits more can be spent before work stops; the next top-up settles the debt first.");
    expect(paceLine({ balance: -1000, monthsLeftAtPace: null, overdraft: { frostauraLimit: 1000, ownLimit: null, limits: [] } })).toContain("at your limit");
  });
});

describe("at zero", () => {
  it("says work carries on into the overdraft when there is one, instead of saying it stopped", () => {
    expect(paceLine({ balance: 0, monthsLeftAtPace: 0, overdraft: { frostauraLimit: 3000, ownLimit: 1000, limits: [] } })).toBe(
      "Nothing is left above zero. Work carries on into the overdraft, down to 1,000 credits below zero; the next top-up settles it.",
    );
  });
});

describe("the cap that holds a row", () => {
  const row = (scope: string, level: BudgetLine["level"], capCredits: number | null, name = scope): BudgetLine => ({ scope, name, level, depth: scope.split("/").length - 1, spentCredits: 0, capCredits, appId: null, employeeId: null });
  const lines = [row("acme", "organisation", null, "Acme"), row("acme/labs", "division", 500, "Labs"), row("acme/labs/x", "project", null, "X"), row("acme/labs/x", "employee", 40, "Ada"), row("acme/web", "division", null, "Web")];

  it("is the nearest level above with a cap, and an employee is held by its own node first", () => {
    expect(capAbove(lines, lines[2] as BudgetLine)?.name).toBe("Labs");
    expect(noCapLine(lines, lines[2] as BudgetLine)).toBe("No cap here; the cap on Labs, 500 credits, holds");
  });

  it("says so when nothing above has one, instead of pointing at a cap that does not exist", () => {
    expect(capAbove(lines, lines[4] as BudgetLine)).toBeNull();
    expect(noCapLine(lines, lines[0] as BudgetLine)).toBe("No cap here or above it");
  });
});
