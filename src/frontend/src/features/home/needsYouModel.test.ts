import { describe, expect, it } from "vitest";
import { quotedIdea } from "./needsYouModel";

describe("quotedIdea (console-desktop 7)", () => {
  it("quotes a long idea up to its first clause break, a whole thought with no ellipsis inside the marks", () => {
    expect(quotedIdea("Allergen labels for the kitchen: pick a dish, print its label, and keep the list current")).toBe("Allergen labels for the kitchen");
    expect(quotedIdea("Paid online bookings for the kids' cookery club, with a waiting list and reminders")).toBe("Paid online bookings for the kids' cookery club");
  });

  it("cuts at a word with an ellipsis only when there is no break to end on", () => {
    const cut = quotedIdea("A live map of our two delivery vans for customers waiting at home to see where they are");
    expect(cut.endsWith("…")).toBe(true);
    expect(cut).not.toMatch(/\s…$/);
    expect(cut.length).toBeLessThanOrEqual(61);
  });

  it("leaves a short idea whole, and never ends on a break too early to say anything", () => {
    expect(quotedIdea("Pager")).toBe("Pager");
    expect(quotedIdea("A shop: one that sells kit to members, juniors and visiting teams, with stock counts")).not.toBe("A shop");
  });
});
