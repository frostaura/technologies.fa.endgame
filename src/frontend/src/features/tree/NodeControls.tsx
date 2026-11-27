import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ConfirmCard } from "@/components/ui/confirm";
import { useCardNote } from "@/components/cardNote";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { isValidSlug, slugify } from "@/lib/format";
import { describeError, errorStatus } from "@/lib/queryState";
import { useCreateNodeMutation, useDeleteNodeMutation, useUpdateNodeMutation, type TreeArg } from "@/store/api";
import type { ManagedLevel, ScopeLevel, TreeNode } from "@/store/types";
import { LEVEL_NAME, reactivatedStatus } from "./treeManage";

/** A result line under a control: what happened, or why nothing did. */
export function Outcome({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <p role={ok ? "status" : "alert"} className={ok ? "text-success-text" : "rounded-xs bg-attention-tint px-3 py-2 text-sm text-attention-text"}>
      {children}
    </p>
  );
}

const NAME_LIMIT = 200;

/** The level's name in a sentence: "division", "project", "app" or "organisation". */
const word = (level: ScopeLevel) => LEVEL_NAME[level].toLowerCase();

/**
 * Renames a node. The name is what people read; its address (the slug) was fixed when it was made and
 * never changes, so nothing that links to it breaks.
 */
export function RenameNode({ level, id, name, slug, tree, onDone }: { level: ManagedLevel | "organisation"; id: string; name: string; slug: string; tree: TreeArg; onDone?: () => void }) {
  const [update, state] = useUpdateNodeMutation();
  const [value, setValue] = useState(name);
  // One message per card (D37): within a CardNotesProvider the panel shows only the last card's.
  const [result, setResult] = useCardNote<{ ok: boolean; text: string }>(`rename:${id}`);
  const fieldId = useId();
  const typed = value.trim();
  const problem = typed.length === 0 ? "A name cannot be empty." : typed.length > NAME_LIMIT ? `A name is at most ${NAME_LIMIT} characters.` : null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (problem || typed === name) return;
    setResult(null);
    try {
      await update({ level, id, name: typed, tree }).unwrap();
      setResult({ ok: true, text: `It is called ${typed} now.` });
      onDone?.();
    } catch (e) {
      setValue(name);
      setResult({ ok: false, text: `The name was not changed: ${describeError(e as never)} It is back to ${name}.` });
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} aria-label={`Rename the ${word(level)}`} className="flex min-w-0 flex-col gap-2" noValidate>
      {/*
        The field grows with its panel and Save sits at its end, on the field's own line (console-desktop 13). Where the
        two do not fit side by side (a phone, a narrow side column), Save wraps under the field.
      */}
      <Field id={fieldId} label="Name" hint={`Its address stays ${slug}: an address never changes once it is made.`} problem={value.length > 0 ? problem : null}>
        <div data-rename-row="" className="flex flex-wrap items-center gap-2">
          <Input id={fieldId} value={value} maxLength={NAME_LIMIT + 1} onChange={(e) => setValue(e.target.value)} aria-describedby={`${fieldId}-hint`} aria-invalid={!!problem} className="flex-1 basis-56" />
          <Button type="submit" className="shrink-0" disabled={!!problem || typed === name || state.isLoading}>
            {state.isLoading ? "Saving…" : "Save the name"}
          </Button>
        </div>
      </Field>
      {result && <Outcome ok={result.ok}>{result.text}</Outcome>}
    </form>
  );
}

/** Archives or reactivates a node. Anything with history is archived rather than deleted. */
export function ArchiveNode({ level, id, name, archived, published, tree, onArchived }: { level: ManagedLevel; id: string; name: string; archived: boolean; published: boolean; tree: TreeArg; onArchived?: () => void }) {
  const [update, state] = useUpdateNodeMutation();
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useCardNote<{ ok: boolean; text: string }>(`archive:${id}`);

  const change = async (to: string) => {
    setConfirming(false);
    setResult(null);
    try {
      await update({ level, id, status: to, tree }).unwrap();
      setResult({ ok: true, text: to === "archived" ? `${name} is archived. Nothing in it was deleted.` : `${name} is active again.` });
      if (to === "archived") onArchived?.();
    } catch (e) {
      setResult({ ok: false, text: `${name} was not ${to === "archived" ? "archived" : "reactivated"}: ${describeError(e as never)} It is as it was.` });
    }
  };

  const effect =
    level === "app"
      ? "It stops being served at its address. Its code, data and history are kept, and reactivating it brings it back."
      : `It is marked archived and keeps its history, spending and people. None of its apps is served until it is reactivated.`;

  return (
    <div className="flex min-w-0 max-w-full flex-col gap-2">
      {archived ? (
        <Button size="sm" variant="secondary" className="self-start" disabled={state.isLoading} onClick={() => void change(reactivatedStatus(level, published))}>
          Reactivate {name}
        </Button>
      ) : confirming ? (
        <Confirm title={`Archive ${name}?`} text={effect} yes={`Yes, archive ${name}`} no="Keep it active" onYes={() => void change("archived")} onNo={() => setConfirming(false)} />
      ) : (
        <Button size="sm" variant="secondary" className="self-start" disabled={state.isLoading} onClick={() => setConfirming(true)}>
          Archive {name}
        </Button>
      )}
      {result && <Outcome ok={result.ok}>{result.text}</Outcome>}
    </div>
  );
}

/**
 * Deletes a node with nothing attached. The control plane refuses one with children, work or credit
 * history (409) and says so, in plain words in normal mode, with archiving offered instead.
 */
export function DeleteNode({ level, id, name, tree, onDeleted }: { level: ManagedLevel; id: string; name: string; tree: TreeArg; onDeleted: () => void }) {
  const [remove, state] = useDeleteNodeMutation();
  const [update, archiving] = useUpdateNodeMutation();
  const [confirming, setConfirming] = useState(false);
  // The refusal, or what archiving instead did: one note, never both (D37).
  const [note, setNote] = useCardNote<{ ok: boolean; text: string; archivable: boolean }>(`delete:${id}`);

  const confirm = async () => {
    setConfirming(false);
    setNote(null);
    try {
      await remove({ level, id }).unwrap();
      onDeleted();
    } catch (e) {
      setNote({ ok: false, text: `${name} was not deleted: ${describeError(e as never)}`, archivable: errorStatus(e as never) === 409 });
    }
  };

  const archiveInstead = async () => {
    try {
      await update({ level, id, status: "archived", tree }).unwrap();
      setNote({ ok: true, text: `${name} is archived instead. Nothing in it was deleted.`, archivable: false });
    } catch (e) {
      setNote({ ok: false, text: `${name} was not archived either: ${describeError(e as never)}`, archivable: false });
    }
  };

  return (
    <div className="flex min-w-0 max-w-full flex-col gap-2">
      {confirming ? (
        <Confirm
          title={`Delete ${name}?`}
          text={`This cannot be undone. Only ${level === "app" ? "an" : "a"} ${word(level)} with nothing in it, no work and no spending can be deleted; the settings and roles set on it go with it.`}
          yes={`Yes, delete ${name}`}
          no="Keep it"
          onYes={() => void confirm()}
          onNo={() => setConfirming(false)}
        />
      ) : (
        <Button size="sm" variant="danger-outline" className="self-start" disabled={state.isLoading} onClick={() => setConfirming(true)}>
          Delete {name}
        </Button>
      )}
      {note && !note.ok && (
        <Alert
          tone="bad"
          title={note.text}
          action={
            note.archivable ? (
              <Button size="sm" variant="secondary" disabled={archiving.isLoading} onClick={() => void archiveInstead()}>
                Archive it instead
              </Button>
            ) : undefined
          }
        />
      )}
      {note?.ok && <Outcome ok>{note.text}</Outcome>}
    </div>
  );
}

/**
 * Adds a division, project or app beneath a node. The address is made from the name and shown as it
 * will be; it can be changed until the node is made, never after.
 */
export function CreateChild({ level, parent, parentName, onCreated, onCancel }: { level: ManagedLevel; parent: string; parentName: string; onCreated: (node: TreeNode) => void; onCancel: () => void }) {
  const [create, state] = useCreateNodeMutation();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [edited, setEdited] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const ids = { name: useId(), slug: useId() };
  const shown = edited ? slug : slugify(name);
  const typed = name.trim();
  const slugProblem = shown.length > 0 && !isValidSlug(shown) ? "Use 2 to 40 lower-case letters, digits and single hyphens, starting and ending with a letter or digit." : null;
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => first.current?.focus(), []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!typed || !isValidSlug(shown)) return;
    setProblem(null);
    try {
      const node = await create({ level, parent, name: typed, slug: shown }).unwrap();
      onCreated(node);
    } catch (e) {
      setProblem(`The ${word(level)} was not made: ${describeError(e as never)} Nothing changed.`);
    }
  };

  return (
    <ConfirmCard
      label={`Add a ${word(level)} to ${parentName}`}
      question={`A new ${word(level)} in ${parentName}`}
      confirm={state.isLoading ? "Adding…" : `Add the ${word(level)}`}
      cancel="Not now"
      destructive={false}
      busy={!typed || !isValidSlug(shown) || typed.length > NAME_LIMIT || state.isLoading}
      onSubmit={(e) => void submit(e)}
      onCancel={() => onCancel?.()}
    >
      <div className="flex flex-col gap-4">
        <Field id={ids.name} label="Name" hint="What everyone reads. It can be renamed at any time." problem={typed.length > NAME_LIMIT ? `A name is at most ${NAME_LIMIT} characters.` : null}>
          <Input ref={first} id={ids.name} name="name" value={name} onChange={(e) => setName(e.target.value)} aria-describedby={`${ids.name}-hint`} />
        </Field>
        <Field id={ids.slug} label="Its address" hint={`${parent}/${shown || "…"}. It cannot be changed once it is made.`} problem={slugProblem}>
          <Input
            id={ids.slug}
            name="slug"
            value={shown}
            onChange={(e) => {
              setEdited(true);
              setSlug(e.target.value.toLowerCase());
            }}
            aria-describedby={`${ids.slug}-hint`}
            aria-invalid={!!slugProblem}
            className="font-mono"
          />
        </Field>
      </div>
      {problem && <Outcome ok={false}>{problem}</Outcome>}
    </ConfirmCard>
  );
}

/** A confirmation in place, focused when it opens and closed with Escape: the shared `ConfirmCard`. */
export function Confirm({ title, text, yes, no, onYes, onNo, className }: { title: string; text: string; yes: string; no: string; onYes: () => void; onNo: () => void; className?: string }) {
  return <ConfirmCard role="alertdialog" focus label={title} question={title} detail={text} confirm={yes} cancel={no} onConfirm={onYes} onCancel={onNo} className={className} />;
}
