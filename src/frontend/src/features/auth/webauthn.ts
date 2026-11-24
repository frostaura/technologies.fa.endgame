/**
 * Passkeys over the WebAuthn JSON forms. The control plane sends options with binary fields as
 * base64url strings (the W3C `PublicKeyCredential*OptionsJSON` shapes, which every server
 * library emits); the browser API wants ArrayBuffers. These convert both ways.
 */

export function fromBase64Url(value: string): ArrayBuffer {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export function toBase64Url(buffer: ArrayBuffer | ArrayBufferView): string {
  const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

type Json = Record<string, unknown>;

function withIds(list: unknown): PublicKeyCredentialDescriptor[] | undefined {
  if (!Array.isArray(list)) return undefined;
  return list.map((c: Json) => ({ ...(c as object), id: fromBase64Url(String(c.id)) }) as PublicKeyCredentialDescriptor);
}

export function toCreationOptions(json: Json): PublicKeyCredentialCreationOptions {
  const user = json.user as Json;
  return {
    ...(json as object),
    challenge: fromBase64Url(String(json.challenge)),
    user: { ...(user as object), id: fromBase64Url(String(user.id)) },
    excludeCredentials: withIds(json.excludeCredentials),
  } as PublicKeyCredentialCreationOptions;
}

export function toRequestOptions(json: Json): PublicKeyCredentialRequestOptions {
  return {
    ...(json as object),
    challenge: fromBase64Url(String(json.challenge)),
    allowCredentials: withIds(json.allowCredentials),
  } as PublicKeyCredentialRequestOptions;
}

export function registrationJson(credential: PublicKeyCredential): Json {
  const response = credential.response as AuthenticatorAttestationResponse;
  return {
    id: credential.id,
    rawId: toBase64Url(credential.rawId),
    type: credential.type,
    authenticatorAttachment: credential.authenticatorAttachment ?? null,
    clientExtensionResults: credential.getClientExtensionResults(),
    response: {
      clientDataJSON: toBase64Url(response.clientDataJSON),
      attestationObject: toBase64Url(response.attestationObject),
      transports: typeof response.getTransports === "function" ? response.getTransports() : [],
    },
  };
}

export function assertionJson(credential: PublicKeyCredential): Json {
  const response = credential.response as AuthenticatorAssertionResponse;
  return {
    id: credential.id,
    rawId: toBase64Url(credential.rawId),
    type: credential.type,
    authenticatorAttachment: credential.authenticatorAttachment ?? null,
    clientExtensionResults: credential.getClientExtensionResults(),
    response: {
      clientDataJSON: toBase64Url(response.clientDataJSON),
      authenticatorData: toBase64Url(response.authenticatorData),
      signature: toBase64Url(response.signature),
      userHandle: response.userHandle ? toBase64Url(response.userHandle) : null,
    },
  };
}

export function passkeysSupported(): boolean {
  return typeof window !== "undefined" && typeof window.PublicKeyCredential === "function" && !!navigator.credentials;
}

/** The browser's refusal, in words. A cancelled prompt is not an error worth alarming anyone over. */
export function describePasskeyError(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError") return "The passkey prompt was closed or timed out. Nothing was changed.";
    if (error.name === "InvalidStateError") return "This device already holds a passkey for Endgame. Sign in with it instead.";
    if (error.name === "SecurityError") return "Passkeys need a secure address (https or localhost).";
  }
  return error instanceof Error ? error.message : "The passkey could not be used.";
}
