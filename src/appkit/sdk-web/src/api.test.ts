import { afterEach, describe, expect, it, vi } from "vitest";
import { api, apiUrl } from "./api.js";
import { ApiError, BudgetExhaustedError, NetworkError, NotFoundError, NotSignedInError, ValidationError } from "./errors.js";
import { jsonResponse, setBase } from "./testing.js";

afterEach(() => setBase("http://localhost/"));

describe("apiUrl", () => {
  it("resolves against the page's base under a path prefix", () => {
    setBase("https://endgame.frostaura.net/acme/labs/demo/");
    expect(apiUrl("notes/42")).toBe("https://endgame.frostaura.net/acme/labs/demo/api/notes/42");
  });

  it("resolves against the page's base at a subdomain root", () => {
    setBase("https://acme.frostaura.net/");
    expect(apiUrl("notes?sort=new")).toBe("https://acme.frostaura.net/api/notes?sort=new");
  });

  it("refuses a leading slash, with the fix", () => {
    expect(() => apiUrl("/notes")).toThrow('drop the leading slash — write api("notes")');
  });

  it("refuses other hosts and a doubled api/ prefix", () => {
    expect(() => apiUrl("https://evil.example/x")).toThrow("this app's own API only");
    expect(() => apiUrl("//evil.example/x")).toThrow("this app's own API only");
    expect(() => apiUrl("api/notes")).toThrow('write api("notes")');
  });
});

describe("api", () => {
  it("sends JSON and returns the parsed body", async () => {
    setBase("http://localhost/acme/labs/demo/");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(201, { id: 7 }));
    await expect(api<{ id: number }>("notes", { method: "POST", body: { title: "Hi" } })).resolves.toEqual({ id: 7 });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("http://localhost/acme/labs/demo/api/notes");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe('{"title":"Hi"}');
    expect((init?.headers as Record<string, string>)["content-type"]).toBe("application/json");
  });

  it("returns undefined for 204", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(204, null));
    await expect(api("notes/1", { method: "DELETE" })).resolves.toBeUndefined();
  });

  it.each([
    [400, ValidationError],
    [401, NotSignedInError],
    [402, BudgetExhaustedError],
    [404, NotFoundError],
    [500, ApiError],
  ])("throws a typed error for %i", async (status, type) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(status, { title: "No", detail: "Because", status }));
    const error = await api("notes").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(type);
    expect((error as ApiError).status).toBe(status);
    expect((error as ApiError).message).toBe("Because");
  });

  it("carries field errors and the sign-in address", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse(400, { errors: { Title: ["The Title field is required."] } }));
    const invalid = (await api("notes").catch((e: unknown) => e)) as ValidationError;
    expect(invalid.errors).toEqual({ Title: ["The Title field is required."] });

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse(401, { signInUrl: "/acme/labs/demo/_endgame/auth/sign-in?returnTo=%2F" }));
    const signedOut = (await api("notes").catch((e: unknown) => e)) as NotSignedInError;
    expect(signedOut.signInUrl).toBe("/acme/labs/demo/_endgame/auth/sign-in?returnTo=%2F");
  });

  it("turns no answer at all into a NetworkError, not an empty result", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(api("notes")).rejects.toBeInstanceOf(NetworkError);
  });

  it("survives a failure body that is not JSON", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("<html>Bad gateway</html>", { status: 502, statusText: "Bad Gateway" }));
    const error = (await api("notes").catch((e: unknown) => e)) as ApiError;
    expect(error.status).toBe(502);
    expect(error.message).toBe("Bad Gateway");
  });
});
