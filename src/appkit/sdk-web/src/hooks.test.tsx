import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useApiQuery, useCurrentUser } from "./hooks.js";
import { jsonResponse } from "./testing.js";

function Probe({ path }: { path: string | null }) {
  const query = useApiQuery<string[]>(path);
  return (
    <div>
      <span data-testid="status">{query.status}</span>
      {query.status === "loaded" ? <span data-testid="count">{query.data.length}</span> : null}
      {query.status === "failed" ? <span data-testid="error">{query.error.name}</span> : null}
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
