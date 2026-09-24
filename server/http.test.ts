import { describe, expect, it, vi } from "vitest";
import { ActionError } from "./errors.js";
import { jsonError } from "./http.js";

const withCode = (code: string) => Object.assign(new Error("db"), { code });

describe("jsonError", () => {
  it("keeps known errors, maps Postgres data and concurrency errors, hides the rest", async () => {
    expect(jsonError(new ActionError("nope", 409)).status).toBe(409);
    expect(jsonError(withCode("22P02")).status).toBe(400);
    expect(jsonError(withCode("40P01")).status).toBe(409);
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const hidden = jsonError(withCode("XX000"));
    expect(hidden.status).toBe(500);
    expect(await hidden.json()).toEqual({ error: "Internal error" });
    expect(log).toHaveBeenCalled();
  });
});
