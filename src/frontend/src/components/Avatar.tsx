import { avatarFill, initial } from "@/lib/avatar";
import { cn } from "@/lib/utils";

export function Avatar({ name, seed, size = "sm", shape = "round", className }: { name: string; seed?: string; size?: "xs" | "sm" | "md" | "lg"; shape?: "round" | "square"; className?: string }) {
  const sizes = { xs: "size-6 text-xs", sm: "size-8 text-sm", md: "size-10 text-lg", lg: "size-16 text-2xl" }[size];
  return (
    <span
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center font-display font-bold text-primary-ink",
        shape === "round" ? "rounded-full" : "rounded-xs",
        avatarFill(seed ?? name),
        sizes,
        className,
      )}
    >
      {initial(name)}
    </span>
  );
}
