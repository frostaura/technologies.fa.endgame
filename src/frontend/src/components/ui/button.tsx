import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * The one button (ARCH-011). A label never runs out of its column: a button is at most as wide as its
 * container, and a label too long for that (an app's 200-character name) is cut with an ellipsis, the whole of
 * it in the tooltip. Three heights — `sm` 32, `md` 40, `lg` 48 — each at least 44 wherever the
 * screen is worked by touch; one corner radius (`rounded-xs`); one label size per height; five variants;
 * one disabled look (a grey fill and muted words, never a faded colour). A pill is a chip, never a button.
 *
 * - `primary`: the one thing to do here.
 * - `secondary`: an outlined choice beside it, or a safe way back.
 * - `quiet`: words in the link colour, for a minor action in a row or under a card.
 * - `danger`: the confirm of a confirmation that removes, cancels, declines or lets go.
 * - `danger-outline`: the control that asks to remove, before its confirmation.
 *
 * `icon`: a square button holding only an icon (it carries an `aria-label`).
 */
const buttonVariants = cva(
  "inline-flex max-w-full shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-xs font-semibold transition-colors duration-150 motion-reduce:transition-none disabled:pointer-events-none disabled:cursor-not-allowed disabled:border-transparent disabled:bg-quiet disabled:text-ink-muted disabled:shadow-none aria-disabled:pointer-events-none aria-disabled:border-transparent aria-disabled:bg-quiet aria-disabled:text-ink-muted",
  {
    variants: {
      variant: {
        primary: "bg-primary text-primary-ink hover:bg-primary-hover",
        secondary: "border border-border-field bg-surface text-ink hover:bg-ground",
        quiet: "bg-transparent text-primary-link hover:bg-primary-tint hover:text-primary-hover",
        danger: "bg-attention-text text-primary-ink hover:bg-attention-strong",
        "danger-outline": "border border-attention-text bg-surface text-attention-text hover:bg-attention-tint",
        /** @deprecated Retired names, kept only for the conversation lane's files until they adopt the five (design.test.ts holds them there). */
        outline: "border border-border-field bg-surface text-ink hover:bg-ground",
        /** @deprecated See `outline`. */
        soft: "border border-border-field bg-surface text-ink hover:bg-ground",
        /** @deprecated See `outline`. */
        ghost: "bg-transparent text-primary-link hover:bg-primary-tint hover:text-primary-hover",
      },
      size: {
        sm: "h-8 px-3 text-sm touch:h-auto touch:min-h-touch",
        md: "h-10 px-4 text-sm touch:h-auto touch:min-h-touch",
        lg: "h-12 px-5 text-base",
        icon: "size-10 shrink-0 p-0 touch:size-11",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export type ButtonVariant = NonNullable<VariantProps<typeof buttonVariants>["variant"]>;

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, asChild = false, type, children, title, ...props }, ref) => {
  const Comp = asChild ? Slot : "button";
  // A label of plain words (`Archive {name}` is several strings): cut with an ellipsis when it outgrows its column.
  const parts = Array.isArray(children) ? children : [children];
  const words = !asChild && parts.length > 0 && parts.every((c) => typeof c === "string" || typeof c === "number");
  const text = words ? parts.join("") : "";
  return (
    <Comp ref={ref} type={asChild ? undefined : (type ?? "button")} title={title ?? (words && text.length > 40 ? text : undefined)} className={cn(buttonVariants({ variant, size }), className)} {...props}>
      {words ? <span className="min-w-0 truncate">{children}</span> : children}
    </Comp>
  );
});
Button.displayName = "Button";

export { buttonVariants };
