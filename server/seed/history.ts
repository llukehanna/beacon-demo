/**
 * A few weeks of plausible analyst work, produced by the real action
 * handlers on an advancing clock: mandates and searches, agent enrichment
 * with verifications, overrides and conflict resolutions, qualifications,
 * clustered rejections, an approved rule, outcomes, and open drift.
 */
import type { ActionName, ObjectOf } from "../../shared/schema.js";
import { parseAxisValue, scoreFirm } from "../../shared/scoring.js";
import { USER, axisByName } from "../../shared/vocab.js";
import { applyAction } from "../actions/apply.js";
import { heuristicClusterer } from "../clustering/heuristic.js";
import type { Db } from "../db/client.js";
import { getObject, listObjects } from "../db/repo.js";
import { truthFor } from "../enrichment/providers.js";
import { rng } from "../enrichment/random.js";
import { sameValue } from "../enrichment/reconcile.js";

type FirmObj = ObjectOf<"Firm">;

const MANDATES = [
  {
    title: "Sector-focused sell-side M&A boutiques in North America",
    archetype: "CF",
    geographies: ["Americas"],
    priority: "High",
  },
  {
    title: "European mid-market advisory with cross-border reach",
    archetype: "CF",
    geographies: ["Europe"],
    priority: "Medium",
  },
  {
    title: "Private credit advisory specialists",
    archetype: "CS",
    geographies: [],
    priority: "Medium",
  },
];

const STRONG_VALUES = {
  servicesFit: "Full advisory suite",
  mdPedigree: "Bulge-bracket or elite-boutique alumni",
  dealSizeMUsd: 180,
  dealsPerMdL3y: 5.2,
  firmAge: 15,
  feeGeneratingCount: 5,
};

export async function seedHistory(db: Db, start: Date): Promise<void> {
  const r = rng("beacon-history-v1");
  let clock = start.getTime();
  const act = (name: ActionName, params: Record<string, unknown>) => {
    clock += (10 + Math.floor(r() * 40)) * 60_000;
    return applyAction(db, name, params, { now: new Date(clock), clusterer: heuristicClusterer });
  };
  const at = () => new Date(clock).toISOString();
  const loadFirm = async (id: string): Promise<FirmObj> => (await getObject(db, "Firm", id))!;

  async function enrichLikeAnAnalyst(id: string): Promise<void> {
    await act("runAgentEnrichment", { firm: id });
    const firm = await loadFirm(id);
    const open = (
      await listObjects(db, "ResearchFinding", { where: { firmId: { $eq: id } } })
    ).filter((f) => f.findingStatus === "proposed" || f.findingStatus === "abstained");
    const accepted: Record<string, unknown> = {};
    const manual: string[] = [];
    const overridden: string[] = [];

    const conflicts = new Map<string, typeof open>();
    for (const f of open) {
      if (f.conflictGroupId) {
        conflicts.set(f.conflictGroupId, [...(conflicts.get(f.conflictGroupId) ?? []), f]);
      }
    }
    for (const pair of conflicts.values()) {
      if (pair.length < 2) {
        continue;
      }
      const axis = axisByName(pair[0].axis!)!;
      const truth = truthFor(firm, axis);
      const right = pair.find((f) => sameValue(axis, f.value ?? "", truth)) ?? pair[0];
      const wrong = pair.find((f) => f !== right)!;
      await act("resolveConflict", {
        chosenFinding: right.$primaryKey,
        rejectedFinding: wrong.$primaryKey,
        chosenValue: right.value,
      });
      accepted[axis.actionParam] = parseAxisValue(axis, right.value!);
    }

    for (const f of open.filter((x) => !x.conflictGroupId)) {
      const axis = axisByName(f.axis!)!;
      const truth = truthFor(firm, axis);
      if (f.findingStatus === "abstained") {
        if (r() < 0.6) {
          await act("verifyFinding", { finding: f.$primaryKey, overrideValue: truth });
          accepted[axis.actionParam] = parseAxisValue(axis, truth);
          manual.push(axis.actionParam);
        }
        continue;
      }
      if (r() < 0.15) {
        continue;
      } // left for the analyst: keeps real work on the desk
      if (sameValue(axis, f.value!, truth)) {
        await act("verifyFinding", { finding: f.$primaryKey });
      } else {
        await act("verifyFinding", { finding: f.$primaryKey, overrideValue: truth });
        overridden.push(axis.actionParam);
      }
      accepted[axis.actionParam] = parseAxisValue(axis, truth);
    }
    if (Object.keys(accepted).length > 0) {
      await act("enrichFirm", {
        firm: id,
        ...accepted,
        fieldsEnteredManually: JSON.stringify(manual),
        agentValuesOverridden: JSON.stringify(overridden),
      });
    }
  }

  // 1. Mandates and searches.
  for (const m of MANDATES) {
    await act("runMandateSearch", m);
  }
  const mandates = await listObjects(db, "Mandate", { orderBy: { createdAt: "asc" } });
  await act("runSearch", {
    mandate: mandates[0].$primaryKey,
    geographies: ["United States", "Canada"],
    industries: ["Corporate Finance", "Technology", "Healthcare"],
    breadth: "broad",
  });
  await act("runSearch", {
    mandate: mandates[1].$primaryKey,
    geographies: ["Europe"],
    industries: ["Corporate Finance"],
    breadth: "standard",
  });

  // 2. Enrich the searched firms plus a few CS firms.
  const members = (await listObjects(db, "SearchMembership")).map((m) => m.firmId!);
  const csFirms = (
    await listObjects(db, "Firm", {
      where: { firmType: { $eq: "CS" } },
      orderBy: { firmName: "asc" },
    })
  )
    .slice(0, 10)
    .map((f) => f.$primaryKey);
  const cohort = [...new Set([...members, ...csFirms])].slice(0, 60);
  for (const id of cohort) {
    await enrichLikeAnAnalyst(id);
  }

  // 3. Qualify the strongest; move a few through the pipeline.
  const ranked = (await listObjects(db, "Firm"))
    .filter((f) => f.enrichedBy === USER)
    .map((f) => ({ f, s: scoreFirm(f) }))
    .sort((a, b) => b.s.weightedTotal - a.s.weightedTotal);
  const qualified = ranked
    .filter((x) => !x.s.hardRejected && (x.s.tier === "A" || x.s.tier === "B"))
    .slice(0, 8)
    .map((x) => x.f.$primaryKey);
  for (const id of qualified) {
    await act("qualifyFirm", { firm: id });
  }
  const inPlay = ranked
    .filter((x) => !qualified.includes(x.f.$primaryKey) && !x.s.hardRejected)
    .slice(0, 3)
    .map((x) => x.f.$primaryKey);
  if (inPlay[0]) {
    await act("advanceStage", { firm: inPlay[0], targetState: "Outreach" });
  }
  if (inPlay[1]) {
    await act("advanceStage", { firm: inPlay[1], targetState: "Outreach" });
    await act("advanceStage", { firm: inPlay[1], targetState: "In Talks" });
  }
  if (inPlay[2]) {
    await act("advanceStage", { firm: inPlay[2], targetState: "Outreach" });
  }

  // 4. Rejections that form clusters the learning loop can find.
  const taken = new Set([...qualified, ...inPlay]);
  const pool = async () =>
    (await listObjects(db, "Firm", { orderBy: { firmName: "asc" } })).filter(
      (f) =>
        !taken.has(f.$primaryKey) &&
        (f.lifecycleState === "Discovered" || f.lifecycleState === "In Review") &&
        (f.firmType ?? "CF") === "CF",
    );
  const reject = async (id: string, why: string) => {
    taken.add(id);
    await act("rejectFirm", { firm: id, rejectionRationale: why });
  };
  const notGeneralist = (f: FirmObj) => !/generalist/i.test(f.coverageModel ?? "");

  for (const f of (await pool()).filter((x) => (x.employees ?? 99) < 10).slice(0, 7)) {
    await reject(f.$primaryKey, `Too small — ${f.employees} staff; can't absorb an integration.`);
  }
  for (const f of (await pool()).filter((x) => !notGeneralist(x)).slice(0, 5)) {
    await reject(f.$primaryKey, "Generalist coverage with no sector depth; unfocused franchise.");
  }
  for (const f of (await pool())
    .filter((x) => x.dealSizeMUsd === undefined && (x.employees ?? 0) >= 10 && notGeneralist(x))
    .slice(0, 5)) {
    const size = 8 + Math.round(r() * 18);
    await act("enrichFirm", {
      firm: f.$primaryKey,
      dealSizeMUsd: size,
      fieldsEnteredManually: JSON.stringify(["dealSizeMUsd"]),
    });
    await reject(f.$primaryKey, `Deal size around $${size}m is below our floor; small deals.`);
  }
  for (const f of (await pool())
    .filter((x) => x.dealsPerMdL3y === undefined && (x.employees ?? 0) >= 10 && notGeneralist(x))
    .slice(0, 4)) {
    const volume = Math.round(r() * 15) / 10;
    await act("enrichFirm", {
      firm: f.$primaryKey,
      dealsPerMdL3y: volume,
      fieldsEnteredManually: JSON.stringify(["dealsPerMdL3y"]),
    });
    await reject(
      f.$primaryKey,
      "Too few deals per MD over the last three years; weak deal volume.",
    );
  }
  const misc = (await pool())
    .filter((x) => (x.employees ?? 0) >= 10 && notGeneralist(x))
    .slice(0, 4);
  for (const f of misc) {
    await reject(f.$primaryKey, "Weak MD pedigree for our franchise.");
  }

  // 5. Learn from the rejections; approve the clearest rule.
  await act("clusterRejections", {});
  const small = (await listObjects(db, "ProposedRule")).find(
    (x) => x.predicateAxis === "employees",
  );
  if (small) {
    await act("approveRule", { proposedRule: small.$primaryKey });
  }

  // 6. Observed outcomes.
  const outcomes = ["converted_to_talks", "loi", "went_cold", "converted_to_talks"];
  for (const [i, id] of qualified.slice(0, 4).entries()) {
    await act("setFirmOutcome", { firm: id, outcome: outcomes[i], outcomeObservedAt: at() });
  }
  const earliestRejected = (
    await listObjects(db, "ReviewDecision", {
      where: { decisionType: { $eq: "reject" } },
      orderBy: { decidedAt: "asc" },
    })
  )
    .slice(0, 2)
    .map((d) => d.firmId!);
  if (earliestRejected[0]) {
    await act("setFirmOutcome", {
      firm: earliestRejected[0],
      outcome: "acquired_by_competitor",
      outcomeObservedAt: at(),
    });
  }
  if (earliestRejected[1]) {
    await act("setFirmOutcome", {
      firm: earliestRejected[1],
      outcome: "went_cold",
      outcomeObservedAt: at(),
    });
  }

  // 7. New evidence moves terminal firms: open drift for the Review page.
  for (const id of qualified.slice(4, 8)) {
    await act("enrichFirm", {
      firm: id,
      dealSizeMUsd: 12,
      dealsPerMdL3y: 0.8,
      firmAge: 2,
      fieldsEnteredManually: JSON.stringify(["dealSizeMUsd", "dealsPerMdL3y", "firmAge"]),
    });
  }
  if (misc[0]) {
    await act("enrichFirm", {
      firm: misc[0].$primaryKey,
      ...STRONG_VALUES,
      fieldsEnteredManually: JSON.stringify(Object.keys(STRONG_VALUES)),
    });
  }

  // 8. One resolved drift so the history shows both states.
  const outcomeDrift = (
    await listObjects(db, "DriftEvent", { where: { driftReason: { $eq: "outcome_diverged" } } })
  )[0];
  if (outcomeDrift) {
    await act("keepPassed", {
      driftEvent: outcomeDrift.$primaryKey,
      rationale: "The buyer paid a premium we would not have matched.",
    });
  }
}
