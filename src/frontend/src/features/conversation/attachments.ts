import { useEffect, useState } from "react";
import { describeError } from "@/lib/queryState";
import { API_BASE, apiFetch } from "@/store/api";
import { attachmentGuard } from "@/store/guards";
import { check } from "@/lib/guards";
import type { AttachmentLimits, ConversationAttachment } from "@/store/types";
import type { FetchBaseQueryError } from "@reduxjs/toolkit/query";

/**
 * Files on a message (ARCH-012): checked here against the limits the control plane states, so a
 * file that cannot go is said at once, then uploaded as soon as it is added; the control plane
 * checks every one again by its bytes. Content is read back through the same transport as every
 * other request, so the demo build serves it too.
 */

export interface DraftFile {
  key: string;
  name: string;
  bytes: number;
  kind: ConversationAttachment["kind"] | null;
  state: "uploading" | "ready" | "failed";
  attachment: ConversationAttachment | null;
  problem: string | null;
  /** A local preview of an image, while it uploads and after. */
  preview: string | null;
}

const IMAGE = /\.(png|jpe?g|webp|gif)$/i;

export function kindOf(name: string): ConversationAttachment["kind"] | null {
  if (IMAGE.test(name)) return "image";
  if (/\.pdf$/i.test(name)) return "pdf";
  return null;
}

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot).toLowerCase() : "";
}

/** "2.4 MB", "830 KB", "12 bytes". */
export function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(n >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} ${n === 1 ? "byte" : "bytes"}`;
}

/** The limits as one sentence, for the composer: what may be attached, before anyone tries. */
export function limitsSentence(limits: AttachmentLimits): string {
  return `Up to ${limits.maxFiles} files, ${formatBytes(limits.maxFileBytes)} each and ${formatBytes(limits.maxMessageBytes)} in all: images, PDFs and text files.${limits.images ? "" : " Whoever answers here reads text only, so images cannot be sent."}`;
}

/** Why a file cannot be added, said before it is uploaded; null when it may be. */
export function refusalFor(file: { name: string; size: number }, limits: AttachmentLimits, held: DraftFile[]): string | null {
  const ext = extensionOf(file.name);
  if (ext === ".svg" || ext === ".svgz") return `${file.name}: SVG images are not accepted, because they can carry scripts. Send it as PNG instead.`;
  if (limits.extensions.length > 0 && !limits.extensions.includes(ext)) return `${file.name}: this kind of file is not accepted. Images (PNG, JPEG, WebP, GIF), PDFs and text files are.`;
  if (file.size === 0) return `${file.name} is empty.`;
  if (file.size > limits.maxFileBytes) return `${file.name} is ${formatBytes(file.size)}; a file may be at most ${formatBytes(limits.maxFileBytes)}.`;
  const live = held.filter((d) => d.state !== "failed");
  if (live.length >= limits.maxFiles) return `A message carries at most ${limits.maxFiles} files.`;
  const total = live.reduce((sum, d) => sum + d.bytes, 0) + file.size;
  if (total > limits.maxMessageBytes) return `These files come to ${formatBytes(total)}; a message carries at most ${formatBytes(limits.maxMessageBytes)}.`;
  return null;
}

export type Outcome<T> = { ok: true; data: T } | { ok: false; reason: string };

async function reasonOf(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  let data: unknown = text;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // Plain text: read as it is.
  }
  return describeError({ status: response.status, data } as FetchBaseQueryError);
}

export async function uploadAttachment(scope: string, employeeId: string | undefined, file: File): Promise<Outcome<ConversationAttachment>> {
  const form = new FormData();
  form.set("scope", scope);
  if (employeeId) form.set("employeeId", employeeId);
  form.set("file", file, file.name);
  let response: Response;
  try {
    response = await apiFetch(`${API_BASE}/conversations/attachments`, { method: "POST", credentials: "same-origin", body: form, headers: { accept: "application/json" } });
  } catch {
    return { ok: false, reason: describeError({ status: "FETCH_ERROR", error: "" }) };
  }
  if (!response.ok) return { ok: false, reason: await reasonOf(response) };
  const checked = check(attachmentGuard, await response.json().catch(() => null));
  return checked.ok ? { ok: true, data: checked.value } : { ok: false, reason: `Endgame answered in a shape this screen does not understand: ${checked.problem}.` };
}

/** Takes back a file that was not sent. Best effort: an unsent file is cleared after a day anyway. */
export async function removeAttachment(id: string): Promise<void> {
  try {
    await apiFetch(`${API_BASE}/conversations/attachments/${encodeURIComponent(id)}`, { method: "DELETE", credentials: "same-origin" });
  } catch {
    // Unsent files are cleared after a day.
  }
}

// ---------------------------------------------------------------------------------------------
// Reading a file back
// ---------------------------------------------------------------------------------------------

const urls = new Map<string, Promise<string>>();

/** An object URL for an attachment's content, read once per page and kept. */
export function attachmentUrl(id: string): Promise<string> {
  let held = urls.get(id);
  if (!held) {
    held = apiFetch(`${API_BASE}/conversations/attachments/${encodeURIComponent(id)}/content`, { credentials: "same-origin" }).then(async (r) => {
      if (!r.ok) throw new Error(await reasonOf(r));
      return URL.createObjectURL(await r.blob());
    });
    held.catch(() => urls.delete(id));
    urls.set(id, held);
  }
  return held;
}

/** The URL of an attachment's content once read, or null while it loads or when it could not be. */
export function useAttachmentUrl(id: string | null, enabled = true): { url: string | null; failed: boolean } {
  const [state, setState] = useState<{ id: string | null; url: string | null; failed: boolean }>({ id: null, url: null, failed: false });
  useEffect(() => {
    if (!id || !enabled) return;
    let live = true;
    attachmentUrl(id).then(
      (url) => live && setState({ id, url, failed: false }),
      () => live && setState({ id, url: null, failed: true }),
    );
    return () => {
      live = false;
    };
  }, [id, enabled]);
  return state.id === id ? { url: state.url, failed: state.failed } : { url: null, failed: false };
}

/** Opens an attachment in a new tab, reading it first if it has not been. */
export async function openAttachment(id: string): Promise<string | null> {
  try {
    const url = await attachmentUrl(id);
    window.open(url, "_blank", "noopener");
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : "It could not be opened.";
  }
}
