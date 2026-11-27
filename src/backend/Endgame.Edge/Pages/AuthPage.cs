using System.Net;
using System.Security.Cryptography;

namespace Endgame.Edge.Pages;

/// <summary>
/// The organisation's identity pages for one app: sign-in and sign-up, in plain language, driving
/// the control plane's <c>/api/app-auth/{appId}/*</c> and, for members, the console's own passkey
/// sign-in (ARCH-004). The page reads what the app offers (<c>GET /api/app-auth/{appId}</c>) and
/// shows only that: members always; the app's own visitors when it is shared or public; the
/// development sign-in only when the control plane advertises it. Every script and style carries
/// a per-response nonce under a strict content security policy.
/// </summary>
public static class AuthPage
{
    /// <param name="context">The request.</param>
    /// <param name="page"><c>sign-in</c> or <c>sign-up</c>.</param>
    /// <param name="configJson">The page's config, read by its script.</param>
    /// <param name="assets">Where the page's typefaces and mark are served (<see cref="PageChrome.AssetsAt"/>).</param>
    public static async Task WriteAsync(HttpContext context, string page, string configJson, string assets)
    {
        var nonce = Convert.ToBase64String(RandomNumberGenerator.GetBytes(16));
        Prepare(context, StatusCodes.Status200OK, nonce);
        if (HttpMethods.IsHead(context.Request.Method))
        {
            return;
        }

        var title = page == "sign-up" ? "Create your sign-in" : "Sign in";
        var scripts = $"\n<script type=\"application/json\" id=\"config\">{configJson}</script><script nonce=\"{nonce}\">{Script}</script>";
        await context.Response.WriteAsync(PageChrome.Document(title, assets, Body(page), styleAttributes: $" nonce=\"{nonce}\"", scripts: scripts), context.RequestAborted);
    }

    /// <summary>A page with a title, a message and one way onward (an expired hand-off, a failure).</summary>
    public static async Task WriteMessageAsync(HttpContext context, int status, string title, string message, string link, string linkText, string assets)
    {
        var nonce = Convert.ToBase64String(RandomNumberGenerator.GetBytes(16));
        Prepare(context, status, nonce);
        if (HttpMethods.IsHead(context.Request.Method))
        {
            return;
        }

        await context.Response.WriteAsync(PageChrome.Document(title, assets, MessageBody(title, message, link, linkText), styleAttributes: $" nonce=\"{nonce}\""), context.RequestAborted);
    }

    /// <summary>The body of <see cref="WriteMessageAsync"/>.</summary>
    public static string MessageBody(string title, string message, string link, string linkText) =>
        $"<h1>{WebUtility.HtmlEncode(title)}</h1>\n<p>{WebUtility.HtmlEncode(message)}</p>\n<nav class=\"actions\" aria-label=\"What to do next\"><a class=\"button\" href=\"{WebUtility.HtmlEncode(link)}\">{WebUtility.HtmlEncode(linkText)}</a></nav>";

    // The typefaces and the mark are the edge's own, served from this host (PageChrome.AssetsPath).
    private static void Prepare(HttpContext context, int status, string nonce)
    {
        var response = context.Response;
        response.Clear();
        response.StatusCode = status;
        response.ContentType = "text/html; charset=utf-8";
        response.Headers.CacheControl = "no-store";
        response.Headers["Referrer-Policy"] = "no-referrer";
        response.Headers["X-Content-Type-Options"] = "nosniff";
        response.Headers.ContentSecurityPolicy =
            $"default-src 'none'; script-src 'nonce-{nonce}'; style-src 'nonce-{nonce}'; img-src 'self'; font-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";
    }

    private static string Body(string page) => page == "sign-up"
        ? """
            <h1 id="title">Create your sign-in</h1>
            <p id="lead">Checking what this app offers…</p>
            <p id="via" class="note" hidden></p>
            <form id="sign-up" hidden>
              <section>
                <label>E-mail address<input id="email" name="email" type="email" autocomplete="email" required></label>
                <label>Your name<input id="display-name" name="displayName" type="text" autocomplete="name"></label>
                <label id="code-label" hidden>Invitation code<input id="code" name="invitationCode" type="text" autocomplete="one-time-code" spellcheck="false"></label>
                <div class="actions"><button id="create" type="submit">Create a passkey</button></div>
                <p class="note">Already registered? <a id="to-sign-in" href="#">Sign in</a></p>
              </section>
            </form>
            <section id="dev-up" hidden>
              <h2>Development sign-in</h2>
              <p>This deployment allows signing in without a passkey, for testing only.</p>
              <div class="actions"><button id="dev-visitor-up" type="button" class="secondary">Continue without a passkey</button></div>
            </section>
            <p id="error" class="error" role="alert" hidden></p>
            <p id="back" class="note" hidden><a id="back-link" href="#">Back to the app</a></p>
            """
        : """
            <h1 id="title">Sign in</h1>
            <p id="lead">Checking what this app offers…</p>
            <p id="via" class="note" hidden></p>
            <section id="members" hidden>
              <h2 id="members-title">Members</h2>
              <p>Sign in with the passkey you use for Endgame.</p>
              <div class="actions"><button id="member-passkey" type="button">Sign in with a passkey</button></div>
            </section>
            <section id="visitors" hidden>
              <h2>Using this app</h2>
              <p>Sign in with the passkey you created for this app.</p>
              <div class="actions"><button id="visitor-passkey" type="button" class="secondary">Sign in with your passkey</button></div>
              <p class="note">New here? <a id="to-sign-up" href="#">Create your sign-in</a></p>
            </section>
            <section id="dev" hidden>
              <h2>Development sign-in</h2>
              <p>This deployment allows signing in without a passkey, for testing only.</p>
              <label>E-mail address<input id="dev-email" type="email" autocomplete="email"></label>
              <div class="actions">
                <button id="dev-member" type="button" class="secondary">As a member</button>
                <button id="dev-visitor" type="button" class="secondary" hidden>As a visitor</button>
              </div>
            </section>
            <p id="error" class="error" role="alert" hidden></p>
            <p id="back" class="note" hidden><a id="back-link" href="#">Back to the app</a></p>
            """;

    // Plain browser JavaScript: the page has no build step and loads nothing else.
    private const string Script = """
        (() => {
          const config = JSON.parse(document.getElementById("config").textContent);
          const $ = (id) => document.getElementById(id);
          const base = `/api/app-auth/${config.appId}`;
          const show = (id, visible = true) => { const el = $(id); if (el) el.hidden = !visible; };
          const fail = (message) => { const el = $("error"); el.textContent = message; el.hidden = false; };
          const busy = (button, on) => { if (button) button.disabled = on; };

          async function call(path, body) {
            const response = await fetch(path, {
              method: body === undefined ? "GET" : "POST",
              credentials: "same-origin",
              headers: body === undefined ? {} : { "Content-Type": "application/json" },
              body: body === undefined ? undefined : JSON.stringify(body),
            });
            let data = null;
            try { data = await response.json(); } catch { data = null; }
            if (!response.ok) {
              const error = new Error((data && (data.detail || data.title)) || `The request was refused (${response.status}).`);
              error.status = response.status;
              throw error;
            }
            return data;
          }

          const fromB64 = (value) => {
            const text = atob(value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "="));
            return Uint8Array.from(text, (c) => c.charCodeAt(0)).buffer;
          };
          const toB64 = (buffer) => {
            let text = "";
            for (const b of new Uint8Array(buffer)) text += String.fromCharCode(b);
            return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
          };
          const ids = (list) => (list || []).map((c) => ({ ...c, id: fromB64(c.id) }));
          async function create(publicKey) {
            const credential = await navigator.credentials.create({ publicKey: {
              ...publicKey, challenge: fromB64(publicKey.challenge), user: { ...publicKey.user, id: fromB64(publicKey.user.id) }, excludeCredentials: ids(publicKey.excludeCredentials) } });
            const r = credential.response;
            return { id: credential.id, rawId: toB64(credential.rawId), type: credential.type, authenticatorAttachment: credential.authenticatorAttachment || null,
              clientExtensionResults: credential.getClientExtensionResults(),
              response: { clientDataJSON: toB64(r.clientDataJSON), attestationObject: toB64(r.attestationObject), transports: r.getTransports ? r.getTransports() : [] } };
          }
          async function get(publicKey) {
            const credential = await navigator.credentials.get({ publicKey: { ...publicKey, challenge: fromB64(publicKey.challenge), allowCredentials: ids(publicKey.allowCredentials) } });
            const r = credential.response;
            return { id: credential.id, rawId: toB64(credential.rawId), type: credential.type, authenticatorAttachment: credential.authenticatorAttachment || null,
              clientExtensionResults: credential.getClientExtensionResults(),
              response: { clientDataJSON: toB64(r.clientDataJSON), authenticatorData: toB64(r.authenticatorData), signature: toB64(r.signature),
                userHandle: r.userHandle ? toB64(r.userHandle) : null } };
          }
          const passkeyError = (error) => error instanceof DOMException && error.name === "NotAllowedError"
            ? "The passkey prompt was closed or timed out. Nothing was changed."
            : (error && error.message) || "That did not work. Please try again.";

          // After a member signs in on this host: to the app, or — for its organisation subdomain — through a hand-off.
          async function finish() {
            if (config.handoff) {
              const { url } = await call(`${base}/handoff`, { returnTo: config.returnTo });
              location.assign(url);
            } else {
              location.assign(config.returnTo);
            }
          }

          async function run(button, action) {
            show("error", false);
            busy(button, true);
            try { await action(); } catch (error) { fail(passkeyError(error)); busy(button, false); }
          }

          async function start() {
            const info = await call(base);
            const visitors = info.signUp === true;
            $("title").textContent = config.page === "sign-up" ? `Create your sign-in for ${info.appName}` : `Sign in to ${info.appName}`;
            // On the organisation subdomain the visitor was sent here, to the platform's host: say where they are, and why.
            if (config.handoff) {
              $("via").textContent = `Endgame keeps your sign-in at its own address, so you sign in here and go straight back to ${new URL(config.returnTo).host}.`;
              show("via");
            }
            // A public app opens signed out too: signing in can wait.
            if (visitors && info.invitationRequired !== true) {
              $("back-link").textContent = `Back to ${info.appName}`;
              $("back-link").href = config.returnTo;
              show("back");
            }
            if (config.page === "sign-up") {
              if (!visitors) {
                $("lead").textContent = `${info.appName} is private: only members of ${info.organisationName} can open it.`;
                return;
              }
              $("lead").textContent = info.invitationRequired
                ? `${info.appName} is shared with chosen people. Use the address it was shared with and the invitation code you were given.`
                : `Anyone may use ${info.appName}. A passkey on this device signs you in — there is no password.`;
              show("code-label", info.invitationRequired === true);
              show("sign-up");
              show("dev-up", info.developmentSignIn === true && !info.invitationRequired);
              $("to-sign-in").href = config.signInUrl;
              return;
            }

            // Already signed in on this host (a member, or this app's own visitor): carry the session on.
            if (config.handoff && config.signedIn) {
              try { const { url } = await call(`${base}/handoff`, { returnTo: config.returnTo }); location.replace(url); return; }
              catch (error) { if (error.status !== 401) throw error; }
            }

            $("lead").textContent = `${info.appName} belongs to ${info.organisationName}.`;
            $("members-title").textContent = `Members of ${info.organisationName}`;
            show("members");
            show("visitors", visitors);
            $("to-sign-up").href = config.signUpUrl;
            show("dev", info.developmentSignIn === true);
            show("dev-visitor", info.developmentSignIn === true && visitors);
          }

          $("member-passkey")?.addEventListener("click", (event) => run(event.currentTarget, async () => {
            const { publicKey } = await call("/api/auth/passkey/login/options", {});
            await call("/api/auth/passkey/login/complete", { credential: await get(publicKey) });
            await finish();
          }));
          $("visitor-passkey")?.addEventListener("click", (event) => run(event.currentTarget, async () => {
            const { publicKey } = await call(`${base}/sign-in/options`, { returnTo: config.returnTo });
            const signedIn = await call(`${base}/sign-in/complete`, { credential: await get(publicKey) });
            location.assign(signedIn.returnTo);
          }));
          $("dev-member")?.addEventListener("click", (event) => run(event.currentTarget, async () => {
            const email = $("dev-email").value.trim();
            await call("/api/auth/development", email ? { email } : {});
            await finish();
          }));
          $("dev-visitor")?.addEventListener("click", (event) => run(event.currentTarget, async () => {
            const signedIn = await call(`${base}/development`, { email: $("dev-email").value.trim(), returnTo: config.returnTo });
            location.assign(signedIn.returnTo);
          }));
          $("dev-visitor-up")?.addEventListener("click", (event) => run(event.currentTarget, async () => {
            const signedIn = await call(`${base}/development`, { email: $("email").value.trim(), displayName: $("display-name").value.trim(), returnTo: config.returnTo });
            location.assign(signedIn.returnTo);
          }));
          $("sign-up")?.addEventListener("submit", (event) => {
            event.preventDefault();
            run($("create"), async () => {
              const code = $("code").value.trim() || undefined;
              const { publicKey } = await call(`${base}/sign-up/options`, {
                email: $("email").value.trim(), displayName: $("display-name").value.trim() || undefined, invitationCode: code, returnTo: config.returnTo });
              const signedIn = await call(`${base}/sign-up/complete`, { credential: await create(publicKey), invitationCode: code });
              location.assign(signedIn.returnTo);
            });
          });

          start().catch((error) => { $("lead").textContent = "Sign-in is unavailable just now."; fail(error.message); });
        })();
        """;
}
