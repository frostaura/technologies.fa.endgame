import { chooseOrganisation } from "@/lib/useActiveOrganisation";
import { cancelDeviceRequest } from "./device";
import { forgetHostedDevices } from "./hosted/device";
import { forgetReadingLists } from "./hosted/readingList";
import { forgetRegistering } from "./server/routes/auth";

/**
 * Everything the console and the demo keep beyond the world itself, put back as a first visit has
 * it: the console's own keys in this tab's storage (every one is named `endgame.…`: the mode, the
 * organisation chosen, the organisation an operator entered, the address kept across a sign-in),
 * and what the demo holds in memory for the page's life — a device sheet still open, a passkey
 * ceremony half-way, the hosted apps' device and reading lists. A reset of the demo calls it, so a
 * lesson never starts in the state an earlier one left (Technical mode, another organisation).
 */
export const CONSOLE_KEY_PREFIX = "endgame.";

export function pristine() {
  for (const storage of stores()) {
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k?.startsWith(CONSOLE_KEY_PREFIX)) keys.push(k);
    }
    for (const k of keys) storage.removeItem(k);
  }
  chooseOrganisation(null);
  cancelDeviceRequest();
  forgetRegistering();
  forgetHostedDevices();
  forgetReadingLists();
}

function stores(): Storage[] {
  const out: Storage[] = [];
  for (const read of [() => window.localStorage, () => window.sessionStorage]) {
    try {
      out.push(read());
    } catch {
      // Blocked storage keeps nothing to clear.
    }
  }
  return out;
}
