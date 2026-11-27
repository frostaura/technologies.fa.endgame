import { describe, expect, it } from "vitest";
import { groupRules } from "./autonomyModel";

describe("a stage's rules, one line per tool", () => {
  it("says two patterns for the same tool once, not as two identical lines (console-desktop 51)", () => {
    const groups = groupRules(["run(rm -rf *)", "run(git push*)"]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toEqual({ tool: "run", label: "Run commands and tests, limited", rules: ["run(rm -rf *)", "run(git push*)"], limited: true });
  });

  it("keeps the tools apart, in the order they were set", () => {
    expect(groupRules(["edit_file", "run(make *)", "write_file", "run(npm test)"]).map((g) => g.label)).toEqual(["Change files", "Run commands and tests, limited", "Write new files"]);
  });

  it("is not limited when the tool is also allowed without a pattern", () => {
    const [run] = groupRules(["run(make *)", "run"]);
    expect(run?.label).toBe("Run commands and tests");
    expect(run?.limited).toBe(false);
  });

  it("drops a rule repeated word for word", () => {
    expect(groupRules(["edit_file", "edit_file"])[0]?.rules).toEqual(["edit_file"]);
  });
});
