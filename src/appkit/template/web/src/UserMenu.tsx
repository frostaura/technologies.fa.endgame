import { signInUrl, signOutUrl, useCurrentUser } from "@endgame/appkit";
import { Button } from "@endgame/appkit/ui";

/** Who is signed in, with the way in or out. Sign-in pages are the platform's, under the app's address. */
export function UserMenu() {
  const me = useCurrentUser();
  if (me.status === "loading") return <span className="text-sm text-ink-muted">…</span>;
  if (me.status === "failed") return <span className="text-sm text-attention-text">Could not check who is signed in</span>;
  if (me.data === null) {
    return (
      <Button asChild variant="outline" size="sm">
        <a href={signInUrl()}>Sign in</a>
      </Button>
    );
  }
  return (
    // A phone keeps the row to the way out; the name shows from a tablet up, and is read out everywhere.
    <div className="flex min-w-0 items-center gap-1 text-sm sm:gap-3">
      <span className="truncate text-ink-muted max-sm:sr-only" data-testid="signed-in-as">
        {me.data.displayName}
      </span>
      <Button asChild variant="ghost" size="sm">
        <a href={signOutUrl()}>Sign out</a>
      </Button>
    </div>
  );
}
