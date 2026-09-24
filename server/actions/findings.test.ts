import { describe, expect, it } from "vitest";
import type { ObjectOf } from "../../shared/schema.js";
import type { Db } from "../db/client.js";
import { getObject, insertObject, listObjects } from "../db/repo.js";
import { STRONG_CF, T0, createTestDb, run, seedFirm } from "../testing.js";

const findingsOf = (db: Db, firmId: string) =>
  listObjects(db, "ResearchFinding", { where: { firmId: { $eq: firmId } } });

async function addFinding(
  db: Db,
  f: Partial<ObjectOf<"ResearchFinding">> & { findingId: string; firmId: string },
) {
  await insertObject(db, "ResearchFinding", {
    axis: "deal_size_usd_m",
    value: "60",
    provider: "dealdb",
    findingStatus: "proposed",
    confidenceTier: "high",
    verifiedByHuman: false,
    retrievedAt: T0.toISOString(),
    ...f,
  });
}

describe("runAgentEnrichment", () => {
  it("proposes or abstains on every axis for the firm's model and moves it to In Review", async () => {
    const db = await createTestDb();
    const firm = await seedFirm(db, { lifecycleState: "Discovered" });
    await run(db, "runAgentEnrichment", { firm: firm.$primaryKey });
    const findings = await findingsOf(db, firm.$primaryKey);
    const axes = new Set(findings.map((f) => f.axis));
    expect(axes.size).toBe(10); // 11 axes minus CS-only balance_sheet_principal
    expect(findings.every((f) => ["proposed", "abstained"].includes(f.findingStatus!))).toBe(true);
    expect((await getObject(db, "Firm", firm.$primaryKey))?.lifecycleState).toBe("In Review");
  });

  it("supersedes stale proposals on re-run and never touches verified axes", async () => {
    const db = await createTestDb();
    const firm = await seedFirm(db);
    await addFinding(db, {
      findingId: "v1",
      firmId: firm.$primaryKey,
      findingStatus: "verified",
      verifiedByHuman: true,
    });
    await run(db, "runAgentEnrichment", { firm: firm.$primaryKey });
    await run(db, "runAgentEnrichment", { firm: firm.$primaryKey });
    const findings = await findingsOf(db, firm.$primaryKey);
    expect(findings.filter((f) => f.axis === "deal_size_usd_m").map((f) => f.findingId)).toEqual([
      "v1",
    ]);
    const live = findings.filter(
      (f) => f.findingStatus === "proposed" || f.findingStatus === "abstained",
    );
    expect(new Set(live.map((f) => f.axis)).size).toBe(9);
    expect(findings.some((f) => f.findingStatus === "superseded")).toBe(true);
  });
});

describe("verifyFinding", () => {
  it("confirms an agent finding as human agreement", async () => {
    const db = await createTestDb();
    const firm = await seedFirm(db);
    await addFinding(db, { findingId: "f1", firmId: firm.$primaryKey });
    await run(db, "verifyFinding", { finding: "f1" });
    expect(await getObject(db, "ResearchFinding", "f1")).toMatchObject({
      findingStatus: "verified",
      verifiedByHuman: true,
    });
  });

  it("records an override: agent finding rejected, analyst finding verified", async () => {
    const db = await createTestDb();
    const firm = await seedFirm(db);
    await addFinding(db, { findingId: "f1", firmId: firm.$primaryKey });
    await run(db, "verifyFinding", { finding: "f1", overrideValue: "200" });
    expect((await getObject(db, "ResearchFinding", "f1"))?.findingStatus).toBe("rejected");
    const analyst = (await findingsOf(db, firm.$primaryKey)).find((f) => f.provider === "analyst");
    expect(analyst).toMatchObject({
      value: "200",
      findingStatus: "verified",
      verifiedByHuman: false,
      normalizedScore: 2,
    });
  });

  it("fills an abstention without counting it as agreement", async () => {
    const db = await createTestDb();
    const firm = await seedFirm(db);
    await addFinding(db, {
      findingId: "a1",
      firmId: firm.$primaryKey,
      value: undefined,
      findingStatus: "abstained",
      confidenceTier: "abstain",
    });
    await expect(run(db, "verifyFinding", { finding: "a1" })).rejects.toThrow(/needs a value/);
    await run(db, "verifyFinding", { finding: "a1", overrideValue: "45" });
    expect((await getObject(db, "ResearchFinding", "a1"))?.findingStatus).toBe("abstained");
  });
});

describe("resolveConflict", () => {
  it("verifies the chosen side, rejects the other, logs an adjust", async () => {
    const db = await createTestDb();
    const firm = await seedFirm(db);
    await addFinding(db, {
      findingId: "c1",
      firmId: firm.$primaryKey,
      conflictGroupId: "g",
      value: "60",
    });
    await addFinding(db, {
      findingId: "c2",
      firmId: firm.$primaryKey,
      conflictGroupId: "g",
      value: "20",
      provider: "websearch",
    });
    await expect(
      run(db, "resolveConflict", {
        chosenFinding: "c1",
        rejectedFinding: "c2",
        chosenValue: "999",
      }),
    ).rejects.toThrow(/must match/);
    await run(db, "resolveConflict", {
      chosenFinding: "c1",
      rejectedFinding: "c2",
      chosenValue: "60",
    });
    expect((await getObject(db, "ResearchFinding", "c1"))?.verifiedByHuman).toBe(true);
    expect((await getObject(db, "ResearchFinding", "c2"))?.findingStatus).toBe("rejected");
    const [d] = await listObjects(db, "ReviewDecision", {
      where: { firmId: { $eq: firm.$primaryKey } },
    });
    expect(d.decisionType).toBe("adjust");
  });
});

describe("enrichFirm", () => {
  it("writes fields, snapshots a score, logs the decision, and records unbacked manual values", async () => {
    const db = await createTestDb();
    const firm = await seedFirm(db, { lifecycleState: "Discovered" });
    await addFinding(db, { findingId: "f1", firmId: firm.$primaryKey, value: "150" });
    await run(db, "enrichFirm", {
      firm: firm.$primaryKey,
      dealSizeMUsd: 150,
      firmAge: 12,
      hasStOrBalanceSheet: false,
      fieldsEnteredManually: JSON.stringify(["dealSizeMUsd", "firmAge", "hasStOrBalanceSheet"]),
    });
    const after = await getObject(db, "Firm", firm.$primaryKey);
    expect(after).toMatchObject({
      dealSizeMUsd: 150,
      firmAge: 12,
      hasSTOrBalanceSheet: false,
      lifecycleState: "In Review",
    });
    const analyst = (await findingsOf(db, firm.$primaryKey))
      .filter((f) => f.provider === "analyst")
      .map((f) => f.axis)
      .sort();
    expect(analyst).toEqual(["firm_age", "has_st_or_balance_sheet"]); // deal size is already backed by f1
    expect(
      await listObjects(db, "QualificationScore", { where: { firmId: { $eq: firm.$primaryKey } } }),
    ).toHaveLength(1);
    const [d] = await listObjects(db, "ReviewDecision", {
      where: { firmId: { $eq: firm.$primaryKey } },
    });
    expect(d.decisionType).toBe("enrich");
  });

  it("rejects an empty commit and raises drift on a qualified firm", async () => {
    const db = await createTestDb();
    const firm = await seedFirm(db, STRONG_CF);
    await expect(run(db, "enrichFirm", { firm: firm.$primaryKey })).rejects.toThrow(
      /Nothing to enrich/,
    );
    await run(db, "qualifyFirm", { firm: firm.$primaryKey });
    await run(db, "enrichFirm", {
      firm: firm.$primaryKey,
      dealSizeMUsd: 10,
      dealsPerMdL3y: 0.5,
      firmAge: 2,
    });
    const drifts = await listObjects(db, "DriftEvent", {
      where: { firmId: { $eq: firm.$primaryKey } },
    });
    expect(drifts.map((d) => d.driftReason)).toEqual(["tier_moved"]);
  });
});
