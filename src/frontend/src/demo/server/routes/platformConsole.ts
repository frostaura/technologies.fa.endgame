import { requireRole, scopeOf } from "../access";
import { area, created, invalid, isEmail, noContent, notFound, ok, omit, str } from "../http";
import { chain, levelOf, newId, within, type World } from "../world";

/** `PlatformConsoleEndpoints.cs`: secrets (names only), sharing an app, the operator log. And `GET system/status` from Program.cs. */

export function secretList(world: World, scope: string) {
  const byName = new Map<string, { name: string; setAtLevel: ReturnType<typeof levelOf>; setAtPath: string; setAt: string; inherited: boolean; overrides: string[] }>();
  for (const p of chain(scope)) {
    for (const s of world.secrets.filter((x) => x.path === p)) {
      const was = byName.get(s.name);
      byName.set(s.name, { name: s.name, setAtLevel: levelOf(p), setAtPath: p, setAt: s.setAt, inherited: p !== scope, overrides: was ? [was.setAtPath, ...was.overrides] : [] });
    }
  }
  return {
    scope,
    effective: [...byName.values()].sort((a, b) => a.name.localeCompare(b.name)),
    setBelow: world.secrets.filter((s) => s.path !== scope && within(s.path, scope)).map((s) => ({ name: s.name, setAtPath: s.path })),
  };
}

area("PlatformConsoleEndpoints", {
  "GET secrets": (req, { world }) => {
    const scope = scopeOf(world, req.query.get("scope"));
    requireRole(world, scope, "admin");
    return ok(secretList(world, scope));
  },

  "PUT secrets": (req, { world }) => {
    const scope = scopeOf(world, str(req.body, "scope"));
    requireRole(world, scope, "admin");
    const name = str(req.body, "name") ?? "";
    const value = str(req.body, "value") ?? "";
    if (!/^[A-Z][A-Z0-9_]{1,127}$/.test(name)) throw invalid(`'${name}' is not a secret name: use UPPER_SNAKE_CASE, 2-128 characters, starting with a letter (for example STRIPE_API_KEY).`);
    if (!value) throw invalid("A secret's value is a non-empty string.");
    if (value.length > 16384) throw invalid("A secret's value is at most 16384 characters.");
    // The value is dropped here: the demo, like the console, never keeps it.
    const at = new Date().toISOString();
    world.secrets = world.secrets.filter((s) => !(s.path === scope && s.name === name));
    world.secrets.push({ path: scope, name, setAt: at });
    world.changed.push("Secrets", "Ontology");
    const view = secretList(world, scope).effective.find((s) => s.name === name);
    return ok(view);
  },

  "DELETE secrets": (req, { world }) => {
    const scope = scopeOf(world, req.query.get("scope"));
    requireRole(world, scope, "admin");
    const name = req.query.get("name") ?? "";
    if (!world.secrets.some((s) => s.path === scope && s.name === name)) throw notFound(`A secret '${name}' set at '${scope}'`);
    world.secrets = world.secrets.filter((s) => !(s.path === scope && s.name === name));
    world.changed.push("Secrets");
    return noContent();
  },

  "GET apps/{id}/shares": (req, { world }) => {
    const a = world.apps.find((x) => x.id === req.params.id);
    if (!a) throw notFound("The app");
    requireRole(world, a.path, "admin");
    return ok(world.shares.filter((s) => s.appId === a.id).map((s) => ({ email: s.email, invitedAt: s.invitedAt, registered: s.registered })));
  },

  "POST apps/{id}/shares": (req, { world }) => {
    const a = world.apps.find((x) => x.id === req.params.id);
    if (!a) throw notFound("The app");
    requireRole(world, a.path, "admin");
    const email = (str(req.body, "email") ?? "").trim().toLowerCase();
    if (!isEmail(email)) throw invalid("Give a valid e-mail address.");
    // `AppIdentityService.ShareAsync`: 16 random bytes as 32 lower-case hex characters, for 14 days.
    const invitationCode = (newId(world, "share") + newId(world, "share")).replace(/-/g, "").slice(0, 32);
    const expiresAt = new Date(Date.now() + 14 * 86_400_000).toISOString();
    const existing = world.shares.find((s) => s.appId === a.id && s.email === email);
    if (existing) Object.assign(existing, { code: invitationCode, invitedAt: new Date().toISOString() });
    else world.shares.push({ appId: a.id, email, invitedAt: new Date().toISOString(), registered: false, code: invitationCode });
    world.changed.push("Shares", "App", "Tree");
    // The demo's installation has a mail server, so `InvitationMailer.SendShareAsync` queues the e-mail.
    return created({ email, invitationCode, expiresAt, emailed: true });
  },

  "DELETE apps/{id}/shares": (req, { world }) => {
    const a = world.apps.find((x) => x.id === req.params.id);
    if (!a) throw notFound("The app");
    requireRole(world, a.path, "admin");
    const email = (req.query.get("email") ?? "").toLowerCase();
    if (!world.shares.some((s) => s.appId === a.id && s.email === email)) throw notFound(`A share with '${email}'`);
    world.shares = world.shares.filter((s) => !(s.appId === a.id && s.email === email));
    world.changed.push("Shares", "App", "Tree");
    return noContent();
  },

  "GET audit/operator-access": (req, { world }) => {
    const org = scopeOf(world, req.query.get("organisation"));
    requireRole(world, org, "owner");
    if (org.includes("/")) throw invalid("The operator log belongs to an organisation; pass its slug.");
    return ok(world.operatorLog.filter((x) => x.organisation === org).slice(0, 500).map((x) => omit(x, "organisation")));
  },

  "GET system/status": (_req, { world }) => {
    const at = new Date().toISOString();
    const services = [
      ["edge", "Edge", 3],
      ["control-plane", "Control plane", 6],
      ["runner", "Runner", 9],
      ["dock", "Dock", 4],
      ["database", "PostgreSQL", 2],
      ["egress", "Egress proxy", 5],
      ["tunnel", "Tunnel", 18],
      ["backup", "Backup", 7],
    ] as const;
    // Signed out, only whether the whole is healthy and when it was checked (SYS-05).
    if (!world.sessionUserId) return ok({ overall: "healthy", checkedAt: at });
    return ok({ overall: "healthy", checkedAt: at, services: services.map(([key, name, latencyMs]) => ({ key, name, state: "healthy", latencyMs, detail: key === "backup" ? "Last backup 3 hours ago." : null })) });
  },
});
