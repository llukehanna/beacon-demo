import { describe, expect, it } from "vitest";
import { getObject, listObjects, updateObject } from "../db/repo.js";
import { STRONG_CF, T0, createTestDb, run, seedFirm } from "../testing.js";
import { computeDriftForFirm } from "./drift.js";
import type { ActionContext } from "./types.js";

const ctxFor = (tx: ActionContext["tx"]): ActionContext => ({
  tx,
  now: T0,
  user: "demo-analyst",
  newId: (p) => `${p}-x`,
});

describe("computeDriftForFirm", () => {
  it("raises tier_moved when a qualified firm's live tier changes", async () => {
    const db = await createTestDb();
    const firm = await seedFirm(db, STRONG_CF);
    await run(db, "qualifyFirm", { firm: firm.$primaryKey });
    await updateObject(db, "Firm", firm.$primaryKey, {
      dealSizeMUsd: 10,
      dealsPerMdL3y: 0.5,
      firmAge: 2,
    });
    const id = await db.transaction((tx) =>
      computeDriftForFirm(ctxFor(tx), firm.$primaryKey, { source: "analyst" }),
    );
    const drift = await getObject(db, "DriftEvent", id!);
    expect(drift).toMatchObject({
      driftReason: "tier_moved",
      priorTier: "A",
      newTier: "B",
      driftStatus: "open",
    });
    const axes = JSON.parse(drift!.changedAxes!) as {
      axis: string;
      old: string;
      new: string;
      source: string;
    }[];
    expect(axes.find((a) => a.axis === "Deal Size")).toMatchObject({
      old: ">$150m",
      new: "<$25m",
      source: "analyst",
    });
  });

  it("is idempotent while a matching drift is open, and silent when the tier holds", async () => {
    const db = await createTestDb();
    const firm = await seedFirm(db, STRONG_CF);
    await run(db, "qualifyFirm", { firm: firm.$primaryKey });
    expect(
      await db.transaction((tx) => computeDriftForFirm(ctxFor(tx), firm.$primaryKey)),
    ).toBeNull();
    await updateObject(db, "Firm", firm.$primaryKey, {
      dealSizeMUsd: 10,
      dealsPerMdL3y: 0.5,
      firmAge: 2,
    });
    await db.transaction((tx) => computeDriftForFirm(ctxFor(tx), firm.$primaryKey));
    expect(
      await db.transaction((tx) => computeDriftForFirm(ctxFor(tx), firm.$primaryKey)),
    ).toBeNull();
  });

  it("raises pass_reason_invalidated only when a rejected firm improves", async () => {
    const db = await createTestDb();
    const firm = await seedFirm(db, { employees: 6 });
    await run(db, "rejectFirm", { firm: firm.$primaryKey, rejectionRationale: "Too small" });
    await updateObject(db, "Firm", firm.$primaryKey, STRONG_CF);
    const id = await db.transaction((tx) => computeDriftForFirm(ctxFor(tx), firm.$primaryKey));
    expect((await getObject(db, "DriftEvent", id!))?.driftReason).toBe("pass_reason_invalidated");
  });

  it("stays silent when a rejected firm holds or gets worse", async () => {
    const db = await createTestDb();
    const firm = await seedFirm(db, { employees: 40, dealSizeMUsd: 60 });
    await run(db, "rejectFirm", { firm: firm.$primaryKey, rejectionRationale: "Not a fit" });
    expect(
      await db.transaction((tx) => computeDriftForFirm(ctxFor(tx), firm.$primaryKey)),
    ).toBeNull();
    await updateObject(db, "Firm", firm.$primaryKey, { employees: 6, dealSizeMUsd: 10 });
    expect(
      await db.transaction((tx) => computeDriftForFirm(ctxFor(tx), firm.$primaryKey)),
    ).toBeNull();
    expect(await listObjects(db, "DriftEvent")).toHaveLength(0);
  });
});

describe("outcomes and resolution", () => {
  it("flags a rejected firm acquired by a competitor, once", async () => {
    const db = await createTestDb();
    const firm = await seedFirm(db);
    await run(db, "rejectFirm", { firm: firm.$primaryKey, rejectionRationale: "No" });
    const params = {
      firm: firm.$primaryKey,
      outcome: "acquired_by_competitor",
      outcomeObservedAt: T0.toISOString(),
    };
    await run(db, "setFirmOutcome", params);
    await run(db, "setFirmOutcome", params);
    const drifts = await listObjects(db, "DriftEvent", {
      where: { firmId: { $eq: firm.$primaryKey } },
    });
    expect(drifts.map((d) => d.driftReason)).toEqual(["outcome_diverged"]);
    await expect(run(db, "setFirmOutcome", { ...params, outcome: "vibes" })).rejects.toThrow(
      /Unknown outcome/,
    );
  });

  it("re-engages a drifted firm into Outreach", async () => {
    const db = await createTestDb();
    const firm = await seedFirm(db, { employees: 6 });
    await run(db, "rejectFirm", { firm: firm.$primaryKey, rejectionRationale: "Too small" });
    await updateObject(db, "Firm", firm.$primaryKey, STRONG_CF);
    const id = await db.transaction((tx) => computeDriftForFirm(ctxFor(tx), firm.$primaryKey));
    await run(db, "reEngageFirm", { firm: firm.$primaryKey, driftEvent: id });
    expect((await getObject(db, "Firm", firm.$primaryKey))?.lifecycleState).toBe("Outreach");
    expect(await getObject(db, "DriftEvent", id!)).toMatchObject({
      driftStatus: "resolved",
      resolution: "re_engaged",
    });
    await expect(
      run(db, "reEngageFirm", { firm: firm.$primaryKey, driftEvent: id }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("keeps a firm passed with a rationale", async () => {
    const db = await createTestDb();
    const firm = await seedFirm(db, { employees: 6 });
    await run(db, "rejectFirm", { firm: firm.$primaryKey, rejectionRationale: "Too small" });
    await updateObject(db, "Firm", firm.$primaryKey, STRONG_CF);
    const id = await db.transaction((tx) => computeDriftForFirm(ctxFor(tx), firm.$primaryKey));
    await expect(run(db, "keepPassed", { driftEvent: id, rationale: "" })).rejects.toThrow(
      /rationale/,
    );
    await run(db, "keepPassed", { driftEvent: id, rationale: "Still too small to integrate." });
    expect((await getObject(db, "DriftEvent", id!))?.resolution).toBe("kept_passed");
    const decisions = await listObjects(db, "ReviewDecision", {
      where: { decisionType: { $eq: "keep_passed" } },
    });
    expect(decisions[0].rejectionRationale).toBe("Still too small to integrate.");
  });
});
