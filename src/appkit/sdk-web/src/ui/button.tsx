import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "./cn.js";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-sm text-sm font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        primary: "bg-primary text-primary-ink hover:bg-primary-hover",
        outline: "border border-border-strong bg-surface text-ink hover:bg-ground",
        ghost: "text-ink hover:bg-ground",
        /** Removes or gives something up: "Delete", "Give up my seat". Always beside a quiet way back. */
        danger: "bg-attention-text text-primary-ink hover:bg-attention-text/90",
      },
      // `sm` is compact where a pointer is precise; on a phone every button is a 44px target.
      size: { sm: "h-11 px-3 sm:h-9", md: "h-11 px-4" },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export { buttonVariants };

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  /** Render the child (e.g. a router `Link` or an `<a>`) with button styling instead of a `<button>`. */
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, asChild = false, ...props }, ref) => {
  const Comp = asChild ? Slot : "button";
  return <Comp ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
});
Button.displayName = "Button";
