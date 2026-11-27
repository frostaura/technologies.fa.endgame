import { Fragment } from "react";

/** An address that may wrap only after a dot or a slash, never inside a word; it reads (and copies) as one string. */
export function Breakable({ text }: { text: string }) {
  const parts = text.split(/(?<=[./])/);
  return <>{parts.map((p, i) => <Fragment key={i}>{p}{i < parts.length - 1 && <wbr />}</Fragment>)}</>;
}
