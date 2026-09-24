import { describe, expect, it } from "vitest";
import { getObject, listObjects } from "../db/repo.js";
import { STRONG_CF, createTestDb, run, seedFirm } from "../testing.js";

const byFirm = (firmId: string) => ({ where: { firmId: { $eq: firmId } } });

describe("qualifyFirm", () => {
  it("snapshots the score, marks the firm Qualified, and logs an accept", async () => {
    const db = await createTestDb();
    const firm = await seedFirm(db, STRONG_CF);
    await run(db, "qualifyFirm", { firm: firm.$primaryKey });
    const after = await getObject(db, "Firm", firm.$primaryKey);
    expect(after).toMatchObject({
      lifecycleState: "Qualified",
      currentStage: "Qualified",
      tierAtQualification: "A",
      scoreAtQualification: 18,
    });
    expect(await listObjects(db, "QualificationScore", byFirm(firm.$primaryKey))).toHaveLength(1);
    const decisions = await listObjects(db, "ReviewDecision", byFirm(firm.$primaryKey));
    expect(decisions.map((d) => [d.decisionType, d.tierAtDecision, d.decidedBy])).toEqual([
      ["accept", "A", "demo-analyst"],
    ]);
  });

  it("refuses a terminal firm", async () => {
    const db = await createTestDb();
    const firm = await seedFirm(db, { lifecycleState: "Rejected" });
    await expect(run(db, "qualifyFirm", { firm: firm.$primaryKey })).rejects.toMatchObject({
      status: 409,
    });
  });
});

describe("rejectFirm", () => {
  it("requires a rationale", async () => {
    const db = await createTestDb();
    const firm = await seedFirm(db);
    await expect(
      run(db, "rejectFirm", { firm: firm.$primaryKey, rejectionRationale: "  " }),
    ).rejects.toThrow(/rationale/);
  });

  it("rejects, snapshots, and records the rationale", async () => {
    const db = await createTestDb();
    const firm = await seedFirm(db, { employees: 6, currentStage: "In Review" });
    await run(db, "rejectFirm", {
      firm: firm.$primaryKey,
      rejectionRationale: "Too small — 6 staff.",
    });
    expect(await getObject(db, "Firm", firm.$primaryKey)).toMatchObject({
      lifecycleState: "Rejected",
      currentStage: "Rejected",
    });
    const [d] = await listObjects(db, "ReviewDecision", byFirm(firm.$primaryKey));
    expect([d.decisionType, d.rejectionRationale]).toEqual(["reject", "Too small — 6 staff."]);
    const [s] = await listObjects(db, "QualificationScore", byFirm(firm.$primaryKey));
    expect(s.computedBy).toBe("rejectFirm");
  });
});

describe("advanceStage", () => {
  it("moves exactly one stage forward", async () => {
    const db = await createTestDb();
    const firm = await seedFirm(db, { lifecycleState: "In Review" });
    await run(db, "advanceStage", { firm: firm.$primaryKey, targetState: "Outreach" });
    expect((await getObject(db, "Firm", firm.$primaryKey))?.currentStage).toBe("Outreach");
    await expect(
      run(db, "advanceStage", { firm: firm.$primaryKey, targetState: "Outreach" }),
    ).rejects.toThrow(/next stage is In Talks/);
  });

  it("does not rescore", async () => {
    const db = await createTestDb();
    const firm = await seedFirm(db);
    await run(db, "advanceStage", { firm: firm.$primaryKey, targetState: "Outreach" });
    expect(await listObjects(db, "QualificationScore", byFirm(firm.$primaryKey))).toHaveLength(0);
  });
});

describe("applyAction", () => {
  it("404s an unknown action", async () => {
    const db = await createTestDb();
    await expect(run(db, "nope" as never, {})).rejects.toMatchObject({ status: 404 });
  });

  it("refuses actions once the demo's activity tables are full", async () => {
    const db = await createTestDb();
    const a = await seedFirm(db, STRONG_CF);
    const b = await seedFirm(db, STRONG_CF);
    await run(db, "qualifyFirm", { firm: a.$primaryKey }, { maxActivityRows: 2 }); // adds a score and a decision
    await expect(
      run(db, "qualifyFirm", { firm: b.$primaryKey }, { maxActivityRows: 2 }),
    ).rejects.toMatchObject({ status: 409 });
  });
});
