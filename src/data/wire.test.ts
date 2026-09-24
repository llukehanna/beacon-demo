import { describe, expect, it } from "vitest";
import { normalizeError, serializeParams, toLinkMap } from "./wire";

describe("serializeParams", () => {
  it("sends objects as primary keys, drops undefined, keeps everything else", () => {
    const firm = { $apiName: "Firm", $primaryKey: "acme_us", firmName: "Acme" };
    expect(
      serializeParams({ firm, note: "x", tags: ["a"], skip: undefined, n: 0, flag: false }),
    ).toEqual({
      firm: "acme_us",
      note: "x",
      tags: ["a"],
      n: 0,
      flag: false,
    });
  });
});

describe("toLinkMap", () => {
  it("builds a Map keyed by source primary key", () => {
    const m = toLinkMap({ s1: [{ $apiName: "Firm", $primaryKey: "f1" }] });
    expect(m.get("s1")?.[0].$primaryKey).toBe("f1");
    expect(toLinkMap(undefined).size).toBe(0);
  });
});

describe("normalizeError", () => {
  it("reports 'no error' as undefined, like the OSDK hooks did", () => {
    expect(normalizeError(null)).toBeUndefined();
    const e = new Error("boom");
    expect(normalizeError(e)).toBe(e);
  });
});
