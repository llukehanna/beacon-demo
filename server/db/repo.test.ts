import { beforeEach, describe, expect, it } from "vitest";
import { HttpError } from "../errors.js";
import { createTestDb } from "../testing.js";
import type { Db } from "./client.js";
import { claimDailyQuota, claimWindow, getMeta, setMeta } from "./meta.js";
import {
  getObject,
  insertObject,
  insertObjects,
  listLinked,
  listObjects,
  updateObject,
} from "./repo.js";

let db: Db;
beforeEach(async () => {
  db = await createTestDb();
});

describe("repository", () => {
  it("round-trips arrays and timestamps and omits nulls", async () => {
    await insertObject(db, "Mandate", {
      mandateId: "m1",
      title: "T",
      geographies: ["Europe"],
      createdAt: "2026-09-01T12:00:00.000Z",
      priority: null,
    });
    const m = await getObject(db, "Mandate", "m1");
    expect(m).toMatchObject({
      $apiName: "Mandate",
      $primaryKey: "m1",
      title: "T",
      geographies: ["Europe"],
      createdAt: "2026-09-01T12:00:00.000Z",
    });
    expect(m && "priority" in m).toBe(false);
  });

  it("rejects properties the schema does not declare", async () => {
    await expect(
      insertObject(db, "Mandate", { mandateId: "m1", colour: "red" } as never),
    ).rejects.toThrow(/Unknown property "colour"/);
  });

  it("updates, clears with null, and 404s on a missing row", async () => {
    await insertObject(db, "Firm", { firmId: "f1", firmName: "A", disposition: "x" });
    await updateObject(db, "Firm", "f1", { firmName: "B", disposition: null });
    const f = await getObject(db, "Firm", "f1");
    expect(f?.firmName).toBe("B");
    expect(f?.disposition).toBeUndefined();
    await expect(updateObject(db, "Firm", "nope", { firmName: "C" })).rejects.toMatchObject({
      status: 404,
    });
  });

  it("filters with $eq and orders by a property", async () => {
    await insertObject(db, "Firm", { firmId: "a", firmName: "Zed", firmType: "CF" });
    await insertObject(db, "Firm", { firmId: "b", firmName: "Amy", firmType: "CF" });
    await insertObject(db, "Firm", { firmId: "c", firmName: "Cat", firmType: "CS" });
    const rows = await listObjects(db, "Firm", {
      where: { firmType: { $eq: "CF" } },
      orderBy: { firmName: "asc" },
    });
    expect(rows.map((r) => r.firmName)).toEqual(["Amy", "Zed"]);
  });

  it("refuses unsupported filters and unknown sort keys", async () => {
    await expect(
      listObjects(db, "Firm", { where: { firmType: { $gt: "A" } as never } }),
    ).rejects.toBeInstanceOf(HttpError);
    await expect(listObjects(db, "Firm", { orderBy: { nope: "asc" } })).rejects.toThrow(
      /Unknown property/,
    );
  });

  it("rejects inherited/prototype property names, not just own-property misses", async () => {
    await expect(
      listObjects(db, "Firm", { where: { constructor: { $eq: "x" } } }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      listObjects(db, "Firm", { orderBy: { toString: "asc" } as never }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("traverses a join-table link for many sources at once", async () => {
    await insertObject(db, "Firm", { firmId: "f1", firmName: "One" });
    await insertObject(db, "Firm", { firmId: "f2", firmName: "Two" });
    await db.query(
      `INSERT INTO search_list_firm ("searchId","firmId") VALUES ('L1','f1'),('L1','f2'),('L2','f2')`,
    );
    const out = await listLinked(db, "SearchList", "firms", ["L1", "L2", "L3"]);
    expect(out.L1.map((f) => f.$primaryKey)).toEqual(["f1", "f2"]);
    expect(out.L2.map((f) => f.$primaryKey)).toEqual(["f2"]);
    expect(out.L3).toEqual([]);
  });

  it("stores meta values", async () => {
    expect(await getMeta(db, "k")).toBeNull();
    await setMeta(db, "k", "v1");
    await setMeta(db, "k", "v2");
    expect(await getMeta(db, "k")).toBe("v2");
  });

  it("rolls back a failed transaction", async () => {
    await expect(
      db.transaction(async (tx) => {
        await insertObject(tx, "Firm", { firmId: "t1", firmName: "Temp" });
        throw new Error("abort");
      }),
    ).rejects.toThrow("abort");
    expect(await getObject(db, "Firm", "t1")).toBeNull();
  });
});

describe("claimWindow", () => {
  it("claims once per window", async () => {
    const db = await createTestDb();
    const t = new Date("2026-09-22T12:00:00Z");
    expect(await claimWindow(db, "w", t, 60_000)).toBe(true);
    expect(await claimWindow(db, "w", new Date(t.getTime() + 59_999), 60_000)).toBe(false);
    expect(await getMeta(db, "w")).toBe(t.toISOString());
    expect(await claimWindow(db, "w", new Date(t.getTime() + 60_000), 60_000)).toBe(true);
  });
});

describe("insertObjects", () => {
  it("inserts many rows in one statement with their types intact", async () => {
    const db = await createTestDb();
    await insertObjects(db, "Firm", [
      { firmId: "a", firmName: "A", employees: 12, geoScore: 2 },
      { firmId: "b", firmName: "B" },
    ]);
    expect(await getObject(db, "Firm", "a")).toMatchObject({
      firmName: "A",
      employees: 12,
      geoScore: 2,
    });
    expect((await getObject(db, "Firm", "b"))?.employees).toBeUndefined();
    await expect(insertObjects(db, "Firm", [{ firmName: "no pk" }])).rejects.toThrow(/missing/);
  });
});

describe("claimDailyQuota", () => {
  it("allows max units per UTC day, then resets the next day", async () => {
    const db = await createTestDb();
    const day1 = new Date("2026-09-22T08:00:00Z");
    for (let i = 0; i < 3; i++) {
      expect(await claimDailyQuota(db, "q", day1, 3)).toBe(true);
    }
    expect(await claimDailyQuota(db, "q", new Date("2026-09-22T23:59:00Z"), 3)).toBe(false);
    expect(await getMeta(db, "q")).toBe("2026-09-22:3");
    expect(await claimDailyQuota(db, "q", new Date("2026-09-23T00:01:00Z"), 3)).toBe(true);
    expect(await getMeta(db, "q")).toBe("2026-09-23:1");
    await setMeta(db, "q", "2026-09-23:garbage");
    expect(await claimDailyQuota(db, "q", new Date("2026-09-23T02:00:00Z"), 3)).toBe(true);
    expect(await getMeta(db, "q")).toBe("2026-09-23:1");
  });
});
