import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { appName } from "../appName.js";
import { jsonResponse, pageShapeProblems } from "../testing.js";
import { Input } from "./field.js";
import { AppHeader, CardGrid, ChecklistItem, FormActions, PageHeader, PageLayout, shortAddress } from "./layout.js";

afterEach(() => {
  vi.restoreAllMocks();
  document.head.querySelectorAll('meta[name="endgame-app-name"]').forEach((m) => m.remove());
});

describe("the app's one name", () => {
  it("is the platform's when the page carries it, and the fallback otherwise", () => {
    expect(appName("Notes")).toBe("Notes");
    const meta = document.createElement("meta");
    meta.name = "endgame-app-name";
    meta.content = "Club dives";
    document.head.append(meta);
    expect(appName("Notes")).toBe("Club dives");
  });
});

describe("the header", () => {
  it("names the app, its places and who is signed in, with the way out", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => jsonResponse(200, { user: { id: "1", email: "ada@example.test", displayName: "Ada Diver" } }));
    render(
      <AppHeader home={<a href="./">Club dives</a>}>
        <a href="trips">Trips</a>
      </AppHeader>,
    );
    expect(screen.getByRole("link", { name: "Club dives" })).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Main" }).textContent).toBe("Trips");
    expect((await screen.findByTestId("signed-in-as")).textContent).toBe("Ada Diver");
    expect(screen.getByRole("link", { name: "Sign out" })).toBeTruthy();
  });

  it("offers sign-in to a visitor", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => jsonResponse(200, { user: null }));
    render(<AppHeader home={<a href="./">Books</a>} />);
    expect(await screen.findByRole("link", { name: "Sign in" })).toBeTruthy();
  });
});

describe("a checklist row", () => {
  it("is a real check box, and the whole row ticks it", () => {
    const changed = vi.fn();
    render(
      <ul>
        <ChecklistItem id="fins" label="Fins" checked={false} onCheckedChange={changed} />
      </ul>,
    );
    const box = screen.getByRole("checkbox", { name: "Fins" });
    fireEvent.click(screen.getByText("Fins"));
    expect(changed).toHaveBeenCalledWith(true);
    expect(box.getAttribute("type")).toBe("checkbox");
  });
});

describe("a shared link is shown short", () => {
  it("drops the scheme and cuts a long token", () => {
    expect(shortAddress("http://frostaura.localhost:8095/community/trips/web/checklist/c8ff782bce661e54392dea9374ab642b")).toBe(
      "frostaura.localhost:8095/community/trips/web/checklist/c8ff78…642b",
    );
  });
});

describe("page shape", () => {
  const listPage = (narrow: boolean) => (
    <section data-testid="page-home">
      <PageHeader title="Dives" />
      <PageLayout aside={<p>4 dives</p>}>
        <div className={narrow ? "max-w-md" : undefined}>
          <CardGrid data-testid="dive-list">
            <li>One</li>
          </CardGrid>
        </div>
      </PageLayout>
    </section>
  );

  it("passes a list page that uses the width", () => {
    render(listPage(false));
    expect(pageShapeProblems(screen.getByTestId("page-home"), "list")).toEqual([]);
  });

  it("fails a list held to a narrow column, or one column at every width", () => {
    render(listPage(true));
    expect(pageShapeProblems(screen.getByTestId("page-home"), "list").join("\n")).toContain('held to 448px by "max-w-md"');
    render(
      <section data-testid="page-books">
        <h1>Books</h1>
        <ul data-testid="book-list" className="flex flex-col gap-2" />
      </section>,
    );
    expect(pageShapeProblems(screen.getByTestId("page-books"), "list").join("\n")).toContain("one column at every width");
  });

  it("fails a form with no title, no Cancel and a faint field", () => {
    render(
      <section data-testid="page-new-book">
        <form>
          <input name="title" className="border" />
          <button type="submit">Add book</button>
        </form>
      </section>,
    );
    const problems = pageShapeProblems(screen.getByTestId("page-new-book"), "form").join("\n");
    expect(problems).toContain("0 <h1> headings");
    expect(problems).toContain('no "Cancel"');
    expect(problems).toContain("The field title does not have the field edge");
  });

  it("passes a form with a title, kit fields and Cancel", async () => {
    render(
      <section data-testid="page-new-book">
        <PageHeader title="New book" />
        <form>
          <Input name="title" />
          <FormActions submit={<button type="submit">Add book</button>} cancel={<a href="./">Cancel</a>} />
        </form>
      </section>,
    );
    await waitFor(() => expect(pageShapeProblems(screen.getByTestId("page-new-book"), "form")).toEqual([]));
  });

  it("wants a way back on a detail page", () => {
    render(
      <section data-testid="page-dive">
        <PageHeader title="Aliwal Shoal" back={<a href="./">All dives</a>} />
      </section>,
    );
    expect(pageShapeProblems(screen.getByTestId("page-dive"), "detail")).toEqual([]);
  });
});
