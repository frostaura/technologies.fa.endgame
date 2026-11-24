import { cn } from "@/lib/utils";
import { ICON_KIND, type IconName } from "./iconNames";

/**
 * One icon from the sprite at `/brand/icons.svg`. Icons take their colour from the text around
 * them; `tinted` colours them by what they are, as the iconography sheet sets out — structure
 * blue, people violet, the factory teal, money and health green, anything that needs you coral.
 */
export function Icon({ name, tinted = false, className, label }: { name: IconName; tinted?: boolean; className?: string; label?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
      className={cn("size-5 shrink-0", tinted && ICON_KIND[name], className)}
    >
      <use href={`/brand/icons.svg#${name}`} />
    </svg>
  );
}
