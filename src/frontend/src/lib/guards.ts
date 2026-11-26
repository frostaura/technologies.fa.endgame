/**
 * Runtime guards at the API boundary. Every answer the control plane sends is checked against the
 * shape the screen will read before it reaches the store, so an unexpected shape becomes a failed
 * read with a plain reason — never a crash deep inside a component (`t.existing.map is not a
 * function` once blanked the verdict page).
 *
 * A guard either returns the value (fields it does not know are kept) or throws a {@link ShapeError}
 * naming the path that was wrong. Fields the control plane added later can carry a default, so an
 * older stack still reads.
 */

export class ShapeError extends Error {
  readonly path: string;
  readonly expected: string;
  constructor(path: string, expected: string, got: unknown) {
    super(`${path || "the answer"} should be ${expected}, but was ${describe(got)}`);
    this.name = "ShapeError";
    this.path = path;
    this.expected = expected;
  }
}

function describe(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "a list";
  if (typeof v === "object") return "an object";
  if (typeof v === "string") return v.length > 40 ? "a long text" : `"${v}"`;
  return String(v);
}

export type Guard<T> = (value: unknown, path: string) => T;

const at = (path: string, key: string | number) => (typeof key === "number" ? `${path}[${key}]` : path ? `${path}.${key}` : key);

export const str: Guard<string> = (v, path) => {
  if (typeof v !== "string") throw new ShapeError(path, "text", v);
  return v;
};

export const num: Guard<number> = (v, path) => {
  if (typeof v !== "number" || !Number.isFinite(v)) throw new ShapeError(path, "a number", v);
  return v;
};

export const bool: Guard<boolean> = (v, path) => {
  if (typeof v !== "boolean") throw new ShapeError(path, "true or false", v);
  return v;
};

/** Anything at all — for payloads the screen reads defensively itself. */
export const unknownValue: Guard<unknown> = (v) => v;

/** A JSON object whose fields are read defensively later. */
export const record: Guard<Record<string, unknown>> = (v, path) => {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new ShapeError(path, "an object", v);
  return v as Record<string, unknown>;
};

export function nullable<T>(guard: Guard<T>): Guard<T | null> {
  return (v, path) => (v === null || v === undefined ? null : guard(v, path));
}

/** A field an older control plane may not send yet: absent reads as the fallback. */
export function withDefault<T>(guard: Guard<T>, fallback: T): Guard<T> {
  return (v, path) => (v === undefined ? fallback : guard(v, path));
}

/** A field whose absence means something (an older control plane): absent stays undefined, unlike withDefault. */
export function optional<T>(guard: Guard<T>): Guard<T | undefined> {
  return (v, path) => (v === undefined ? undefined : guard(v, path));
}

export function oneOf<const T extends string>(values: readonly T[]): Guard<T> {
  return (v, path) => {
    if (typeof v !== "string" || !(values as readonly string[]).includes(v)) throw new ShapeError(path, `one of ${values.join(", ")}`, v);
    return v as T;
  };
}

export function arr<T>(guard: Guard<T>): Guard<T[]> {
  return (v, path) => {
    if (!Array.isArray(v)) throw new ShapeError(path, "a list", v);
    return v.map((item, i) => guard(item, at(path, i)));
  };
}

/** A map of string keys to one kind of value. */
export function dict<T>(guard: Guard<T>): Guard<Record<string, T>> {
  return (v, path) => {
    const o = record(v, path);
    return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, guard(x, at(path, k))]));
  };
}

/** An object with these fields checked; any other fields are kept as they came. */
export function obj<T extends object>(shape: { [K in keyof T]-?: Guard<T[K]> }): Guard<T> {
  return (v, path) => {
    const o = record(v, path);
    const out: Record<string, unknown> = { ...o };
    for (const key of Object.keys(shape) as (keyof T & string)[]) out[key] = shape[key](o[key], at(path, key));
    return out as T;
  };
}

/** Two shapes accepted for the same field (an older and a newer control plane). */
export function either<A, B>(a: Guard<A>, b: Guard<B>): Guard<A | B> {
  return (v, path) => {
    try {
      return a(v, path);
    } catch (first) {
      try {
        return b(v, path);
      } catch {
        throw first;
      }
    }
  };
}

export type Checked<T> = { ok: true; value: T } | { ok: false; problem: string };

export function check<T>(guard: Guard<T>, value: unknown): Checked<T> {
  try {
    return { ok: true, value: guard(value, "") };
  } catch (e) {
    if (e instanceof ShapeError) return { ok: false, problem: e.message };
    return { ok: false, problem: e instanceof Error ? e.message : "it could not be read" };
  }
}
