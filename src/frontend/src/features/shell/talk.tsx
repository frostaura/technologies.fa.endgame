import { useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { InSheetContext, ShellTalkContext } from "./talkContext";

/** The shell's own: on a phone or a tablet, the page's conversation drawn into the shell's sheet. */
export function TalkInSheet({ children }: { children: ReactNode }) {
  const shell = useContext(ShellTalkContext);
  if (!shell?.compact || !shell.target) return null;
  return createPortal(<InSheetContext.Provider value>{children}</InSheetContext.Provider>, shell.target);
}

/**
 * A page's own button to its conversation, where the page wants one in reach (an app's or an employee's page, under
 * its figures). On a phone or a tablet it opens the shell's sheet; on a desktop the conversation is already docked
 * beside the page, so it draws nothing.
 */
export function TalkLauncher({ className }: { className?: string }) {
  const shell = useContext(ShellTalkContext);
  if (!shell?.compact || !shell.label) return null;
  return (
    <Button variant="soft" size="lg" className={cn("w-full justify-start", className)} onClick={shell.open} aria-haspopup="dialog" data-talk-launcher="">
      <MessageCircle aria-hidden className="size-5 text-primary" />
      {shell.label}
    </Button>
  );
}
