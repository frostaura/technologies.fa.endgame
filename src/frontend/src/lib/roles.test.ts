import { describe, expect, it } from "vitest";
import type { Membership, Tree } from "@/store/types";
import { effectiveRole, roleAt, roleInTree } from "./roles";

const grant = (scope: string, role: Membership["role"]): Membership => ({
  id: scope,
  scope,
  level: (["organisation", "division", "project", "app"] as const)[scope.split("/").length - 1] ?? "app",
  role,
  organisationId: "o1",
  organisationSlug: "acme",
  organisationName: "Acme",
});

describe("roleAt, as the server resolves a role", () => {
  it("lets the deepest grant on the chain win, even when it is lower", () => {
    const me = { memberships: [grant("acme", "admin"), grant("acme/tools", "viewer")] };
    expect(roleAt(me, "acme/tools")).toBe("viewer");
    expect(roleAt(me, "acme/tools/ledger")).toBe("viewer");
    expect(roleAt(me, "acme/ops")).toBe("admin");
    expect(roleAt(me, "acme")).toBe("admin");
  });

  it("keeps the Owner the Owner everywhere, and gives nothing outside the grants", () => {
    expect(roleAt({ memberships: [grant("acme", "owner"), grant("acme/tools", "viewer")] }, "acme/tools")).toBe("owner");
    expect(roleAt({ memberships: [grant("acme/tools", "builder")] }, "acme")).toBeNull();
    expect(roleAt({ memberships: [grant("acme/tools", "builder")] }, "acme/toolshed")).toBeNull();
  });
});

describe("the tree's own answer", () => {
  const tree = {
    generatedAt: "t",
    viewerRole: "builder",
    organisation: { id: "o1", slug: "acme", name: "Acme", summary: null, spend: { monthCredits: 0 }, workers: [], role: null },
    divisions: [{ id: "d1", slug: "tools", name: "Tools", spend: { monthCredits: 0 }, workers: [], role: "builder", projects: [] }],
    needsYou: [],
  } as Tree;

  it("reads each node's role, null where none is held, and does not guess for a node it does not have", () => {
    expect(roleInTree(tree, "acme")).toBeNull();
    expect(roleInTree(tree, "acme/tools")).toBe("builder");
    expect(roleInTree(tree, "acme/other")).toBeUndefined();
    expect(effectiveRole(tree, { memberships: [grant("acme", "owner")] }, "acme")).toBeNull();
  });

  it("falls back to one role for the tree from an older control plane, and to the grants with no tree", () => {
    const older = { ...tree, organisation: { ...tree.organisation, role: undefined }, divisions: [] } as Tree;
    expect(effectiveRole(older, undefined, "acme/tools")).toBe("builder");
    expect(effectiveRole(undefined, { memberships: [grant("acme", "admin"), grant("acme/tools", "viewer")] }, "acme/tools")).toBe("viewer");
  });
});
