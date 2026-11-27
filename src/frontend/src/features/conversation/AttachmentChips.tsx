import { useState } from "react";
import { FileText, LoaderCircle, TriangleAlert, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ConversationAttachment } from "@/store/types";
import { formatBytes, openAttachment, useAttachmentUrl, type DraftFile } from "./attachments";

/** The files waiting to go with a message: each with its name, size and a way to take it off; an image shows itself. */
export function DraftChips({ files, onRemove }: { files: DraftFile[]; onRemove: (key: string) => void }) {
  if (files.length === 0) return null;
  return (
    <ul aria-label="Files to send" className="no-scrollbar flex gap-2 overflow-x-auto px-3 pt-3">
      {files.map((f) => (
        <li
          key={f.key}
          data-attachment-chip={f.state}
          className={cn(
            "flex shrink-0 items-center gap-2 rounded-xs border py-1 pl-1 pr-0.5 text-sm",
            f.state === "failed" ? "border-attention-line bg-attention-tint text-attention-text" : "bg-surface text-ink",
          )}
        >
          <Thumb preview={f.preview} kind={f.kind} uploading={f.state === "uploading"} failed={f.state === "failed"} />
          <span className="flex min-w-0 flex-col leading-tight">
            <span className="max-w-chip truncate font-medium" title={f.name}>
              {f.name}
            </span>
            <span className={cn("text-xs", f.state === "failed" ? "text-attention-text" : "text-ink-muted")}>{f.state === "uploading" ? "Adding…" : f.state === "failed" ? "Not added" : formatBytes(f.bytes)}</span>
          </span>
          <button type="button" onClick={() => onRemove(f.key)} aria-label={`Take off ${f.name}`} className="flex min-h-touch min-w-touch shrink-0 items-center justify-center rounded-xs text-ink-muted hover:bg-ground hover:text-ink">
            <X aria-hidden className="size-4" />
          </button>
        </li>
      ))}
    </ul>
  );
}

function Thumb({ preview, kind, uploading, failed }: { preview: string | null; kind: DraftFile["kind"]; uploading: boolean; failed: boolean }) {
  return (
    <span className="relative flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-xxs bg-ground">
      {preview && kind === "image" ? <img src={preview} alt="" className="size-full object-cover" /> : failed ? <TriangleAlert aria-hidden className="size-4" /> : <FileText aria-hidden className="size-4 text-ink-muted" />}
      {uploading && (
        <span className="absolute inset-0 flex items-center justify-center bg-surface/70">
          <LoaderCircle aria-hidden className="size-4 animate-spin text-primary motion-reduce:animate-none" />
        </span>
      )}
    </span>
  );
}

/** The files a message carried, in the thread: images as pictures, the rest as chips; each opens. */
export function SentAttachments({ files, align = "end" }: { files: ConversationAttachment[]; align?: "start" | "end" }) {
  if (files.length === 0) return null;
  const images = files.filter((f) => f.kind === "image");
  const others = files.filter((f) => f.kind !== "image");
  return (
    <div data-sent-attachments="" className={cn("flex max-w-bubble flex-col gap-1.5", align === "end" ? "items-end self-end" : "items-start")}>
      {images.length > 0 && (
        <ul aria-label="Pictures" className={cn("flex flex-wrap gap-1.5", align === "end" && "justify-end")}>
          {images.map((f) => (
            <li key={f.id}>
              <SentImage file={f} />
            </li>
          ))}
        </ul>
      )}
      {others.length > 0 && (
        <ul aria-label="Files" className={cn("flex flex-wrap gap-1.5", align === "end" && "justify-end")}>
          {others.map((f) => (
            <li key={f.id}>
              <SentFile file={f} />
            </li>
          ))}
        </ul>
      )}
    </div>
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
      className="flex size-thumb items-center justify-center overflow-hidden rounded-xs border bg-ground text-ink-muted"
    >
      {url ? <img src={url} alt={file.name} className="size-full object-cover" /> : failed ? <TriangleAlert aria-hidden className="size-4" /> : <LoaderCircle aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />}
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
      className="flex min-h-touch max-w-full items-center gap-2 rounded-xs border bg-surface py-1 pl-2 pr-3 text-left text-sm text-ink hover:bg-ground"
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
