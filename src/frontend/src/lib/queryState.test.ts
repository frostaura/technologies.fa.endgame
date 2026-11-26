import { afterEach, describe, expect, it } from "vitest";
import { describeError, setErrorMode } from "./queryState";

const failed = (status: number, detail?: string) => ({ status, data: detail ? { title: "Forbidden", status, detail } : undefined });

afterEach(() => setErrorMode("normal"));

describe("a failure in normal mode (rule 12)", () => {
  it("never ends with a status code, and keeps a plain sentence as the server wrote it", () => {
    expect(describeError(failed(403, "Only the Owner manages Admins."))).toBe("Only the Owner manages Admins.");
    expect(describeError(failed(500, "The database did not answer"))).toBe("The database did not answer.");
  });

  it("retells a role refusal without its path or the roles' wire names", () => {
    const text = describeError(failed(403, "This needs the admin role at 'frostaura/community'; you are a builder there (set at frostaura/community)."));
    expect(text).toBe("Only an Admin or the Owner can do this here. You are a Builder here.");
    expect(describeError(failed(403, "This needs the owner role at 'frostaura'; you are an admin there (set at frostaura)."))).toBe("Only the Owner can do this here. You are an Admin here.");
    expect(describeError(failed(403, "This needs the builder role at 'acme'; this access token acts as a viewer at most."))).toBe(
      "Only a Builder, an Admin or the Owner can do this here. This assistant's key acts as a Viewer at most.",
    );
  });

  it("says what a status means when the server gave no words, or words that name the machinery", () => {
    expect(describeError(failed(502))).toBe("Endgame could not be reached just now.");
    expect(describeError(failed(404, "The scope 'acme/tools' was not found, or you cannot see it."))).toBe("This was not found, or you cannot see it.");
    expect(describeError(failed(400, "The scope must be written as `org/division`."))).toBe("The request was not accepted.");
  });

  it("retells a path in a sentence as words, and keeps a quoted value", () => {
    expect(describeError(failed(409, "'acme/tools/ledger' still has children, work or credit history attached."))).toBe("This still has children, work or credit history attached.");
  });

  it("retells the delete refusal plainly and drops a bracketed wire hint (D79)", () => {
    expect(describeError(failed(409, "'acme/tools/ledger/web' still has children, work or credit history attached. Archive it instead (status: archived)."))).toBe(
      "It still has things beneath it, work or credit history. Archive it instead: it keeps everything and can be brought back.",
    );
    expect(describeError(failed(400, "Set it another way (status: paused)."))).toBe("Set it another way.");
    expect(describeError(failed(409, "'acme/tools/ledger/web' still has children, work or credit history attached. Archive it instead (status: archived)."), "technical")).toBe(
      "'acme/tools/ledger/web' still has children, work or credit history attached. Archive it instead (status: archived). (409)",
    );
    expect(describeError(failed(400, "'x' is not a model tier"))).toBe("'x' is not a model tier.");
  });
});

describe("a failure in technical mode", () => {
  it("keeps the server's detail, path and status", () => {
    setErrorMode("technical");
    expect(describeError(failed(403, "This needs the admin role at 'acme'; you are a builder there (set at acme)."))).toBe(
      "This needs the admin role at 'acme'; you are a builder there (set at acme). (403)",
    );
    expect(describeError(failed(502))).toBe("Endgame answered 502.");
  });
});
