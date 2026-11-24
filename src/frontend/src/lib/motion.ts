/** Stagger classes, written out in full so Tailwind's scanner finds every one. */
const STAGGER = ["", "animate-delay-1", "animate-delay-2", "animate-delay-3", "animate-delay-4", "animate-delay-5"] as const;

/** The rise-in delay for the i-th sibling (0-based), capped at the last step. */
export function stagger(i: number): string {
  return STAGGER[Math.max(0, Math.min(STAGGER.length - 1, i))] ?? "";
}

/** The rise-in entrance used down every screen, off under reduced motion. */
export const RISE = "animate-rise motion-reduce:animate-none";
