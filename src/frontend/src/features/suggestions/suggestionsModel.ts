import type { RunStatus } from "@/store/types";

/**
 * What the suggestion run is doing, read from the run itself (D42): it may be waiting for the person to approve its
 * start, have stopped, or be working. Null while nothing has been asked for, or before the run is read.
 */
export function suggestingState(status: RunStatus | null | undefined): { title: string; text: string; link: string } | null {
  switch (status) {
    case undefined:
    case null:
      return null;
    case "waiting":
      return { title: "It is waiting for you to approve the start", text: "Nothing is worked out until you approve it.", link: "Approve it" };
    case "paused":
      return { title: "It is paused", text: "It waits for more credits, or for someone to resume it.", link: "See why" };
    case "failed":
    case "cancelled":
      return { title: "It stopped before any suggestions were made", text: "Nothing more is charged. You can ask again.", link: "See what happened" };
    case "finished":
      return null;
    default:
      return { title: "The suggestions are being worked out", text: "They appear here as soon as they are ready; you can watch the work meanwhile.", link: "Watch it work" };
  }
}
