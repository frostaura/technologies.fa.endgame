/** The Endgame mark, served from the console's own brand files. */
export function Mark({ className = "h-8 w-8" }: { className?: string }) {
  return <img src="./brand/endgame-mark.svg" alt="" aria-hidden="true" className={className} />;
}
