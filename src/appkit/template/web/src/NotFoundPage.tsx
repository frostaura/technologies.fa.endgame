import { Link } from "react-router";
import { EmptyState } from "@endgame/appkit/ui";

export function NotFoundPage() {
  return (
    <section data-testid="page-not-found">
      <EmptyState title="There is nothing at this address">
        <Link to="/" className="font-semibold text-primary hover:text-primary-hover">
          Back to all notes
        </Link>
      </EmptyState>
    </section>
  );
}
