import { fireEvent, render, screen } from "@testing-library/react";
import { useState, type FormEvent } from "react";
import { describe, expect, it } from "vitest";
import { Field, Input, Textarea } from "./field.js";
import { useFormErrors, type FieldErrors } from "./form.js";

/** A form built the kit's way: two checked fields, and what the "server" answers when they pass. */
function DiveForm({ server }: { server?: FieldErrors }) {
  const form = useFormErrors();
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  function submit(event: FormEvent) {
    event.preventDefault();
    const errors: FieldErrors = {};
    if (!name.trim()) errors.Name = ["Give the dive a name."];
    if (notes.length > 10) errors.Notes = ["Keep the notes to 10 characters."];
    if (form.show(errors)) return;
    if (server) form.show(server);
  }
  return (
    <form {...form.formProps} onSubmit={submit}>
      <Field label="Name" htmlFor="name" error={form.error("name")} errorId="name-error">
        <Input id="name" name="name" value={name} onChange={(e) => setName(e.target.value)} invalid={!!form.error("name")} aria-describedby="name-error" />
      </Field>
      <Field label="Notes" htmlFor="notes" error={form.error("notes")} errorId="notes-error">
        <Textarea id="notes" name="notes" value={notes} onChange={(e) => setNotes(e.target.value)} invalid={!!form.error("notes")} aria-describedby="notes-error" />
      </Field>
      <button type="submit">Save dive</button>
    </form>
  );
}

const field = (label: string) => screen.getByLabelText(label);
const submit = () => fireEvent.click(screen.getByRole("button", { name: "Save dive" }));

describe("a form's field errors", () => {
  it("marks each wrong field beside it and moves the focus to the first one", () => {
    render(<DiveForm />);
    fireEvent.change(field("Notes"), { target: { value: "far too many words" } });
    submit();
    expect(field("Name").getAttribute("aria-invalid")).toBe("true");
    expect(field("Notes").getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById("name-error")?.textContent).toBe("Give the dive a name.");
    expect(field("Name").getAttribute("aria-describedby")).toBe("name-error");
    expect(document.activeElement).toBe(field("Name"));
  });

  it("clears a field's error as soon as the person changes it, leaving the others", () => {
    render(<DiveForm />);
    fireEvent.change(field("Notes"), { target: { value: "far too many words" } });
    submit();
    fireEvent.change(field("Name"), { target: { value: "Reef" } });
    expect(field("Name").getAttribute("aria-invalid")).toBeNull();
    expect(field("Name").className).not.toContain("border-attention-text");
    expect(document.getElementById("name-error")).toBeNull();
    expect(field("Notes").getAttribute("aria-invalid")).toBe("true");
    expect(screen.getAllByRole("alert").map((a) => a.textContent)).toEqual(["Keep the notes to 10 characters."]);
  });

  it("checks again on the next submit, focusing what is still wrong", () => {
    render(<DiveForm />);
    fireEvent.change(field("Notes"), { target: { value: "far too many words" } });
    submit();
    fireEvent.change(field("Name"), { target: { value: "Reef" } });
    fireEvent.change(field("Notes"), { target: { value: "still far too long" } });
    expect(screen.queryAllByRole("alert")).toEqual([]);
    submit();
    expect(field("Name").getAttribute("aria-invalid")).toBeNull();
    expect(field("Notes").getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(field("Notes"));
  });

  it("shows the server's errors, matched to the field's name in any case, and clears them the same way", () => {
    render(<DiveForm server={{ Name: ["That name is taken."], Other: [] }} />);
    fireEvent.change(field("Name"), { target: { value: "Reef" } });
    submit();
    expect(document.getElementById("name-error")?.textContent).toBe("That name is taken.");
    expect(document.activeElement).toBe(field("Name"));
    fireEvent.change(field("Name"), { target: { value: "Reef two" } });
    expect(document.getElementById("name-error")).toBeNull();
  });
});
