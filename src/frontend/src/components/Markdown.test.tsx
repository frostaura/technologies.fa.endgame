import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Markdown } from "./Markdown";

afterEach(cleanup);

describe("Markdown", () => {
  it("draws a reply's marks as formatting, never as asterisks or backticks (D9)", () => {
    const { container } = render(<Markdown text={"You run **1 app**: the **Club Reading List** (`book-club/web`).\n\n- one\n- two"} />);
    expect(container.textContent).not.toMatch(/[*`]/);
    expect(screen.getByText("1 app").tagName).toBe("STRONG");
    expect(screen.getByText("book-club/web").tagName).toBe("CODE");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("prints HTML in a reply as the characters it is", () => {
    const { container } = render(<Markdown text={'<img src=x onerror="alert(1)"> <script>bad()</script>'} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain("<script>bad()</script>");
  });

  it("opens an outside link in a new tab and keeps a console link in place", () => {
    render(<Markdown text="[Docs](https://example.com) and [Credits](/credits)" />);
    expect(screen.getByRole("link", { name: "Docs" }).getAttribute("target")).toBe("_blank");
    expect(screen.getByRole("link", { name: "Credits" }).getAttribute("target")).toBeNull();
  });
});
