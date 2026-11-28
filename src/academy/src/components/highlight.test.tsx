import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { highlight } from "./highlight.tsx";
import { Inline } from "./Inline.tsx";

afterEach(cleanup);

describe("search highlighting", () => {
  it("marks every match of a term, whatever its case, and leaves the rest as text", () => {
    const { container } = render(<p>{highlight("Add a Passkey, then another passkey", ["passkey"])}</p>);
    expect([...container.querySelectorAll("mark")].map((m) => m.textContent)).toEqual(["Passkey", "passkey"]);
    expect(container.textContent).toBe("Add a Passkey, then another passkey");
  });

  it("ignores terms too short to mean anything, and characters a pattern would read as syntax", () => {
    const { container } = render(<p>{highlight("a (b) in c", ["in", "(b)"])}</p>);
    expect([...container.querySelectorAll("mark")].map((m) => m.textContent)).toEqual(["(b)"]);
  });

  it("marks inside a flow's inline markup, and a placeholder reads as words, not a token", () => {
    const { container } = render(<p><Inline text={"**Sign in** as {Org} with a passkey"} mark={["passkey"]} /></p>);
    expect(container.querySelector("mark")?.textContent).toBe("passkey");
    const v = container.querySelector("var");
    expect(v?.textContent).toBe("your organisation’s name");
    expect(v?.className).toMatch(/\bitalic\b/);
    expect(v?.className.split(" ").filter((c) => c === "border" || c.startsWith("bg-") || c.startsWith("rounded"))).toEqual([]);
  });
});
