import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { navigate, routeByHash } from "@/lib/router";
import "@/index.css";
import { installBridge } from "./bridge";
import { DemoRoot } from "./DemoRoot";
import { setAutoApprove } from "./device";
import { getWorld, startHost, startRoute } from "./host";

/**
 * The demo's entry (ARCH-009): the real console, built with VITE_DEMO=1, with an in-browser fake
 * of the control plane behind its transport seam, hash addresses, the simulated device, the
 * academy bridge, and the platform's own pages for hosted apps.
 */

const params = new URLSearchParams(window.location.search);
const embedded = params.get("embed") === "1";

routeByHash();
startHost(params);
if (embedded || params.get("device") === "auto") setAutoApprove(700);
installBridge(embedded);
if (!window.location.hash || window.location.hash === "#") navigate(startRoute(), { replace: true });

/** Hosted-app addresses open inside the demo; any other address outside it is not followed. */
document.addEventListener(
  "click",
  (e) => {
    const a = (e.target as Element | null)?.closest?.("a[href]");
    if (!a || e.defaultPrevented) return;
    const href = a.getAttribute("href") ?? "";
    if (!/^https?:\/\//.test(href)) return;
    e.preventDefault();
    const app = getWorld().apps.find((x) => {
      const [org, ...rest] = x.path.split("/");
      return href.startsWith(`https://endgame.example/${x.path}/`) || href.startsWith(`https://${org}.endgame.example/${rest.join("/")}/`);
    });
    if (app) {
      const [org, ...rest] = app.path.split("/");
      const form = href.startsWith(`https://${org}.`) ? "subdomain" : "path";
      const base = form === "subdomain" ? `https://${org}.endgame.example/${rest.join("/")}/` : `https://endgame.example/${app.path}/`;
      navigate(`/__app/${app.id}/${form}/${href.slice(base.length)}`);
    } else {
      window.dispatchEvent(new CustomEvent("endgame-demo-outbound", { detail: href }));
    }
  },
  true,
);

/**
 * A console address ("/apps/…") on a link the console did not route itself — a control left over
 * from the screen being replaced, say — is followed inside the demo, never as a page load that a
 * static host cannot answer.
 */
window.addEventListener("click", (e) => {
  const a = (e.target as Element | null)?.closest?.("a[href]");
  const href = a?.getAttribute("href") ?? "";
  if (!a || e.defaultPrevented || !href.startsWith("/") || href.startsWith("//") || a.getAttribute("target") === "_blank") return;
  e.preventDefault();
  navigate(href);
});

const root = document.getElementById("root");
if (!root) throw new Error("#root is missing from index.html");
createRoot(root).render(
  <StrictMode>
    <DemoRoot embedded={embedded} />
  </StrictMode>,
);
