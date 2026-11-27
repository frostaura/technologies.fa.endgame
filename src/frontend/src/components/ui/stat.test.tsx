import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Bar } from "../states";
import { Button } from "./button";
import { Stat, StatRow } from "./stat";

afterEach(cleanup);

describe("a figure's caption", () => {
  it("is one line with its whole text in the tooltip from sm up, and wraps on a phone", () => {
    render(<Stat label="This month" value="188" caption="188 of 1,500 this month" />);
    const caption = screen.getByText("188 of 1,500 this month");
    expect(caption.getAttribute("title")).toBe("188 of 1,500 this month");
    const classes = caption.className.split(/\s+/);
    expect(classes).toContain("sm:truncate");
    expect(classes).not.toContain("truncate");
  });

  it("is the tile's last slot, so a caption that wraps moves nothing above it", () => {
    render(
      <StatRow cols={2} meters>
        <Stat label="Spent" value="188" caption="188 of 1,500 this month, a long line" meter={{ value: 12.5, label: "12.5% of the budget" }} />
        <Stat label="Left" value="1,312" caption="Short" />
      </StatRow>,
    );
    for (const tile of screen.getAllByText(/^(Spent|Left)$/).map((l) => l.parentElement as HTMLElement)) {
      const slots = [...tile.children];
      expect(slots.at(-1)?.hasAttribute("data-stat-caption")).toBe(true);
      // Label, value, the meter's reserved place, caption: the same slots in the same order in every tile.
      expect(slots).toHaveLength(4);
    }
  });
});

describe("a meter and a bar", () => {
  it("are drawn at their real width on the first render, never grown in from zero", () => {
    render(<Stat label="Spent" value="188" meter={{ value: 37.5, label: "37.5% of the budget" }} />);
    const fill = screen.getByRole("img", { name: "37.5% of the budget" }).firstElementChild as HTMLElement;
    expect(fill.style.width).toBe("37.5%");
    expect(fill.className).not.toMatch(/\banimate-/);
    expect(fill.className).toContain("motion-reduce:transition-none");
  });

  it("clamp to the track", () => {
    render(<Bar value={140} label="Over" />);
    const fill = screen.getByRole("img", { name: "Over" }).firstElementChild as HTMLElement;
    expect(fill.style.width).toBe("100%");
    expect(fill.className).not.toMatch(/\banimate-grow\b/);
  });

  it("carry the moving stripe only while work is live", () => {
    render(<Bar value={40} label="Live" live />);
    expect((screen.getByRole("img", { name: "Live" }).firstElementChild as HTMLElement).className).toContain("animate-sheen");
  });
});

describe("a button", () => {
  it("is capped at its column measured with its own margins, so a negative margin never cuts its words", () => {
    render(
      <Button variant="quiet" size="sm" className="-mr-2">
        Mark read
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Mark read" });
    expect(button.className).toContain("max-w-column");
    expect(button.className).not.toContain("max-w-full");
    expect(button.className).toContain("-mr-2");
  });
});
