import { me } from "../access";
import { area, conflict, forbidden, invalid, isEmail, noContent, ok, problem, Refusal, str } from "../http";
import { meView } from "../views";
import { newId, uuidFor, type World } from "../world";

/**
 * `AuthEndpoints.cs` (and `GET me`). Passkeys are simulated: the console's WebAuthn calls are
 * answered by the demo's "your device" sheet, which returns a credential whose id names the
 * account; the options and completions here check exactly what the real ones check.
 */

/** A registration under way: who it is for (the real one keeps this in a 5-minute cookie). */
let registering: { kind: "first" | "invitation" | "add"; userId: string; email: string; displayName: string } | null = null;

const b64 = (s: string) => btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function challenge(world: World) {
  return b64(newId(world, "challenge"));
}

function credentialId(body: Record<string, unknown>): string {
  const c = body.credential;
  if (!c || (typeof c !== "object" && typeof c !== "string")) throw invalid("Send the credential the authenticator returned, as 'credential'.");
  return typeof c === "string" ? c : String((c as { id?: unknown }).id ?? "");
}

area("AuthEndpoints", {
  "GET auth/options": () => ok({ passkey: true, developmentSignIn: false }),

  "POST auth/passkey/register/options": (req, { world }) => {
    const email = (str(req.body, "email") ?? "").trim().toLowerCase();
    const displayName = (str(req.body, "displayName") ?? "").trim();
    const code = (str(req.body, "invitationCode") ?? "").trim();
    const signedIn = world.users.find((u) => u.id === world.sessionUserId);
    const fresh = world.organisations.length === 0 && world.users.length === 0;
    if (signedIn) {
      registering = { kind: "add", userId: signedIn.id, email: signedIn.email, displayName: signedIn.displayName };
    } else if (fresh) {
      if (!isEmail(email)) throw invalid("Give a valid e-mail address.");
      if (displayName.length > 200) throw invalid("A display name is at most 200 characters.");
      registering = { kind: "first", userId: uuidFor(`user:${email}`), email, displayName: displayName || (email.split("@")[0] ?? email) };
    } else if (code) {
      if (!isEmail(email)) throw invalid("Give a valid e-mail address.");
      const u = world.users.find((x) => x.email === email);
      if (!u?.invitation || u.invitation.code !== code || new Date(u.invitation.expiresAt).getTime() < Date.now())
        throw forbidden("That invitation code is not valid for this e-mail address, or it has expired.");
      registering = { kind: "invitation", userId: u.id, email, displayName: displayName || u.displayName };
    } else {
      throw forbidden("Endgame is invite-only. Sign in, or register with the invitation code you were sent.");
    }
    return ok({
      publicKey: {
        rp: { name: "Endgame", id: "endgame.example" },
        user: { id: b64(registering.userId), name: registering.email, displayName: registering.displayName },
        challenge: challenge(world),
        pubKeyCredParams: [{ type: "public-key", alg: -7 }],
        timeout: 60000,
        attestation: "none",
        authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
        excludeCredentials: [],
      },
    });
  },

  "POST auth/passkey/register/complete": (req, { world }) => {
    if (!registering) throw invalid("No passkey registration is under way; ask for registration options first.");
    const id = credentialId(req.body);
    const r = registering;
    if (!id.endsWith(r.userId)) throw forbidden("The passkey was not created for this registration.");
    if (r.kind === "first") {
      if (world.users.length > 0) throw conflict("Someone has already registered first; ask them for an invitation.");
      world.users.push({ id: r.userId, displayName: r.displayName, email: r.email, passkeys: 1, isOperator: false, invitation: null });
    } else {
      const u = world.users.find((x) => x.id === r.userId);
      if (!u) throw new Refusal(problem(404, "not_found", "Not found", "The account was not found, or you cannot see it."));
      u.passkeys += 1;
      if (r.kind === "invitation") u.invitation = null;
    }
    if (!world.device.includes(r.userId)) world.device.push(r.userId);
    registering = null;
    world.sessionUserId = r.userId;
    world.changed.push("Me", "Tree", "Credits", "Members");
    return ok(meView(world, me(world)));
  },

  "POST auth/passkey/login/options": (_req, { world }) => ok({ publicKey: { challenge: challenge(world), rpId: "endgame.example", timeout: 60000, userVerification: "preferred", allowCredentials: [] } }),

  "POST auth/passkey/login/complete": (req, { world }) => {
    const id = credentialId(req.body);
    const u = world.users.find((x) => id.endsWith(x.id) && x.passkeys > 0);
    if (!u) throw new Refusal(problem(401, "passkey_rejected", "Sign-in failed", "That passkey could not be verified."));
    world.sessionUserId = u.id;
    world.entered = [];
    world.changed.push("Me", "Tree", "Credits");
    return ok(meView(world, u));
  },

  // The development sign-in does not exist in the demo, exactly as on a deployment without it.
  "POST auth/development": () => problem(404, "not_found", "Not found", "There is nothing at this address."),

  "POST auth/logout": (_req, { world }) => {
    world.sessionUserId = null;
    world.entered = [];
    return noContent();
  },

  "GET me": (_req, { world }) => ok(meView(world, me(world))),
});
