import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { api } from "./api.js";
import { useApiQuery, useCurrentUser } from "./hooks.js";
import { jsonResponse } from "./testing.js";

function Probe({ path, id = "" }: { path: string | null; id?: string }) {
  const query = useApiQuery<string[]>(path);
  return (
    <div>
      <span data-testid={`status${id}`}>{query.status}</span>
      {query.status === "loaded" ? <span data-testid={`count${id}`}>{query.data.length}</span> : null}
      {query.status === "failed" ? <span data-testid={`error${id}`}>{query.error.name}</span> : null}
      <button onClick={query.reload}>reload</button>
    </div>
  );
}

function Who() {
  const me = useCurrentUser();
  if (me.status === "loading") return <span>loading</span>;
  if (me.status === "failed") return <span>failed</span>;
  return <span>{me.data ? `signed in as ${me.data.email}` : "signed out"}</span>;
}

describe("useApiQuery", () => {
  it("goes loading → loaded, and an empty list is loaded, not failed", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(200, []));
    render(<Probe path="notes" />);
    expect(screen.getByTestId("status").textContent).toBe("loading");
    expect(await screen.findByTestId("count")).toHaveProperty("textContent", "0");
    expect(screen.getByTestId("status").textContent).toBe("loaded");
  });

  it("goes loading → failed on an error, and reload tries again", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse(500, { title: "Boom" }));
    render(<Probe path="notes" />);
    expect(await screen.findByTestId("error")).toHaveProperty("textContent", "ApiError");

    fetchMock.mockResolvedValueOnce(jsonResponse(200, ["a"]));
    await act(async () => screen.getByText("reload").click());
    expect(await screen.findByTestId("count")).toHaveProperty("textContent", "1");
  });

  it("waits while the path is null", () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    render(<Probe path={null} />);
    expect(screen.getByTestId("status").textContent).toBe("loading");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

/** A fetch double answering each path from a table the test changes as the "server" changes. */
function server(routes: Record<string, () => Response>) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const path = new URL(String(input)).pathname.replace(/^\/api\//, "");
    const route = routes[path];
    if (!route) throw new Error(`no route for ${path}`);
    return route();
  });
}

const reads = (fetchMock: ReturnType<typeof server>, path: string) =>
  fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith(`/api/${path}`) && (init?.method ?? "GET") === "GET").length;

describe("useApiQuery after a write", () => {
  it("re-reads every mounted query once a write through api() succeeds", async () => {
    let reading = ["a", "b"];
    let finished = ["c"];
    const fetchMock = server({
      "books/reading": () => jsonResponse(200, reading),
      "books/finished": () => jsonResponse(200, finished),
      "books/b": () => jsonResponse(200, { id: "b", status: "Finished" }),
    });
    render(
      <>
        <Probe path="books/reading" id="-reading" />
        <Probe path="books/finished" id="-finished" />
      </>,
    );
    expect(await screen.findByTestId("count-reading")).toHaveProperty("textContent", "2");
    expect(await screen.findByTestId("count-finished")).toHaveProperty("textContent", "1");

    reading = ["a"];
    finished = ["c", "b"];
    await act(() => api("books/b", { method: "PATCH", body: { status: "Finished" } }));

    await waitFor(() => expect(screen.getByTestId("count-reading").textContent).toBe("1"));
    await waitFor(() => expect(screen.getByTestId("count-finished").textContent).toBe("2"));
    expect(reads(fetchMock, "books/reading")).toBe(2);
    expect(reads(fetchMock, "books/finished")).toBe(2);
  });

  it("keeps the current data on screen while it re-reads — no flash to loading", async () => {
    let answer: (r: Response) => void = () => {};
    let calls = 0;
    server({
      "books/reading": () => (++calls === 1 ? jsonResponse(200, ["a", "b"]) : (new Promise((resolve) => (answer = resolve)) as unknown as Response)),
      "books/b": () => jsonResponse(204, null),
    });
    render(<Probe path="books/reading" />);
    expect(await screen.findByTestId("count")).toHaveProperty("textContent", "2");

    await act(() => api("books/b", { method: "DELETE" }));
    await waitFor(() => expect(calls).toBe(2));
    expect(screen.getByTestId("status").textContent).toBe("loaded");
    expect(screen.getByTestId("count").textContent).toBe("2");

    await act(async () => answer(jsonResponse(200, ["a"])));
    await waitFor(() => expect(screen.getByTestId("count").textContent).toBe("1"));
  });

  it("shows a failed re-read as failed, never the old data", async () => {
    let healthy = true;
    server({
      "books/reading": () => (healthy ? jsonResponse(200, ["a"]) : jsonResponse(500, { title: "Boom" })),
      "books/a": () => jsonResponse(200, { id: "a" }),
    });
    render(<Probe path="books/reading" />);
    expect(await screen.findByTestId("count")).toHaveProperty("textContent", "1");

    healthy = false;
    await act(() => api("books/a", { method: "PUT", body: {} }));
    expect(await screen.findByTestId("error")).toHaveProperty("textContent", "ApiError");
    expect(screen.queryByTestId("count")).toBeNull();
  });

  it("does not re-read after a read, or after a write that failed", async () => {
    const fetchMock = server({
      "books/reading": () => jsonResponse(200, ["a"]),
      "books/other": () => jsonResponse(200, []),
      "books/a": () => jsonResponse(400, { title: "Invalid", errors: { Status: ["Unknown status."] } }),
    });
    render(<Probe path="books/reading" />);
    expect(await screen.findByTestId("count")).toHaveProperty("textContent", "1");

    await act(() => api("books/other"));
    await act(() => api("books/a", { method: "PATCH", body: {} }).catch(() => undefined));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(reads(fetchMock, "books/reading")).toBe(1);
  });
});

describe("useCurrentUser", () => {
  it("is loaded with null when nobody is signed in", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(200, { user: null }));
    render(<Who />);
    expect(await screen.findByText("signed out")).toBeTruthy();
  });

  it("is the user when signed in", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(200, { user: { id: "usr_1", email: "ada@example.test", displayName: "Ada", kind: "endUser", role: null } }),
    );
    render(<Who />);
    expect(await screen.findByText("signed in as ada@example.test")).toBeTruthy();
  });

  it("is failed, not signed out, when the app cannot say", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
    render(<Who />);
    expect(await screen.findByText("failed")).toBeTruthy();
  });
});
