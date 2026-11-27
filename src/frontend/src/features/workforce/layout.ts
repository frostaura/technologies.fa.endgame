/** Layout classes shared by the workforce pages, written once. */

/** A check box with its words: the whole row is the target, a thumb's height on touch. */
export const CHECK_ROW = "flex min-h-touch cursor-pointer items-center gap-3 rounded-xs px-2 -mx-2 hover:bg-ground";
export const CHECK_BOX = "size-5 shrink-0 accent-primary";

/** A text area that grows with what is written, so it always shows whole lines, up to a screenful. */
export const GROWING = "min-h-24 max-h-96 leading-relaxed [field-sizing:content]";
