import { describe, expect, it } from "vitest";
import { CHECK_LINES, evaluationDetail } from "./runModel";

/**
 * The escalation guard as the run page tells it (R7-4): a part stopped because the check itself needs a look — the checker
 * found it working, code's own reading of its calls disagreed twice, and the repair between changed nothing in the app.
 */
const judgement = {
  item: "seats",
  text: "Members can claim a seat on a dive, once.",
  summary: "Not sent back for repair: the check needs a look. The checker found it working, the factory's own reading of its calls disagreed twice, and the repair between found nothing in the app to change, so nothing in it was shown not to work: Members can claim a seat on a dive, once (0 of 1 of your requirements shown working in the running app).",
  final: true,
  needsLook: true,
  trigger: [{ id: "r1", kind: "not-met", calls: ["member-a PUT api/dives/d1/signup → 201 (id s3)", "member-a PUT api/dives/d1/signup → 201 (id s4)"] }],
  requirements: [{ id: "r1", text: "Members join a dive once to claim a seat on the boat", met: false, evidence: "One seat, found again.", calls: [] }],
  failing: ["r1:not-met"],
  evidence: "make test passed.",
  faults: ["Requirement r1 … made a second record (id s3, then id s4)."],
};

describe("a check that needs a look", () => {
  it("says so plainly, and never that the requirement does not work", () => {
    const normal = evaluationDetail(judgement, "normal") ?? "";
    expect(normal).toContain(CHECK_LINES.needsLook);
    expect(normal).toContain("“Members join a dive once to claim a seat on the boat”: the checker found it working; only the factory’s own reading of its calls disagreed.");
    expect(normal).not.toContain("it does not work yet");
    expect(normal).not.toMatch(/api\/|PUT/);
  });

  it("shows the calls the check read in technical mode", () => {
    const technical = evaluationDetail(judgement, "technical") ?? "";
    expect(technical).toContain("Needs a look (r1): member-a PUT api/dives/d1/signup → 201 (id s3) · member-a PUT api/dives/d1/signup → 201 (id s4)");
  });
});
