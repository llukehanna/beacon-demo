import { describe, expect, it } from "vitest";
import { insertObject } from "../db/repo.js";
import { createTestDb } from "../testing.js";
import { MAX_LIST, MAX_STRING, resolveParams } from "./params.js";

describe("resolveParams", () => {
  it("resolves object references and accepts nullable gaps", async () => {
    const db = await createTestDb();
    await insertObject(db, "Firm", { firmId: "f1", firmName: "A" });
    const out = await resolveParams(
      db,
      { firm: { type: { object: "Firm" } }, note: { type: "string", nullable: true } },
      { firm: "f1" },
    );
    expect((out.firm as { firmName: string }).firmName).toBe("A");
    expect(out.note).toBeUndefined();
  });

  it("rejects missing, mistyped, unknown, and dangling parameters", async () => {
    const db = await createTestDb();
    const spec = {
      n: { type: "integer" as const },
      tags: { type: "string[]" as const, nullable: true },
    };
    await expect(resolveParams(db, spec, {})).rejects.toThrow(/Missing required parameter "n"/);
    await expect(resolveParams(db, spec, { n: 1.5 })).rejects.toThrow(/"n" must be an integer/);
    await expect(resolveParams(db, spec, { n: 1, tags: [1] })).rejects.toThrow(
      /"tags" must be a list of strings/,
    );
    await expect(resolveParams(db, spec, { n: 1, extra: true })).rejects.toThrow(
      /Unknown parameter "extra"/,
    );
    await expect(
      resolveParams(db, { firm: { type: { object: "Firm" } } }, { firm: "ghost" }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("bounds strings and lists", async () => {
    const db = await createTestDb();
    const spec = {
      note: { type: "string" as const, nullable: true },
      names: { type: "string[]" as const, nullable: true },
    };
    await expect(resolveParams(db, spec, { note: "x".repeat(MAX_STRING + 1) })).rejects.toThrow(
      /longer than/,
    );
    await expect(
      resolveParams(db, spec, { names: Array.from({ length: MAX_LIST + 1 }, (_, i) => `n${i}`) }),
    ).rejects.toThrow(/at most/);
    await expect(resolveParams(db, spec, { names: ["y".repeat(500)] })).rejects.toThrow(/at most/);
  });

  it("normalizes timestamps to ISO and rejects unparseable ones", async () => {
    const db = await createTestDb();
    const spec = { at: { type: "timestamp" as const } };
    expect(await resolveParams(db, spec, { at: "2026-09-22T12:00:00+02:00" })).toEqual({
      at: "2026-09-22T10:00:00.000Z",
    });
    await expect(resolveParams(db, spec, { at: "last tuesday" })).rejects.toThrow(/ISO timestamp/);
    await expect(resolveParams(db, spec, { at: 1758535200000 })).rejects.toThrow(/ISO timestamp/);
  });
});
