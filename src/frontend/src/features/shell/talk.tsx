import { useContext, useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { InSheetContext, ShellTalkContext } from "./talkContext";

/**
 * A page's conversation. On a desktop or a tablet, `children` where it stands (on a tablet, marked so
 * the header's "Talk" can bring it into view). On a phone, `children` move into the shell's sheet and,
 * where they stood, a button opens it (`launcher` false leaves nothing there).
 */
export function Talk({ label, launcher = true, launcherClassName, children }: { label: string; launcher?: boolean; launcherClassName?: string; children: ReactNode }) {
  const shell = useContext(ShellTalkContext);
  const compact = !!shell?.compact;
  const listed = compact || !!shell?.announce;
  const register = shell?.register;
  useEffect(() => (listed && register ? register(label) : undefined), [listed, register, label]);
  if (!shell || !compact) return shell?.announce ? <div data-talk-anchor="" className="contents">{children}</div> : <>{children}</>;
  return (
    <>
      {launcher && (
        <Button variant="soft" size="lg" className={cn("w-full justify-start", launcherClassName)} onClick={shell.open} aria-haspopup="dialog" data-talk-launcher="">
          <MessageCircle aria-hidden className="size-5 text-primary" />
          {label}
        </Button>
      )}
      {shell.target && createPortal(<InSheetContext.Provider value>{children}</InSheetContext.Provider>, shell.target)}
    </>
  );
}

