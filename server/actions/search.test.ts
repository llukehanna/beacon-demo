import { describe, expect, it } from "vitest";
import type { ObjectOf } from "../../shared/schema.js";
import type { Db } from "../db/client.js";
import { listLinked, listObjects } from "../db/repo.js";
import { STRONG_CF, createTestDb, run, seedFirm } from "../testing.js";
import { MAX_MANDATES } from "./search.js";

async function universe(db: Db) {
  await seedFirm(db, {
    firmId: "us_sw_a",
    firmName: "Alpha",
    hqCountry: "United States",
    sector: "Software",
    ...STRONG_CF,
  });
  await seedFirm(db, {
    firmId: "us_sw_b",
    firmName: "Bravo",
    hqCountry: "United States",
    sector: "Software",
  });
  await seedFirm(db, {
    firmId: "de_sw",
    firmName: "Delta",
    hqCountry: "Germany",
    sector: "Software",
  });
  await seedFirm(db, {
    firmId: "us_retail",
    firmName: "Echo",
    hqCountry: "United States",
    sector: "Retail",
  });
  await seedFirm(db, {
    firmId: "us_cs",
    firmName: "Foxtrot",
    hqCountry: "United States",
    sector: "Software",
    firmType: "CS",
  });
  await seedFirm(db, {
    firmId: "us_rej",
    firmName: "Golf",
    hqCountry: "United States",
    sector: "Software",
    lifecycleState: "Rejected",
  });
}

describe("runMandateSearch", () => {
  it("creates a mandate and its candidate universe by archetype and geography", async () => {
    const db = await createTestDb();
    await universe(db);
    await run(db, "runMandateSearch", {
      title: "US software boutiques",
      archetype: "CF",
      geographies: ["Americas"],
    });
    const [m] = await listObjects(db, "Mandate");
    expect(m).toMatchObject({
      title: "US software boutiques",
      archetype: "CF",
      active: true,
      geographies: ["Americas"],
    });
    const [list] = await listObjects(db, "SearchList");
    const members = (await listLinked(db, "SearchList", "firms", [list.$primaryKey]))[
      list.$primaryKey
    ];
    expect(members.map((f) => f.$primaryKey).sort()).toEqual(["us_retail", "us_sw_a", "us_sw_b"]);
    expect(list.resultCount).toBe(3);
  });

  it("validates archetype and geography values", async () => {
    const db = await createTestDb();
    await expect(run(db, "runMandateSearch", { title: "x", archetype: "PE" })).rejects.toThrow(
      /CF or CS/,
    );
    await expect(
      run(db, "runMandateSearch", { title: "x", archetype: "CF", geographies: ["Atlantis"] }),
    ).rejects.toThrow(/Atlantis/);
  });
});

describe("demo row ceilings", () => {
  it("refuses new mandates once the demo is full", async () => {
    const db = await createTestDb();
    for (let i = 0; i < MAX_MANDATES; i++) {
      await db.query(`INSERT INTO mandate ("mandateId", title) VALUES ($1, 'M')`, [`m${i}`]);
    }
    await expect(
      run(db, "runMandateSearch", { title: "One more", archetype: "CF" }),
    ).rejects.toMatchObject({ status: 409 });
  });
});

describe("runSearch", () => {
  it("snapshots params and attaches matching firms ranked by score", async () => {
    const db = await createTestDb();
    await universe(db);
    await run(db, "runMandateSearch", { title: "M", archetype: "CF" });
    const [m] = await listObjects(db, "Mandate");
    await run(db, "runSearch", {
      mandate: m.$primaryKey,
      geographies: ["United States"],
      industries: ["Software"],
      breadth: "exhaustive",
    });
    const [s] = await listObjects(db, "Search");
    expect(s).toMatchObject({
      mandateId: m.$primaryKey,
      status: "complete",
      resultCount: 2,
      runBy: "demo-analyst",
    });
    const members = (await listLinked(db, "Search", "firms", [s.$primaryKey]))[s.$primaryKey];
    expect(members.map((f) => f.$primaryKey).sort()).toEqual(["us_sw_a", "us_sw_b"]);
  });

  it("honors exclusions and creates unknown seed firms with discovery provenance", async () => {
    const db = await createTestDb();
    await universe(db);
    await run(db, "runMandateSearch", { title: "M", archetype: "CF" });
    const [m] = await listObjects(db, "Mandate");
    await run(db, "runSearch", {
      mandate: m.$primaryKey,
      industries: ["Software"],
      exclusions: ["Bravo"],
      seedFirms: ["Hotel Advisors"],
    });
    const [s] = await listObjects(db, "Search");
    const ids = (
      (await listLinked(db, "Search", "firms", [s.$primaryKey]))[
        s.$primaryKey
      ] as ObjectOf<"Firm">[]
    ).map((f) => f.firmName);
    expect(ids).toContain("Hotel Advisors");
    expect(ids).not.toContain("Bravo");
    const [discovered] = await listObjects(db, "Firm", {
      where: { firmName: { $eq: "Hotel Advisors" } },
    });
    expect(discovered).toMatchObject({
      discoveredViaSearchId: s.$primaryKey,
      lifecycleState: "Discovered",
      source: "search_discovery",
    });
  });

  it("caps results by breadth and rejects unknown breadth", async () => {
    const db = await createTestDb();
    await universe(db);
    await run(db, "runMandateSearch", { title: "M", archetype: "CF" });
    const [m] = await listObjects(db, "Mandate");
    await expect(
      run(db, "runSearch", { mandate: m.$primaryKey, breadth: "galactic" }),
    ).rejects.toThrow(/breadth/);
  });

  it("disambiguates seed firms whose names slug to the same discovered id", async () => {
    const db = await createTestDb();
    await universe(db);
    await run(db, "runMandateSearch", { title: "M", archetype: "CF" });
    const [m] = await listObjects(db, "Mandate");
    await run(db, "runSearch", {
      mandate: m.$primaryKey,
      seedFirms: ["Acme Corp!", "Acme Corp?", "Acme, Corp"],
    });
    const [s] = await listObjects(db, "Search");
    const members = (
      (await listLinked(db, "Search", "firms", [s.$primaryKey]))[
        s.$primaryKey
      ] as ObjectOf<"Firm">[]
    ).filter((f) => f.source === "search_discovery");
    expect(members).toHaveLength(3);
    expect(new Set(members.map((f) => f.$primaryKey)).size).toBe(3);
    expect(members.map((f) => f.firmName).sort()).toEqual(
      ["Acme Corp!", "Acme Corp?", "Acme, Corp"].sort(),
    );
  });
});
