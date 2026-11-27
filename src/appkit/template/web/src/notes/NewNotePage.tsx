import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { api, ApiError, checkDateInput, formatDateTime, formatNumber, NotSignedInError, signInUrl, signUpUrl, useCurrentUser, ValidationError } from "@endgame/appkit";
import { Button, EmptyState, FailedState, Field, FormActions, FormCard, Input, LoadingState, PageHeader, PageLayout, Panel, Textarea, useFormErrors, type FieldErrors } from "@endgame/appkit/ui";
import { usePageTitle } from "../usePageTitle";
import { BODY_MAX, HAPPENS_AT_LIMITS, TITLE_MAX, type NoteDetail } from "./types";

/**
 * Writing a note: the form page's shape (AGENTS.md, "What good looks like") — a way back, the page's title, the form in a
 * measured column with "Save note" and "Cancel" at its foot, and beside it on a desktop (under it on a phone) the note as it
 * will read. Writing needs a signed-in person; everyone else is offered the platform's sign-in.
 */
export default function NewNotePage() {
  usePageTitle("New note");
  return (
    <section data-testid="page-new-note">
      <PageHeader back={<Link to="/">All notes</Link>} title="New note" description="Everyone in the app can read it once it is saved." />
      <NewNoteContent />
    </section>
  );
}

function NewNoteContent() {
  const me = useCurrentUser();
  if (me.status === "loading") return <LoadingState />;
  if (me.status === "failed") return <FailedState error={me.error} onRetry={me.reload} />;
  if (me.data === null) {
    return (
      <EmptyState
        className="max-w-form"
        title="Sign in to write a note"
        action={
          <div className="flex flex-wrap gap-3 max-sm:flex-col">
            <Button asChild>
              <a href={signInUrl()}>Sign in</a>
            </Button>
            <Button asChild variant="outline">
              <a href={signUpUrl()}>Create an account</a>
            </Button>
          </div>
        }
      >
        Notes are written by the people who use this app.
      </EmptyState>
    );
  }
  return <NewNoteForm />;
}

function NewNoteForm() {
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  // What the date field holds, exactly as typed: a browser lets values through that no date can be (a six-digit year).
  const [happensAt, setHappensAt] = useState("");
  const [saving, setSaving] = useState(false);
  // The kit holds the field errors: shown on submit, focus on the first, and each cleared as soon as its field is changed.
  const form = useFormErrors();
  const [failure, setFailure] = useState<ApiError | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFailure(null);
    // Checked before it is sent, field by field, with the same limits as the inputs: a browser does not stop a person typing
    // past min and max. The server checks again, and its field errors are shown the same way.
    const errors: FieldErrors = {};
    if (!title.trim()) errors.Title = ["Give the note a title."];
    else if (title.trim().length > TITLE_MAX) errors.Title = [`Keep the title to ${TITLE_MAX} characters.`];
    if (body.length > BODY_MAX) errors.Body = [`Keep the note to ${formatNumber(BODY_MAX)} characters.`];
    const when = checkDateInput(happensAt, HAPPENS_AT_LIMITS);
    if (when.error) errors.HappensAt = [when.error];
    if (form.show(errors)) return;
    setSaving(true);
    try {
      const note = await api<NoteDetail>("notes", { method: "POST", body: { title, body, happensAt: when.date?.toISOString() ?? null } });
      navigate(`/notes/${note.id}`);
    } catch (error) {
      if (error instanceof NotSignedInError) {
        window.location.assign(error.signInUrl ?? signInUrl());
        return;
      }
      if (error instanceof ValidationError) form.show(error.errors);
      else setFailure(error instanceof ApiError ? error : new ApiError(0, { detail: String(error) }));
      setSaving(false);
    }
  }

  const titleError = form.error("title");
  const happensAtError = form.error("happensAt");
  const bodyError = form.error("body");
  // A desktop uses its width: the form in a measured column, and beside it the note as it will read. On a phone the preview
  // follows the form.
  return (
    <PageLayout
      form
      asideLabel="How it will read"
      aside={
        <Panel title="How it will read">
          <div className="flex flex-col gap-2">
            <p className="break-words font-display text-lg font-semibold text-ink">{title.trim() || "Untitled"}</p>
            {/* Formatted by the kit, which never throws: whatever the field holds, the preview stays whole. */}
            <p className="text-sm text-ink-muted">{formatDateTime(happensAt, { fallback: "No date yet" })}</p>
            {body.trim() ? <p className="whitespace-pre-wrap break-words">{body}</p> : <p className="text-ink-muted">No body yet.</p>}
          </div>
        </Panel>
      }
    >
      <FormCard>
        <form {...form.formProps} className="flex flex-col gap-5" onSubmit={submit}>
          <Field label="Title" htmlFor="title" error={titleError} errorId="title-error" hint={`Up to ${TITLE_MAX} characters.`}>
            <Input
              id="title"
              name="title"
              data-testid="note-title"
              autoComplete="off"
              enterKeyHint="next"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              invalid={!!titleError}
              aria-describedby="title-error"
              required
              aria-required="true"
              maxLength={TITLE_MAX}
            />
          </Field>
          <Field label="When it happens (optional)" htmlFor="happensAt" error={happensAtError} errorId="happens-at-error">
            <Input
              id="happensAt"
              name="happensAt"
              type="datetime-local"
              data-testid="note-happens-at"
              min={HAPPENS_AT_LIMITS.min}
              max={HAPPENS_AT_LIMITS.max}
              value={happensAt}
              onChange={(e) => setHappensAt(e.target.value)}
              invalid={!!happensAtError}
              aria-describedby="happens-at-error"
            />
          </Field>
          <Field label="Body" htmlFor="body" error={bodyError} errorId="body-error">
            <Textarea
              id="body"
              name="body"
              data-testid="note-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              maxLength={BODY_MAX}
              invalid={!!bodyError}
              aria-describedby="body-error"
            />
          </Field>
          {failure && <FailedState title="The note was not saved" error={failure} />}
          <FormActions
            submit={
              <Button type="submit" disabled={saving} data-testid="save-note">
                {saving ? "Saving…" : "Save note"}
              </Button>
            }
            cancel={<Link to="/">Cancel</Link>}
          />
        </form>
      </FormCard>
    </PageLayout>
  );
}
