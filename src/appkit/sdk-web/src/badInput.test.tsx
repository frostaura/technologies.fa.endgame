import { useState, type FormEvent } from "react";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { checkDateInput, checkNumberInput, formatDateTime } from "./format.js";
import { holdsUpAgainstBadInput } from "./testing.js";
import { AppErrorBoundary } from "./ui/error-boundary.js";

/**
 * R7-1: the factory's checker never touched a built app's page, so a form that blanked on a six-digit year passed. The kit's
 * `holdsUpAgainstBadInput` feeds a field the hostile-but-plausible values a browser lets through and fails unless the page
 * stays on screen and, on submit, refuses each one beside the field. These fixtures are the two pages the gate must tell
 * apart: the fragile one (the built app's own pattern) fails, the robust one passes.
 */

const LIMITS = { min: "2000-01-01T00:00", max: "2099-12-31T23:59" };

/** The built app's "Add a dive": the preview formats the raw value with Intl, which throws on a six-digit year. */
function FragileDivePage() {
  const [when, setWhen] = useState("");
  return (
    <section data-testid="page-new-dive">
      <form noValidate onSubmit={(e) => e.preventDefault()}>
        <label htmlFor="when">When</label>
        <input id="when" type="datetime-local" data-testid="dive-when" value={when} onChange={(e) => setWhen(e.target.value)} />
        <button type="submit" data-testid="save-dive">
          Save
        </button>
      </form>
      <p>{when ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(when)) : "No date yet"}</p>
    </section>
  );
}

/** The same page that does not crash, but sends whatever was typed: no field error for a date no one can mean. */
function SilentDivePage() {
  const [when, setWhen] = useState("");
  return (
    <section data-testid="page-new-dive">
      <form noValidate onSubmit={(e) => e.preventDefault()}>
        <label htmlFor="when">When</label>
        <input id="when" type="datetime-local" data-testid="dive-when" value={when} onChange={(e) => setWhen(e.target.value)} />
        <button type="submit" data-testid="save-dive">
          Save
        </button>
      </form>
      <p>{formatDateTime(when)}</p>
    </section>
  );
}

/** The page as the kit teaches it: bounded fields, checked on submit, errors beside each, formatting that never throws. */
function RobustDivePage() {
  const [values, setValues] = useState({ site: "", when: "", depth: "", buddy: "", notes: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (name: keyof typeof values) => (e: { target: { value: string } }) => setValues((v) => ({ ...v, [name]: e.target.value }));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const found: Record<string, string> = {};
    if (!values.site.trim()) found.site = "Name the dive site.";
    else if (values.site.length > 80) found.site = "Keep the site to 80 characters.";
    const when = checkDateInput(values.when, LIMITS);
    if (when.error) found.when = when.error;
    const depth = checkNumberInput(values.depth, { min: 0, max: 330 });
    if (depth.error) found.depth = depth.error;
    if (!values.buddy) found.buddy = "Choose a buddy.";
    setErrors(found);
  };
  const field = (name: string) => ({ "aria-invalid": errors[name] ? true : undefined, "aria-describedby": `${name}-error` });
  return (
    <section data-testid="page-new-dive">
      <form noValidate onSubmit={submit}>
        <input data-testid="dive-site" required aria-required="true" maxLength={80} value={values.site} onChange={set("site")} {...field("site")} />
        <p id="site-error">{errors.site}</p>
        <input type="datetime-local" data-testid="dive-when" min={LIMITS.min} max={LIMITS.max} value={values.when} onChange={set("when")} {...field("when")} />
        <p id="when-error">{errors.when}</p>
        <input type="number" data-testid="dive-depth" min={0} max={330} value={values.depth} onChange={set("depth")} {...field("depth")} />
        <p id="depth-error">{errors.depth}</p>
        <select data-testid="dive-buddy" required value={values.buddy} onChange={set("buddy")} {...field("buddy")}>
          <option value="">Choose</option>
          <option value="ada">Ada</option>
        </select>
        <p id="buddy-error">{errors.buddy}</p>
        <textarea data-testid="dive-notes" value={values.notes} onChange={set("notes")} />
        <button type="submit" data-testid="save-dive">
          Save
        </button>
      </form>
      <p>{formatDateTime(values.when, { fallback: "No date yet" })}</p>
    </section>
  );
}

const options = (page: () => React.ReactElement) => ({ render: () => render(page()), page: "page-new-dive", submit: "save-dive" });

describe("a form held to bad input", () => {
  it("fails the fragile page: a six-digit year blanks it", async () => {
    await expect(holdsUpAgainstBadInput("dive-when", options(() => <FragileDivePage />))).rejects.toThrow(/dive-when: "202612-12-12T08:00" broke the page: RangeError: Invalid time value/);
  });

  it("fails it inside the kit's boundary too: a boundary showing is a page that broke", async () => {
    const guarded = () => (
      <AppErrorBoundary>
        <FragileDivePage />
      </AppErrorBoundary>
    );
    await expect(holdsUpAgainstBadInput("dive-when", options(guarded))).rejects.toThrow(/broke the page/);
  });

  it("fails a page that stays up but never says the date is wrong", async () => {
    await expect(holdsUpAgainstBadInput("dive-when", options(() => <SilentDivePage />))).rejects.toThrow(/dive-when: "202612-12-12T08:00" was not refused beside the field/);
  });

  it.each(["dive-site", "dive-when", "dive-depth", "dive-buddy"])("passes the robust page's %s", async (field) => {
    await expect(holdsUpAgainstBadInput(field, options(() => <RobustDivePage />))).resolves.toBeUndefined();
  });

  it("feeds a free text field without limits and asks only that the page stays", async () => {
    await expect(holdsUpAgainstBadInput("dive-notes", options(() => <RobustDivePage />))).resolves.toBeUndefined();
  });

  it("says plainly when the field is not on the page", async () => {
    await expect(holdsUpAgainstBadInput("dive-nothing", options(() => <RobustDivePage />))).rejects.toThrow(/dive-nothing/);
  });
});
