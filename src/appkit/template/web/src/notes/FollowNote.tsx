import { useState } from "react";
import { api, ApiError, NotSignedInError, signInUrl, useApiQuery, useCurrentUser } from "@endgame/appkit";
import { Button, FailedState, LoadingState } from "@endgame/appkit/ui";
import type { NoteFollow } from "./types";

/**
 * Following a note — the example of a person's own record (AGENTS.md). The page reads the person's own follow every time
 * it opens, so someone who comes back sees "Following", never "Follow" again; following is a PUT that answers the follow
 * they already have, so even an old tab cannot make a second one. Reading the follow requires sign-in, like every read of
 * someone's own record, so it is asked for only once someone is signed in; how many follow the note comes with the note,
 * for anyone.
 */
export function FollowNote({ noteId, followers }: { noteId: string; followers: number }) {
  const me = useCurrentUser();
  const signedIn = me.status === "loaded" && me.data !== null;
  const follow = useApiQuery<NoteFollow>(signedIn ? `notes/${encodeURIComponent(noteId)}/follow` : null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ApiError | null>(null);

  async function set(following: boolean) {
    setBusy(true);
    setFailure(null);
    try {
      // Every read on screen re-reads after this write — the follow and the note's count — so both show what is now true.
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

  const count = <span className="text-sm text-ink-muted">{`${followers} ${followers === 1 ? "person follows" : "people follow"} this note`}</span>;
  if (me.status === "loading") return <LoadingState label="Checking who is signed in…" />;
  if (me.status === "failed") return <FailedState error={me.error} onRetry={me.reload} />;
  if (!signedIn) {
    return (
      <div className="flex flex-col gap-3">
        <Button asChild variant="outline" className="w-full">
          <a href={signInUrl()}>Sign in to follow</a>
        </Button>
        {count}
      </div>
    );
  }
  if (follow.status === "loading") return <LoadingState label="Reading whether you follow it…" />;
  if (follow.status === "failed") return <FailedState error={follow.error} onRetry={follow.reload} />;
  return (
    <div className="flex flex-col gap-3">
      {follow.data.following ? (
        <Button variant="outline" className="w-full" data-testid="set-following-false" disabled={busy} onClick={() => void set(false)}>
          Following · stop
        </Button>
      ) : (
        <Button className="w-full" data-testid="set-following-true" disabled={busy} onClick={() => void set(true)}>
          Follow
        </Button>
      )}
      {count}
      {failure && <FailedState error={failure} />}
    </div>
  );
}
