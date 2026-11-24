import { useCallback, type AnchorHTMLAttributes, type MouseEvent } from "react";
import { navigate } from "@/lib/router";

/** An `<a>` that navigates in place; modified clicks still open a new tab as the browser intends. */
export function Link({ href, onClick, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  const handle = useCallback(
    (event: MouseEvent<HTMLAnchorElement>) => {
      onClick?.(event);
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      navigate(href);
    },
    [href, onClick],
  );
  return <a href={href} onClick={handle} {...props} />;
}
