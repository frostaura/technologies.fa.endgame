import { useState } from "react";
import { FileText, LoaderCircle, TriangleAlert, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ConversationAttachment } from "@/store/types";
import { formatBytes, openAttachment, useAttachmentUrl, type DraftFile } from "./attachments";

/** How many chips show before the rest fold into "+n": about two rows in the docked pane. */
const SHOWN = 4;

/**
 * The files waiting to go with a message, wrapping onto rows (never a hidden sideways scroller): each with its name, its
 * size or its progress, and a way to take it off; an image shows itself. A refused file keeps its chip, in its error
 * state, with the reason on it. Past about two rows the rest fold into "+n", opened in place.
 */
export function DraftChips({ files, onRemove, imagesRefused = false }: { files: DraftFile[]; onRemove: (key: string) => void; imagesRefused?: boolean }) {
  const [all, setAll] = useState(false);
  if (files.length === 0) return null;
  const shown = all || files.length <= SHOWN + 1 ? files : files.slice(0, SHOWN);
  return (
    <ul aria-label="Files to send" className="flex flex-wrap gap-2 px-3 pb-1 pt-3">
      {shown.map((f) => {
        const refused = f.state === "failed" || (imagesRefused && f.kind === "image");
        // The chip already names the file: its reason drops a leading "{name}: " or "{name} is …".
        const reason = f.problem ? f.problem.replace(new RegExp(`^${f.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(:\\s*| is )`), (_, sep: string) => (sep.trim() === "is" ? "Is " : "")) : null;
        const why = f.state === "failed" ? (reason ? reason.charAt(0).toUpperCase() + reason.slice(1) : "Not added.") : refused ? "Can’t be read here" : null;
        return (
          <li
            key={f.key}
            data-attachment-chip={f.state}
            data-refused={refused || undefined}
            className={cn(
              "flex min-w-0 max-w-full items-center gap-2 rounded-xs border py-1 pl-1 pr-0.5 text-sm",
              refused ? "border-attention-line bg-attention-tint text-attention-text" : "bg-surface text-ink",
            )}
          >
            <Thumb preview={f.preview} kind={f.kind} uploading={f.state === "uploading"} failed={refused} />
            <span className="flex min-w-0 flex-col leading-tight">
              <span className="max-w-chip-draft truncate font-medium" title={f.name}>
                {f.name}
              </span>
              {why ? (
                <span role={f.state === "failed" ? "alert" : undefined} className="max-w-chip-draft truncate text-xs text-attention-text" title={f.problem ?? why}>
                  {why}
                </span>
              ) : (
                <span className="text-xs text-ink-muted">{f.state === "uploading" ? "Adding…" : formatBytes(f.bytes)}</span>
              )}
            </span>
            <button type="button" onClick={() => onRemove(f.key)} aria-label={`Take off ${f.name}`} title={`Take off ${f.name}`} className="flex size-8 shrink-0 touch:min-h-touch touch:min-w-touch items-center justify-center rounded-xs text-ink-muted hover:bg-ground hover:text-ink">
              <X aria-hidden className="size-4" />
            </button>
          </li>
        );
      })}
      {files.length > shown.length && (
        <li>
          <button type="button" onClick={() => setAll(true)} className="flex min-h-touch items-center rounded-xs border bg-ground px-3 text-sm font-semibold text-ink-body hover:bg-surface">
            +{files.length - shown.length}
          </button>
        </li>
      )}
      {all && files.length > SHOWN + 1 && (
        <li>
          <button type="button" onClick={() => setAll(false)} className="flex min-h-touch items-center rounded-xs px-2 text-sm font-semibold text-primary-link hover:text-primary-hover">
            Fewer
          </button>
        </li>
      )}
    </ul>
  );
}

function Thumb({ preview, kind, uploading, failed }: { preview: string | null; kind: DraftFile["kind"]; uploading: boolean; failed: boolean }) {
  return (
    <span className="relative flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-xxs bg-ground">
      {preview && kind === "image" ? <img src={preview} alt="" className="size-full object-cover" /> : failed ? <TriangleAlert aria-hidden className="size-4" /> : <FileText aria-hidden className="size-4 text-ink-muted" />}
      {uploading && (
        <span className="absolute inset-0 flex items-center justify-center bg-surface/70">
          <LoaderCircle aria-hidden className="size-4 animate-spin text-primary motion-reduce:animate-none" />
        </span>
      )}
    </span>
  );
}

/** The files a message carried, in the thread: one wrapping row, pictures at their own shape, the rest as chips; each opens. */
export function SentAttachments({ files, align = "end" }: { files: ConversationAttachment[]; align?: "start" | "end" }) {
  if (files.length === 0) return null;
  const images = files.filter((f) => f.kind === "image");
  const others = files.filter((f) => f.kind !== "image");
  return (
    <ul data-sent-attachments="" aria-label="Files sent" className={cn("flex max-w-bubble flex-wrap items-end gap-1.5", align === "end" ? "justify-end self-end" : "justify-start")}>
      {images.map((f) => (
        <li key={f.id}>
          <SentImage file={f} />
        </li>
      ))}
      {others.map((f) => (
        <li key={f.id}>
          <SentFile file={f} />
        </li>
      ))}
    </ul>
  );
}

function SentImage({ file }: { file: ConversationAttachment }) {
  const { url, failed } = useAttachmentUrl(file.id);
  return (
    <a
      href={url ?? undefined}
      target="_blank"
      rel="noopener"
      aria-label={`Open ${file.name}`}
      className="flex h-thumb min-w-thumb max-w-sent items-center justify-center overflow-hidden rounded-xs border bg-ground text-ink-muted"
    >
      {url ? <img src={url} alt={file.name} className="h-full w-auto max-w-sent object-contain" /> : failed ? <TriangleAlert aria-hidden className="size-4" /> : <LoaderCircle aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />}
    </a>
  );
}

function SentFile({ file }: { file: ConversationAttachment }) {
  const [problem, setProblem] = useState<string | null>(null);
  const detail = file.kind === "pdf" && file.pages ? `PDF, ${file.pages} ${file.pages === 1 ? "page" : "pages"}` : file.kind === "pdf" ? "PDF" : formatBytes(file.bytes);
  return (
    <button
      type="button"
      onClick={() => void openAttachment(file.id).then(setProblem)}
      className="flex h-thumb max-w-full items-center gap-2 rounded-xs border bg-surface pl-2 pr-3 text-left text-sm text-ink hover:bg-ground"
      title={problem ?? `Open ${file.name}`}
    >
      <FileText aria-hidden className="size-4 shrink-0 text-primary" />
      <span className="flex min-w-0 flex-col leading-tight">
        <span className="max-w-chip truncate font-medium">{file.name}</span>
        <span className={cn("text-xs", problem ? "text-attention-text" : "text-ink-muted")}>{problem ?? detail}</span>
      </span>
    </button>
  );
}
