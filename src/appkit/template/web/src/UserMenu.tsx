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
    <div className="flex items-center gap-3 text-sm">
      <span className="text-ink-muted" data-testid="signed-in-as">
        {me.data.displayName}
      </span>
      <Button asChild variant="ghost" size="sm">
        <a href={signOutUrl()}>Sign out</a>
      </Button>
    </div>
  );
}
