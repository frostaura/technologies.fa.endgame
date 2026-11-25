/**
 * What "this device" remembers across the demo page's life, per hosted app: the end user whose
 * passkey it holds (made at sign-up, kept after sign-out) and the addresses registered with the
 * app, so a returning visitor can sign back in.
 */
import type { HostedVisitor } from "./types";

interface DeviceState {
  passkeyFor: HostedVisitor | null;
  registered: Set<string>;
}

const devices = new Map<string, DeviceState>();

export function deviceFor(appId: string): DeviceState {
  let state = devices.get(appId);
  if (!state) {
    state = { passkeyFor: null, registered: new Set() };
    devices.set(appId, state);
  }
  return state;
}
