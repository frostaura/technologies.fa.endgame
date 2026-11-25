/** Strip inline markdown to plain text. Shared by the build tools and the site. */
export function plain(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(^|[^*])\*([^*]+)\*/g, "$1$2")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** Typographer's quotes for prose: "Sign in" → “Sign in”, it's → it’s. Code spans are left alone. */
export function curly(text: string): string {
  return text.replace(/"([^"]*)"/g, "“$1”").replace(/(\w)'(\w)/g, "$1’$2");
}

/** "the band totals…" → "The band totals…": a field fragment shown as a sentence. */
export function sentence(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
