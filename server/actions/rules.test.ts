import { describe, expect, it } from "vitest";
import { heuristicClusterer } from "../clustering/heuristic.js";
import type { Clusterer } from "../clustering/types.js";
import type { Db } from "../db/client.js";
import { getObject, insertObject, listObjects } from "../db/repo.js";
import { createTestDb, run, seedFirm } from "../testing.js";

async function pendingRule(db: Db, id = "r1") {
  await insertObject(db, "ProposedRule", {
    proposedRuleId: id,
    predicateAxis: "employees",
    ruleOperator: "<",
    ruleThreshold: "10",
    ruleModel: "both",
    ruleStatus: "pending",
    supportingDecisionIds: "[]",
  });
  return id;
}

const configs = (db: Db) =>
  listObjects(db, "HardScreenConfig", { orderBy: { configVersion: "asc" } });

describe("rule lifecycle", () => {
  it("approve → amend → unapprove keeps one active, versioned config", async () => {
    const db = await createTestDb();
    const id = await pendingRule(db);
    await run(db, "approveRule", { proposedRule: id });
    await expect(run(db, "approveRule", { proposedRule: id })).rejects.toMatchObject({
      status: 409,
    });
    await run(db, "amendRuleThreshold", { proposedRule: id, newThreshold: "8" });
    let rows = await configs(db);
    expect(rows.map((c) => [c.configVersion, c.configThreshold, c.configActive])).toEqual([
      [1, "10", false],
      [2, "8", true],
    ]);
    await run(db, "unapproveRule", { proposedRule: id });
    rows = await configs(db);
    expect(rows.every((c) => c.configActive === false)).toBe(true);
    expect((await getObject(db, "ProposedRule", id))?.ruleStatus).toBe("pending");
  });

  it("dismissal needs a reason and deactivates configs", async () => {
    const db = await createTestDb();
    const id = await pendingRule(db);
    await run(db, "approveRule", { proposedRule: id });
    await expect(run(db, "dismissRule", { proposedRule: id, reason: " " })).rejects.toThrow(
      /reason/,
    );
    await run(db, "dismissRule", { proposedRule: id, reason: "Screens out good seed-stage firms" });
    expect((await getObject(db, "ProposedRule", id))?.ruleStatus).toBe("dismissed");
    expect((await configs(db)).some((c) => c.configActive)).toBe(false);
  });

  it("rejects an invalid amended operator", async () => {
    const db = await createTestDb();
    const id = await pendingRule(db);
    await run(db, "approveRule", { proposedRule: id });
    await expect(
      run(db, "amendRuleThreshold", { proposedRule: id, newThreshold: "8", newOperator: "~" }),
    ).rejects.toThrow(/operator/);
  });
});

describe("clusterRejections", () => {
  async function rejectedSmallFirms(db: Db) {
    for (let i = 0; i < 5; i++) {
      const f = await seedFirm(db, { employees: 4 + i });
      await run(db, "rejectFirm", {
        firm: f.$primaryKey,
        rejectionRationale: `Too small — ${4 + i} staff.`,
      });
    }
    const big = await seedFirm(db, { employees: 50 });
    await run(db, "rejectFirm", {
      firm: big.$primaryKey,
      rejectionRationale: "Too small a franchise for us.",
    });
    for (const employees of [5, 8, 40]) {
      await seedFirm(db, { employees, lifecycleState: "In Review" });
    }
  }

  it("proposes a grounded rule with support and projected impact, once", async () => {
    const db = await createTestDb();
    await rejectedSmallFirms(db);
    const result = await run(db, "clusterRejections", {}, { clusterer: heuristicClusterer });
    expect(result.note).toMatch(/heuristic/);
    const [rule] = await listObjects(db, "ProposedRule");
    expect(rule).toMatchObject({
      predicateAxis: "employees",
      ruleOperator: "<",
      ruleThreshold: "10",
      ruleStatus: "pending",
    });
    expect(rule.supportingFirmCount).toBe(5); // the 50-person firm does not satisfy the predicate
    expect(JSON.parse(rule.supportingDecisionIds!)).toHaveLength(5);
    expect(rule.projectedScreenCount).toBe(2); // queue firms with 5 and 8 staff
    await run(db, "clusterRejections", {}, { clusterer: heuristicClusterer });
    expect(await listObjects(db, "ProposedRule")).toHaveLength(1);
  });

  it("drops proposals with bad axes, bad operators, or too little real support", async () => {
    const db = await createTestDb();
    await rejectedSmallFirms(db);
    const decisions = await listObjects(db, "ReviewDecision", {
      where: { decisionType: { $eq: "reject" } },
    });
    const ids = decisions.map((d) => d.$primaryKey);
    const fake: Clusterer = async () => ({
      source: "claude",
      proposals: [
        {
          predicateAxis: "vibes",
          ruleOperator: "<",
          ruleThreshold: "1",
          ruleModel: "both",
          summary: "x",
          supportingDecisionIds: ids,
        },
        {
          predicateAxis: "employees",
          ruleOperator: "~",
          ruleThreshold: "10",
          ruleModel: "both",
          summary: "x",
          supportingDecisionIds: ids,
        },
        {
          predicateAxis: "employees",
          ruleOperator: "<",
          ruleThreshold: "10",
          ruleModel: "both",
          summary: "x",
          supportingDecisionIds: ids.slice(0, 3),
        },
        {
          predicateAxis: "employees",
          ruleOperator: ">",
          ruleThreshold: "100",
          ruleModel: "both",
          summary: "x",
          supportingDecisionIds: ids,
        },
      ],
    });
    await run(db, "clusterRejections", {}, { clusterer: fake });
    expect(await listObjects(db, "ProposedRule")).toHaveLength(0);
  });

  it("counts distinct firms, not decisions", async () => {
    const db = await createTestDb();
    const firms = [];
    for (let i = 0; i < 3; i++) {
      const f = await seedFirm(db, { employees: 4 + i });
      await run(db, "rejectFirm", { firm: f.$primaryKey, rejectionRationale: "Too small." });
      firms.push(f);
    }
    // The same firm rejected a second time (e.g. after a re-engage).
    await insertObject(db, "ReviewDecision", {
      decisionId: "d-again",
      firmId: firms[0].$primaryKey,
      decisionType: "reject",
      rejectionRationale: "Still too small.",
      decidedAt: new Date().toISOString(),
    });
    const ids = (
      await listObjects(db, "ReviewDecision", { where: { decisionType: { $eq: "reject" } } })
    ).map((d) => d.$primaryKey);
    expect(ids).toHaveLength(4);
    const fake: Clusterer = async () => ({
      source: "claude",
      proposals: [
        {
          predicateAxis: "employees",
          ruleOperator: "<",
          ruleThreshold: "10",
          ruleModel: "both",
          summary: "x",
          supportingDecisionIds: ids,
        },
      ],
    });
    await run(db, "clusterRejections", {}, { clusterer: fake });
    expect(await listObjects(db, "ProposedRule")).toHaveLength(0);
  });
});
