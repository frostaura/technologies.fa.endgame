import { describe, expect, it } from "vitest";
import { CHECK_LINES, evaluationDetail } from "./runModel";
import { isPlain } from "@/lib/plain";

/**
 * R7-1 as the run page tells it: a part whose form did not hold up against a bad value (code ran the page's own tests and
 * the field's bad-input test failed, or there was none) says so in plain words, never as the gate's `form:dive-when:broken`.
 */
const failed = {
  item: "add-dive",
  text: "Members add a dive with its site and when it happens.",
  summary: "Sent back for repair, at no charge: Members add a dive with its site and when it happens (1 of 1 of your requirements shown working in the running app).",
  requirements: [{ id: "r1", text: "Members add a dive with its site and when it happens", met: true, evidence: "POST api/dives → 201", calls: ["POST api/dives"] }],
  failing: ["form:dive-when:broken"],
  evidence: "make test and make lint exit 0.",
  faults: ["The form broke on a bad value in its date field dive-when (web/src/dives/NewDivePage.tsx): …"],
};

describe("a form that did not hold up against bad input", () => {
  it("is said plainly in normal mode, and by its kind in technical mode", () => {
    const normal = evaluationDetail(failed, "normal") ?? "";
    expect(normal).toContain(CHECK_LINES.formBroke);
    expect(normal).not.toContain("form:");
    expect(isPlain(CHECK_LINES.formBroke)).toBe(true);
    expect(evaluationDetail(failed, "technical")).toContain("Failing: form:dive-when:broken");
  });

  it("says a field with no bad-input test yet apart from one that broke", () => {
    const untested = evaluationDetail({ ...failed, failing: ["form:dive-when:untested", "form:dive-site:untested"] }, "normal") ?? "";
    expect(untested).toContain(CHECK_LINES.formUntested);
    expect(untested).not.toContain(CHECK_LINES.formBroke);
    expect(isPlain(CHECK_LINES.formUntested)).toBe(true);
  });

  it("names the page's tests, not its calls, when the check that needs a look was the form's", () => {
    const stopped = { ...failed, final: true, needsLook: true, trigger: [{ id: "form:dive-when", kind: "broken", calls: ["web/src/dives/NewDivePage.test.tsx > holds up against bad input: dive-when → failed"] }] };
    const normal = evaluationDetail(stopped, "normal") ?? "";
    expect(normal).toContain(CHECK_LINES.needsLookForm);
    expect(normal).not.toContain(CHECK_LINES.needsLook);
    expect(evaluationDetail(stopped, "technical")).toContain("Needs a look (form:dive-when): web/src/dives/NewDivePage.test.tsx > holds up against bad input: dive-when → failed");
  });
});
