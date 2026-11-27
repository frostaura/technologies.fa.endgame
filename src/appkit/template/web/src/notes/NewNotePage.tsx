import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { api, ApiError, checkDateInput, formatDateTime, NotSignedInError, signInUrl, signUpUrl, useCurrentUser, ValidationError } from "@endgame/appkit";
import { Button, Card, CardContent, CardHeader, CardTitle, FailedState, FieldError, Input, Label, LoadingState, Textarea } from "@endgame/appkit/ui";
import { usePageTitle } from "../usePageTitle";
import { HAPPENS_AT_LIMITS, TITLE_MAX, type NoteDetail } from "./types";

/** Writing needs a signed-in person; everyone else is offered the platform's sign-in. */
export default function NewNotePage() {
  usePageTitle("New note");
  return (
    <section data-testid="page-new-note">
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
      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>Sign in to write a note</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button asChild>
            <a href={signInUrl()}>Sign in</a>
          </Button>
          <Button asChild variant="outline">
            <a href={signUpUrl()}>Create an account</a>
          </Button>
        </CardContent>
      </Card>
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
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [failure, setFailure] = useState<ApiError | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFailure(null);
    // Checked before it is sent, field by field, with the same limits as the inputs: a browser does not stop a person typing
    // past min and max. The server checks again, and its field errors are shown the same way.
    const errors: Record<string, string[]> = {};
    if (!title.trim()) errors.Title = ["Give the note a title."];
    else if (title.trim().length > TITLE_MAX) errors.Title = [`Keep the title to ${TITLE_MAX} characters.`];
    const when = checkDateInput(happensAt, HAPPENS_AT_LIMITS);
    if (when.error) errors.HappensAt = [when.error];
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;
    setSaving(true);
    try {
      const note = await api<NoteDetail>("notes", { method: "POST", body: { title, body, happensAt: when.date?.toISOString() ?? null } });
      navigate(`/notes/${note.id}`);
    } catch (error) {
      if (error instanceof NotSignedInError) {
        window.location.assign(error.signInUrl ?? signInUrl());
        return;
      }
      if (error instanceof ValidationError) setFieldErrors(error.errors);
      else setFailure(error instanceof ApiError ? error : new ApiError(0, { detail: String(error) }));
      setSaving(false);
    }
  }

  const titleError = fieldErrors.Title?.[0];
  const happensAtError = fieldErrors.HappensAt?.[0];
  // A desktop uses its width: the form, and beside it the note as it will read. A phone has the form alone.
  return (
    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>New note</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
            <div className="flex flex-col gap-2">
              <Label htmlFor="title">Title</Label>
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
              <FieldError id="title-error">{titleError}</FieldError>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="happensAt">When it happens (optional)</Label>
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
              <FieldError id="happens-at-error">{happensAtError}</FieldError>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="body">Body</Label>
              <Textarea id="body" name="body" data-testid="note-body" value={body} onChange={(e) => setBody(e.target.value)} />
            </div>
            {failure && <FailedState title="The note was not saved" error={failure} />}
            <div>
              <Button type="submit" disabled={saving} data-testid="save-note" className="max-sm:w-full">
                {saving ? "Saving…" : "Save note"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
      <Card className="hidden lg:block" aria-label="How it will read">
        <CardHeader>
          <p className="text-sm font-semibold text-ink-muted">How it will read</p>
          <CardTitle className="break-words">{title.trim() || "Untitled"}</CardTitle>
          {/* Formatted by the kit, which never throws: whatever the field holds, the preview stays whole. */}
          <p className="text-sm text-ink-muted">{formatDateTime(happensAt, { fallback: "No date yet" })}</p>
        </CardHeader>
        <CardContent>
          {body.trim() ? <p className="whitespace-pre-wrap break-words">{body}</p> : <p className="text-ink-muted">No body.</p>}
        </CardContent>
      </Card>
    </div>
  );
}
