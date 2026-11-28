import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { PrintPage } from "./PrintPage.tsx";
import { site } from "../lib/data.ts";
import { PRINT_SHOT, printMmPerPx } from "../theme/tokens.ts";

afterEach(cleanup);

describe("the print version", () => {
  it("links the cover's code and address, and the closing code, to the live academy", () => {
    const { container } = render(<PrintPage operator={false} />);
    const links = [...container.querySelectorAll<HTMLAnchorElement>(`a[href="${site.siteUrl}"]`)];
    expect(links.some((a) => a.querySelector("[data-testid=qr]"))).toBe(true);
    expect(links.some((a) => a.textContent?.includes(site.siteUrl.replace(/^https?:\/\//, "").slice(0, 10)))).toBe(true);
    expect(links.filter((a) => a.querySelector("[data-testid=qr]")).length).toBe(2);
  });

  it("makes the bookmarks the paths and flows: the contents' copies of the path titles are not headings", () => {
    const { container } = render(<PrintPage operator={false} />);
    const h2 = [...container.querySelectorAll("h2")].map((h) => h.textContent);
    expect(h2[0]).toBe("Contents");
    // Each path title is a heading once: the section's, not the contents line's.
    for (const title of h2.slice(1, -1)) expect(h2.filter((t) => t === title)).toHaveLength(1);
    expect(container.querySelectorAll("article h3").length).toBe(container.querySelectorAll("article").length);
  });

  it("sets 'You know it worked when' as a light card with the one accent, never a tinted box", () => {
    const { container } = render(<PrintPage operator={false} />);
    const eyebrow = [...container.querySelectorAll("p")].find((p) => p.textContent === "You know it worked when");
    const card = eyebrow?.parentElement;
    expect(eyebrow?.className).toContain("text-primary");
    expect(card?.className).toContain("bg-surface");
    expect(card?.className).toContain("border");
    expect(card?.className).not.toMatch(/success|night/);
  });
});

describe("a step picture's print size", () => {
  it("prints the smallest text at the set size, never larger than the cap, never wider than the column", () => {
    const pt = (font: number, width: number) => (font * printMmPerPx(width, font) * 72) / 25.4;
    expect(pt(14, 600)).toBeCloseTo(PRINT_SHOT.smallestPt, 5);
    expect(printMmPerPx(400, 10)).toBe(PRINT_SHOT.mmPerPx);
    expect(2000 * printMmPerPx(2000, 12)).toBeLessThanOrEqual(PRINT_SHOT.columnMm + 1e-9);
  });
});
