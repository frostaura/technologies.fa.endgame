#!/usr/bin/env node
/**
 * `npm audit --audit-level=high` with a narrow, EXPIRING allowlist.
 *
 * Why this exists rather than a plain `npm audit`: an advisory can have no non-vulnerable version
 * to move to. When that happens a plain gate leaves exactly two options — ship a knowingly worse
 * dependency, or delete the gate — and the second one is how security gates die quietly. This
 * keeps the gate fully armed for everything except advisories that are explicitly listed here,
 * with a reason and a review date, and it FAILS once that date passes so the exception cannot
 * outlive its justification.
 *
 * Adding an entry is a security-policy decision, not a build fix. Parent-entity concern.
 */

import { execFileSync } from "node:child_process";

// Empty, and that is the goal state. An entry is { id, package, reason, reviewBy: "YYYY-MM-DD" },
// added only when an advisory has no fixed version to move to.
const ALLOWLIST = [];

let report;
try {
  // npm audit exits non-zero when it finds anything, so the throw is expected and carries stdout.
  report = execFileSync("npm", ["audit", "--json"], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
} catch (error) {
  report = error.stdout;
  if (!report) {
    console.error("audit-gate: `npm audit --json` produced no output.");
    console.error(error.stderr ?? error.message);
    process.exit(1);
  }
}

const { vulnerabilities = {} } = JSON.parse(report);
const blocking = [];
const waived = [];
const expired = [];
const today = new Date().toISOString().slice(0, 10);

for (const vuln of Object.values(vulnerabilities)) {
  if (vuln.severity !== "high" && vuln.severity !== "critical") continue;

  for (const via of vuln.via) {
    // A string `via` is an indirect path through another vulnerable package; the advisory itself
    // is reported on the package that actually carries it, so it is counted there instead.
    if (typeof via === "string") continue;

    const allowed = ALLOWLIST.find((entry) => via.url?.endsWith(entry.id));
    if (!allowed) {
      blocking.push(`${vuln.name}: ${via.title} (${via.url})`);
    } else if (today > allowed.reviewBy) {
      expired.push(`${allowed.id} (${allowed.package}) — review date ${allowed.reviewBy} has passed`);
    } else {
      waived.push(`${allowed.id} (${allowed.package}) — review by ${allowed.reviewBy}`);
    }
  }
}

for (const entry of waived) console.log(`waived:   ${entry}`);
for (const entry of expired) console.error(`EXPIRED:  ${entry}`);
for (const entry of blocking) console.error(`BLOCKING: ${entry}`);

if (expired.length > 0) {
  console.error("\nAn audit allowlist entry is past its review date. Re-justify it or remove it.");
  process.exit(1);
}

if (blocking.length > 0) {
  console.error(`\n${blocking.length} un-waived high/critical advisory(ies).`);
  process.exit(1);
}

console.log(`audit-gate: no un-waived high or critical advisories (${waived.length} waived).`);
