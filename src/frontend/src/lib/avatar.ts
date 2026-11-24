const FILLS = ["bg-avatar-a", "bg-avatar-b", "bg-avatar-c", "bg-avatar-d", "bg-avatar-e", "bg-avatar-f"] as const;

/** A stable colour per name, so the same employee is always the same colour. */
export function avatarFill(seed: string): string {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return FILLS[h % FILLS.length] ?? FILLS[0];
}

export function initial(name: string): string {
  return (name.trim()[0] ?? "?").toUpperCase();
}
