/**
 * A link or small control that stands on its own line (not a word inside a sentence) is a thumb's
 * size wherever it is worked by touch — a phone or a tablet (`touch:`): at least the `touch` height, its
 * words centred in it. A desktop worked by a mouse draws it as it always did.
 */
export const TAP = "touch:inline-flex touch:min-h-touch touch:items-center";

/** The same for a link that is one line cut short with an ellipsis (a name in a table's row). */
export const TAP_LINE = "touch:block touch:truncate touch:leading-touch";
