/**
 * A link or small control that stands on its own line (not a word inside a sentence) is a thumb's
 * size on a phone: at least the `touch` height, its words centred in it. Wider layouts draw it as
 * they always did. `phone:` is the console's own phone layout (`useViewport`), upright or on its side.
 */
export const TAP = "phone:inline-flex phone:min-h-touch phone:items-center";

/** The same for a link that is one line cut short with an ellipsis (a name in a table's row). */
export const TAP_LINE = "phone:block phone:truncate phone:leading-touch";
