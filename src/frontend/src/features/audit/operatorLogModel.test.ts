import { describe, expect, it } from "vitest";
import { adminLine } from "./operatorLogModel";

describe("an Admin action in the operator log (real-stack 56)", () => {
  it("keeps the control plane's own title", () => {
    expect(adminLine("admin.AcceptHire", "Accepted a hire")).toBe("As an Admin: Accepted a hire");
  });

  it("never shows an endpoint's description as the line", () => {
    const summary = "What one message in the conversation at a scope (or with one employee) is expected to cost, and the most it can";
    expect(adminLine("admin.EstimateConversation", summary)).toBe("As an Admin: Asked what a message in the conversation would cost");
    expect(adminLine("admin.SomethingNew", summary)).toBe("Changed something as an Admin");
    expect(adminLine("admin.SomethingNew", null)).toBe("Changed something as an Admin");
  });

  it("is not an Admin action without the prefix", () => {
    expect(adminLine("organisation.other", "x")).toBe("Acted on the organisation");
  });
});
