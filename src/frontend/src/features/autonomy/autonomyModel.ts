import type { Mode } from "@/features/runs/runModel";
import { toolLabel } from "../workforce/workforceModel";

/** One tool in one of a stage's lists: every rule naming it, said once. */
export interface RuleGroup {
  tool: string;
  /** What the person reads: the tool in plain words, "limited" when every rule for it names a pattern. */
  label: string;
  /** The rules as the harness reads them, in the order they were set. */
  rules: string[];
  limited: boolean;
}

/**
 * A stage's list of rules, one entry per tool. Two rules for the same tool with different patterns
 * ("run(rm -rf *)" and "run(git push*)") are two rules to the harness but one line to a person:
 * in normal mode both read "Run commands and tests, limited", so listing them one by one said the
 * same words twice (console-desktop 51). A tool allowed without a pattern is not limited at all,
 * whatever patterns sit beside it.
 */
export function groupRules(rules: readonly string[]): RuleGroup[] {
  const groups = new Map<string, RuleGroup>();
  for (const rule of rules) {
    const tool = rule.replace(/\(.*\)$/, "");
    const limited = rule !== tool;
    const group = groups.get(tool);
    if (group) {
      if (!group.rules.includes(rule)) group.rules.push(rule);
      group.limited = group.limited && limited;
    } else groups.set(tool, { tool, label: "", rules: [rule], limited });
  }
  return [...groups.values()].map((g) => ({ ...g, label: toolLabel(g.limited ? `${g.tool}(…)` : g.tool, "normal") }));
}

/** The words for one rule as a mode reads it: the rule itself in technical mode, the group's label otherwise. */
export function ruleWords(group: RuleGroup, mode: Mode): string[] {
  return mode === "technical" ? group.rules : [group.label];
}
