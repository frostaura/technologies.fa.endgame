import { useSyncExternalStore } from "react";

/**
 * "Your device": the passkey ceremonies, simulated. The console's own WebAuthn calls
 * (`navigator.credentials.create` and `.get`) are answered here, behind the demo seam, by a small
 * in-page sheet that asks the person to approve or cancel — so every sign-in, registration and
 * invitation flow can be walked without a real authenticator. Embedded in the academy, the sheet
 * approves itself after a moment, as a learner's device would.
 */

export interface DeviceRequest {
  action: "sign-in" | "register";
  site: string;
  /** Registering: the account being created. Signing in: null. */
  account: string | null;
  /** Signing in: the accounts this device holds passkeys for. */
  choices: { id: string; label: string }[];
  resolve: (choice: string | null) => void;
}

let current: DeviceRequest | null = null;
const listeners = new Set<() => void>();
let autoApproveMs: number | null = null;

function emit() {
  for (const l of listeners) l();
}

export function setAutoApprove(ms: number | null) {
  autoApproveMs = ms;
}

/** Ask "the device"; resolves with the chosen account id (or "ok"), or null when cancelled. */
export function askDevice(request: Omit<DeviceRequest, "resolve">): Promise<string | null> {
  current?.resolve(null);
  return new Promise((resolve) => {
    const req: DeviceRequest = {
      ...request,
      resolve: (choice) => {
        if (current === req) current = null;
        emit();
        resolve(choice);
      },
    };
    current = req;
    emit();
    if (autoApproveMs !== null) setTimeout(() => current === req && req.resolve(req.choices[0]?.id ?? "ok"), autoApproveMs);
  });
}

export function useDeviceRequest(): DeviceRequest | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
    () => null,
  );
}

const bytes = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer;

function decode(buffer: unknown): string {
  try {
    return new TextDecoder().decode(buffer as ArrayBuffer);
  } catch {
    return "";
  }
}

/** A credential shaped like the browser's, whose id ends with the account's id. */
function credential(id: string, kind: "create" | "get") {
  const response =
    kind === "create"
      ? { clientDataJSON: bytes("{}"), attestationObject: bytes("demo"), getTransports: () => ["internal"] }
      : { clientDataJSON: bytes("{}"), authenticatorData: bytes("demo"), signature: bytes("demo"), userHandle: bytes(id) };
  return { id: `demo-passkey-${id}`, rawId: bytes(`demo-passkey-${id}`), type: "public-key", authenticatorAttachment: "platform", getClientExtensionResults: () => ({}), response };
}

/**
 * Replace the browser's WebAuthn calls with the device sheet. `accounts` says, at the moment of a
 * sign-in, which accounts this device holds passkeys for.
 */
export function installDevice(accounts: () => { id: string; label: string }[]) {
  const fake = {
    async create(options?: CredentialCreationOptions) {
      const pk = options?.publicKey;
      const userId = decode(pk?.user?.id);
      const choice = await askDevice({ action: "register", site: "endgame.example", account: pk?.user?.name ?? null, choices: [{ id: userId, label: pk?.user?.displayName ?? pk?.user?.name ?? "" }] });
      if (!choice) throw new DOMException("The operation either timed out or was not allowed.", "NotAllowedError");
      return credential(userId, "create");
    },
    async get() {
      const choices = accounts();
      const choice = await askDevice({ action: "sign-in", site: "endgame.example", account: null, choices });
      if (!choice) throw new DOMException("The operation either timed out or was not allowed.", "NotAllowedError");
      return credential(choice, "get");
    },
  };
  Object.defineProperty(navigator, "credentials", { value: fake, configurable: true });
  if (typeof window.PublicKeyCredential !== "function") {
    Object.defineProperty(window, "PublicKeyCredential", { value: function PublicKeyCredential() {}, configurable: true });
  }
}
