import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * tailwind-merge, taught the token layer's own class names. Without this it reads `text-hero`
 * as a colour and silently drops the real colour beside it.
 */
const twMerge = extendTailwindMerge<"animation-delay">({
  extend: {
    classGroups: {
      "font-size": [{ text: ["hero", "balance", "eyebrow"] }],
      "bg-image": [{ bg: ["stripe", "shimmer"] }],
      "animation-delay": [{ "animate-delay": ["1", "2", "3", "4", "5"] }],
    },
  },
});

/** shadcn/ui's class merger: later classes win over conflicting earlier ones. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
