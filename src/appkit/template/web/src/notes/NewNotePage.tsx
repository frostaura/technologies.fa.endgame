import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { api, ApiError, NotSignedInError, signInUrl, signUpUrl, useCurrentUser, ValidationError } from "@endgame/appkit";
import { Button, Card, CardContent, CardHeader, CardTitle, FailedState, FieldError, Input, Label, LoadingState, Textarea } from "@endgame/appkit/ui";
import type { NoteDetail } from "./types";

/** Writing needs a signed-in person; everyone else is offered the platform's sign-in. */
export default function NewNotePage() {
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
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [failure, setFailure] = useState<ApiError | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setFieldErrors({});
    setFailure(null);
    try {
      const note = await api<NoteDetail>("notes", { method: "POST", body: { title, body } });
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
  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>New note</CardTitle>
      </CardHeader>
      <CardContent>
        <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
          <div className="flex flex-col gap-2">
            <Label htmlFor="title">Title</Label>
            <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} invalid={!!titleError} aria-describedby="title-error" maxLength={200} />
            <FieldError id="title-error">{titleError}</FieldError>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="body">Body</Label>
            <Textarea id="body" value={body} onChange={(e) => setBody(e.target.value)} />
          </div>
          {failure && <FailedState title="The note was not saved" error={failure} />}
          <div>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save note"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
