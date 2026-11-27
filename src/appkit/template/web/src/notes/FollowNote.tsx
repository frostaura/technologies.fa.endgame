import { useState } from "react";
import { api, ApiError, NotSignedInError, signInUrl, useApiQuery } from "@endgame/appkit";
import { Button, FailedState, LoadingState } from "@endgame/appkit/ui";
import type { NoteFollow } from "./types";

/**
 * Following a note — the example of a person's own record (AGENTS.md). The page reads the person's own follow every time
 * it opens, so someone who comes back sees "Following", never "Follow" again; following is a PUT that answers the follow
 * they already have, so even an old tab cannot make a second one.
 */
export function FollowNote({ noteId }: { noteId: string }) {
  const follow = useApiQuery<NoteFollow>(`notes/${encodeURIComponent(noteId)}/follow`);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ApiError | null>(null);

  async function set(following: boolean) {
    setBusy(true);
    setFailure(null);
    try {
      // Every read on screen re-reads after this write, so the button shows what is now true.
      await api<NoteFollow>(`notes/${encodeURIComponent(noteId)}/follow`, { method: following ? "PUT" : "DELETE" });
    } catch (error) {
      if (error instanceof NotSignedInError) {
        window.location.assign(error.signInUrl ?? signInUrl());
        return;
      }
      setFailure(error instanceof ApiError ? error : null);
    } finally {
      setBusy(false);
    }
  }

  if (follow.status === "loading") return <LoadingState label="Reading whether you follow it…" />;
  if (follow.status === "failed") return <FailedState error={follow.error} onRetry={follow.reload} />;
  const { following, followers, signedIn } = follow.data;
  const count = `${followers} ${followers === 1 ? "person follows" : "people follow"} this note`;
  return (
    <div className="flex flex-wrap items-center gap-3">
      {signedIn &&
        (following ? (
          <Button variant="outline" className="min-h-11 max-sm:w-full" data-testid="set-following-false" disabled={busy} onClick={() => void set(false)}>
            Following · stop
          </Button>
        ) : (
          <Button className="min-h-11 max-sm:w-full" data-testid="set-following-true" disabled={busy} onClick={() => void set(true)}>
            Follow
          </Button>
        ))}
      <span className="text-sm text-ink-muted">{count}</span>
      {failure && <FailedState error={failure} />}
    </div>
  );
}
