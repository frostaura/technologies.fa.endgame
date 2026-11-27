/**
 * Shared layout classes, so a pattern is written once.
 *
 * `SCROLL_ROW`: a row of chips or links that wraps on a tablet or a desktop and, on a phone, stays
 * one line that scrolls sideways to the screen's edges (momentum, no bar, nothing jacked).
 */
export const SCROLL_ROW = "no-scrollbar flex flex-wrap gap-2 max-sm:-mx-4 max-sm:flex-nowrap max-sm:overflow-x-auto max-sm:px-4";

/**
 * The one link style (ARCH-011): the link colour, medium weight, underlined (so a link in a sentence is told
 * apart by more than colour), darker on hover. A breadcrumb's steps and a nav's rows are navigation, not links
 * in text, and keep their own look.
 */
export const LINK = "font-medium text-primary-link underline decoration-primary-link/40 underline-offset-2 hover:text-primary-hover hover:decoration-current";

/** The same link standing on its own (not a word in a sentence): a thumb's height wherever it is worked by touch. */
export const LINK_ALONE = `${LINK} touch:inline-flex touch:min-h-touch touch:items-center`;

/**
 * The one menu and popover look (ARCH-011): a defined edge, a clear lift, inner padding, 8px off its trigger,
 * at most `max-h-popover` tall and scrolling inside — its items are whole rows, so it never ends half-way
 * through one. Items are `MENU_ITEM`.
 */
export const MENU = "z-40 mt-2 flex [&[hidden]]:hidden max-h-popover min-w-48 flex-col overflow-y-auto overscroll-contain rounded-md border border-border-strong bg-surface p-1.5 shadow-menu";
export const MENU_ITEM = "flex min-h-10 w-full shrink-0 items-center gap-2 rounded-xs px-3 text-left text-sm text-ink hover:bg-ground touch:min-h-touch";
