import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { createElement } from "react";
import { placeholderWords } from "./placeholders.ts";
import { Inline } from "../components/Inline.tsx";

describe("placeholders read as what they stand for", () => {
  it("names the common ones, and de-camel-cases the rest", () => {
    expect(placeholderWords("{Org}")).toBe("your organisation’s name");
    expect(placeholderWords("{credits}")).toBe("number of credits");
    expect(placeholderWords("{Division}")).toBe("division name");
    expect(placeholderWords("{reason}")).toBe("reason");
    expect(placeholderWords("{appId}")).toBe("app id");
    expect(placeholderWords("{firstName}")).toBe("first name");
    expect(placeholderWords("{time ago}")).toBe("how long ago");
  });

  it("sets each one in a step as a variable token, never as its braces; code keeps its own", () => {
    const { container } = render(createElement(Inline, { text: "The breadcrumb shows \"{Org} › New idea\" and `GET /apps/{app}`." }));
    const tokens = [...container.querySelectorAll("var")];
    expect(tokens.map((t) => t.textContent)).toEqual(["your organisation’s name"]);
    expect(container.textContent).not.toContain("{Org}");
    expect(container.querySelector("code")?.textContent).toBe("GET /apps/{app}");
  });
});
