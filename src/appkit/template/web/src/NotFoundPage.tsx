import { Link } from "react-router";
import { Button, NotFoundState } from "@endgame/appkit/ui";
import { usePageTitle } from "./usePageTitle";

/** Any address the app has no page for: what happened, and the way back to its first page. */
export function NotFoundPage() {
  usePageTitle("Not found");
  return (
    <section data-testid="page-not-found" className="flex flex-1 flex-col">
      <NotFoundState
        action={
          <Button asChild>
            <Link to="/">Back to all notes</Link>
          </Button>
        }
      />
    </section>
  );
}
