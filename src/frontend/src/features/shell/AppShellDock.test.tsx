import { act, cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ME, json, renderWithStore, stubApi } from "@/test/harness";
import { useDockLayout } from "../conversation/dockLayout";
import { AppShell } from "./AppShell";

beforeEach(() => {
  stubApi({ "GET /api/me": json(ME), "GET /api/tree": json({ generatedAt: "t", viewerRole: "owner", organisation: null, divisions: [], needsYou: [] }) });
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

function Collapse() {
  const dock = useDockLayout();
  return (
    <button type="button" onClick={() => dock?.setCollapsed(true)}>
      Collapse
    </button>
  );
}

/** The docked conversation beside a page that also has side cards (ARCH-012): nothing overlaps, nothing is squeezed. */
describe("the docked pane and a page's side cards", () => {
  it("keeps the cards in the page column, beside the page only from 3xl while the pane is open", async () => {
    renderWithStore(
      <AppShell crumbs={[]} aside={<section>Side card</section>} talk={{ label: "Talk to Acme", content: <Collapse /> }}>
        <p>The page</p>
      </AppShell>,
    );
    const pane = await screen.findByRole("complementary", { name: "Conversation pane" });
    const column = document.querySelector("[data-page-column]") as HTMLElement;
    const cards = screen.getByRole("complementary", { name: "Beside this page" });
    expect(column.contains(cards)).toBe(true);
    expect(column.contains(pane)).toBe(false);
    expect(column.className).toContain("3xl:flex-row");
    expect(column.className).not.toContain("lg:flex-row");
    expect(cards.className).toContain("3xl:w-aside-wide");
    // Collapsed to its rail, the pane leaves the page room for its cards beside it from lg, as on any page.
    act(() => screen.getByRole("button", { name: "Collapse" }).click());
    expect(column.className).toContain("lg:flex-row");
    expect(pane.dataset.dock).toBe("collapsed");
  });
});
