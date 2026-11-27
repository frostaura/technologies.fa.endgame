/**
 * The app kit's class strings and its form hook that are not components (`src/appkit/sdk-web/src/ui/layout.tsx` and
 * `ui/form.tsx`), reproduced for the demo's hosted apps beside `kit.tsx`, unchanged, so an app in the academy looks and
 * behaves as one the factory builds.
 */
import * as React from "react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------------------------
// The header's pieces (`ui/layout.tsx`: `AppHeader`, `NavItem`, `UserMenu`)
// ---------------------------------------------------------------------------------------------

/** The kit's `PAGE_FRAME`: the header and the page share one width, so their edges line up. */
export const PAGE_FRAME = "mx-auto w-full max-w-page px-4 sm:px-6 lg:px-8";

/** The kit's `AppHeader` row: one row on a tablet or desktop; on a phone the name and the avatar, then the places under them. */
export const HEADER_ROW = "flex min-h-16 flex-wrap items-center gap-x-6 gap-y-1 py-2 max-sm:gap-x-3";

/** The app's name, linking home: cut short when long, and on a phone it takes the row beside the avatar. */
export const HOME_LINK =
  "flex min-h-11 min-w-0 shrink items-center font-display text-lg font-semibold text-ink hover:text-primary max-sm:flex-1 max-sm:basis-0";

/** The places to go: one line that scrolls sideways when they do not fit, never wrapping; under the name on a phone. */
export const NAV = "flex min-w-0 flex-nowrap items-center gap-1 overflow-x-auto max-sm:order-last max-sm:-mx-2 max-sm:w-full";

/** A place in the navigation (`NavItem`); the current one (`aria-current="page"`) drawn as chosen. */
export function navItemClass(current: boolean): string {
  return cn(
    "inline-flex min-h-11 shrink-0 items-center rounded-sm px-3 text-sm font-semibold text-ink-muted hover:bg-ground hover:text-ink",
    current && "bg-primary-tint text-primary-hover",
  );
}

export const AVATAR = "flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-tint font-semibold text-primary-hover";

export function initial(name: string): string {
  const first = name.trim().codePointAt(0);
  return first === undefined ? "?" : String.fromCodePoint(first).toUpperCase();
}

/** The menu's "Sign out": a whole row, a 44px target. */
export const MENU_ROW = "flex min-h-11 items-center rounded-sm px-3 font-semibold text-ink hover:bg-ground";

// ---------------------------------------------------------------------------------------------
// A form's errors (`ui/form.tsx`: `useFormErrors`)
// ---------------------------------------------------------------------------------------------

/** A form's errors by field: the field's name (the API's, in any case — `Title` or `title`) and its messages. */
export type FieldErrors = Record<string, readonly string[] | undefined>;

const errorKey = (field: string) => field.toLowerCase();

/**
 * The kit's `useFormErrors`, reproduced: errors shown beside each field and cleared field by field as the person changes
 * them (matched by the control's `name`, in any case); on a failed submit the focus goes to the first field marked wrong.
 */
export function useFormErrors() {
  const ref = React.useRef<HTMLFormElement | null>(null);
  const [errors, setErrors] = React.useState<Record<string, string[]>>({});
  const [focusRequest, setFocusRequest] = React.useState(0);

  React.useEffect(() => {
    if (focusRequest === 0) return;
    ref.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [focusRequest]);

  const show = React.useCallback((next: FieldErrors) => {
    const kept: Record<string, string[]> = {};
    for (const [field, messages] of Object.entries(next)) {
      const said = (messages ?? []).filter((m) => m.trim() !== "");
      if (said.length > 0) kept[errorKey(field)] = [...said];
    }
    setErrors(kept);
    const any = Object.keys(kept).length > 0;
    if (any) setFocusRequest((n) => n + 1);
    return any;
  }, []);

  const clear = React.useCallback((field: string) => {
    setErrors((now) => (errorKey(field) in now ? Object.fromEntries(Object.entries(now).filter(([name]) => name !== errorKey(field))) : now));
  }, []);

  const onChange = React.useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      const target = event.target as Partial<HTMLInputElement>;
      if (typeof target.name === "string" && target.name !== "") clear(target.name);
    },
    [clear],
  );

  return {
    formProps: { ref, onChange, noValidate: true as const },
    error: (field: string) => errors[errorKey(field)]?.[0],
    hasErrors: Object.keys(errors).length > 0,
    show,
    clear,
  };
}
