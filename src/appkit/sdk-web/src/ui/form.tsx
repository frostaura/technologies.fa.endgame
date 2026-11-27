import * as React from "react";

/** A form's errors by field: the field's name (the API's, in any case — `Title` or `title`) and its messages. */
export type FieldErrors = Record<string, readonly string[] | undefined>;

export interface FormErrors {
  /** Spread on the `<form>`: it clears a field's error as soon as the person changes that field, and turns off the browser's own bubbles. */
  formProps: {
    ref: React.RefObject<HTMLFormElement | null>;
    onChange: (event: React.FormEvent<HTMLFormElement>) => void;
    noValidate: true;
  };
  /** The first message for a field, or `undefined` when it is fine. The name is matched in any case. */
  error: (field: string) => string | undefined;
  /** True while any field is marked wrong. */
  hasErrors: boolean;
  /**
   * Shows these errors (replacing the last ones) and, if there are any, moves the focus to the first field marked wrong.
   * Answers whether there were any, so a submit reads `if (form.show(errors)) return;`.
   */
  show: (errors: FieldErrors) => boolean;
  /** Clears one field's error — for a control without a `name`, which the form cannot match on its own. */
  clear: (field: string) => void;
}

const key = (field: string) => field.toLowerCase();

function cleaned(errors: FieldErrors): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [field, messages] of Object.entries(errors)) {
    const kept = (messages ?? []).filter((m) => m.trim() !== "");
    if (kept.length > 0) out[key(field)] = [...kept];
  }
  return out;
}

/**
 * A form's field errors, the one way: checked on submit (and by the server), shown beside each field, and **cleared field
 * by field as the person corrects them** — a field they have changed is no longer marked wrong; it is checked again on the
 * next submit. On a failed submit the focus goes to the first field marked wrong, so a keyboard or screen-reader user lands
 * on it.
 *
 * ```tsx
 * const form = useFormErrors();
 * function submit(e: FormEvent) {
 *   e.preventDefault();
 *   if (form.show({ Title: title.trim() ? [] : ["Give the dive a name."] })) return;
 *   …api(); on a ValidationError: form.show(error.errors);
 * }
 * <form {...form.formProps} onSubmit={submit}>
 *   <Field label="Name" htmlFor="title" error={form.error("title")} errorId="title-error">
 *     <Input id="title" name="title" invalid={!!form.error("title")} aria-describedby="title-error" … />
 * ```
 *
 * A field is matched by its `name`, in any case, so the server's `Title` clears when `name="title"` changes.
 */
export function useFormErrors(): FormErrors {
  const ref = React.useRef<HTMLFormElement | null>(null);
  const [errors, setErrors] = React.useState<Record<string, string[]>>({});
  const [focusRequest, setFocusRequest] = React.useState(0);

  // After the errors are on screen, the first control marked wrong (in the form's order) takes the focus.
  React.useEffect(() => {
    if (focusRequest === 0) return;
    ref.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [focusRequest]);

  const show = React.useCallback((next: FieldErrors) => {
    const kept = cleaned(next);
    setErrors(kept);
    const any = Object.keys(kept).length > 0;
    if (any) setFocusRequest((n) => n + 1);
    return any;
  }, []);

  const clear = React.useCallback((field: string) => {
    setErrors((now) => {
      if (!(key(field) in now)) return now;
      return Object.fromEntries(Object.entries(now).filter(([name]) => name !== key(field)));
    });
  }, []);

  const onChange = React.useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      const target = event.target as Partial<HTMLInputElement>;
      if (typeof target.name === "string" && target.name !== "") clear(target.name);
    },
    [clear],
  );

  return {
    formProps: { ref, onChange, noValidate: true },
    error: (field) => errors[key(field)]?.[0],
    hasErrors: Object.keys(errors).length > 0,
    show,
    clear,
  };
}
