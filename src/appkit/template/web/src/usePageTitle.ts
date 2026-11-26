import { useEffect } from "react";
import { APP_NAME } from "./appName";

/** The browser tab, the history list and a phone's app switcher name the page: "All notes · Notes". */
export function usePageTitle(page: string | null) {
  useEffect(() => {
    document.title = page ? `${page} · ${APP_NAME}` : APP_NAME;
  }, [page]);
}
