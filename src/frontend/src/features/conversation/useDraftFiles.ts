import { useCallback, useEffect, useRef, useState } from "react";
import type { AttachmentLimits, ConversationAttachment } from "@/store/types";
import { kindOf, refusalFor, removeAttachment, uploadAttachment, type DraftFile } from "./attachments";

/**
 * The files waiting to go with the next message at one level: checked against the stated limits,
 * uploaded as soon as they are added, taken back when removed. A refusal is said once, beside the
 * composer, until the next file is added.
 */
export function useDraftFiles(scope: string, employeeId: string | undefined, limits: AttachmentLimits | null) {
  const [files, setFiles] = useState<DraftFile[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const held = useRef<DraftFile[]>([]);
  useEffect(() => {
    held.current = files;
  }, [files]);
  const sequence = useRef(0);

  // Moving to another level starts a new message there: files added here are not carried over.
  const at = `${scope}#${employeeId ?? ""}`;
  const [was, setWas] = useState(at);
  if (was !== at) {
    setWas(at);
    for (const f of files) if (f.attachment) void removeAttachment(f.attachment.id);
    setFiles([]);
    setProblem(null);
  }

  // Local previews are let go of with the page.
  useEffect(
    () => () => {
      for (const f of held.current) if (f.preview) URL.revokeObjectURL(f.preview);
    },
    [],
  );

  const add = useCallback(
    (incoming: File[]) => {
      if (!limits || incoming.length === 0) return;
      const refusals: string[] = [];
      const accepted: { draft: DraftFile; file: File }[] = [];
      let current = held.current;
      for (const file of incoming) {
        const refusal = refusalFor({ name: file.name, size: file.size }, limits, current);
        if (refusal) {
          refusals.push(refusal);
          continue;
        }
        sequence.current += 1;
        const kind = kindOf(file.name);
        const draft: DraftFile = {
          key: `f${sequence.current}`,
          name: file.name,
          bytes: file.size,
          kind,
          state: "uploading",
          attachment: null,
          problem: null,
          preview: kind === "image" && typeof URL.createObjectURL === "function" ? URL.createObjectURL(file) : null,
        };
        accepted.push({ draft, file });
        current = [...current, draft];
      }
      setProblem(refusals.length > 0 ? refusals.join(" ") : null);
      if (accepted.length === 0) return;
      setFiles((was) => [...was, ...accepted.map((a) => a.draft)]);
      for (const { draft, file } of accepted) {
        void uploadAttachment(scope, employeeId, file).then((outcome) => {
          setFiles((was) => {
            if (!was.some((f) => f.key === draft.key)) {
              // Taken off while it uploaded: take it back from the control plane too.
              if (outcome.ok) void removeAttachment(outcome.data.id);
              return was;
            }
            return was.map((f) =>
              f.key !== draft.key ? f : outcome.ok ? { ...f, state: "ready", attachment: outcome.data, kind: outcome.data.kind } : { ...f, state: "failed", problem: outcome.reason },
            );
          });
          if (!outcome.ok) setProblem(`${file.name} was not added: ${outcome.reason}`);
        });
      }
    },
    [limits, scope, employeeId],
  );

  const remove = useCallback((key: string) => {
    setFiles((was) => {
      const gone = was.find((f) => f.key === key);
      if (gone?.attachment) void removeAttachment(gone.attachment.id);
      if (gone?.preview) URL.revokeObjectURL(gone.preview);
      return was.filter((f) => f.key !== key);
    });
    setProblem(null);
  }, []);

  /** After sending: the files went with the message, so they are not taken back. */
  const sent = useCallback(() => {
    setFiles([]);
    setProblem(null);
  }, []);

  const ready: ConversationAttachment[] = files.flatMap((f) => (f.state === "ready" && f.attachment ? [f.attachment] : []));
  const uploading = files.some((f) => f.state === "uploading");
  const images = files.some((f) => f.state !== "failed" && f.kind === "image");
  return { files, problem, add, remove, sent, ready, uploading, images };
}

export type DraftFiles = ReturnType<typeof useDraftFiles>;
