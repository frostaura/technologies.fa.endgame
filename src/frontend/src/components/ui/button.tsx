import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-semibold transition duration-200 ease-out hover:-translate-y-0.5 disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none motion-reduce:hover:translate-y-0",
  {
    variants: {
      variant: {
        primary: "rounded-sm bg-primary text-primary-ink hover:bg-primary-hover hover:shadow-press",
        outline: "rounded-xs border border-ink bg-surface font-medium text-ink hover:shadow-press",
        soft: "rounded-xs border border-border-strong bg-surface font-normal text-ink-body hover:bg-ground",
        ghost: "rounded-xs bg-transparent font-normal text-ink-body hover:bg-ground hover:translate-y-0",
        white: "rounded-sm bg-surface text-primary-hover hover:shadow-press",
      },
      size: { sm: "min-h-touch px-3", md: "min-h-touch px-4", lg: "min-h-12 px-5 text-base" },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, asChild = false, type, ...props }, ref) => {
  const Comp = asChild ? Slot : "button";
  return <Comp ref={ref} type={asChild ? undefined : (type ?? "button")} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
});
Button.displayName = "Button";

export { buttonVariants };
