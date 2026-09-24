import type { ObjectOf, Props } from "../../shared/schema.js";
import { axisPoints, firmModel, formatAxisValue, parseAxisValue } from "../../shared/scoring.js";
import {
  ANALYST,
  type AxisDef,
  DECISION,
  ENRICH_AXES,
  PROVIDER_TRUST,
  axisByName,
} from "../../shared/vocab.js";
import { insertObject, listObjects, updateObject } from "../db/repo.js";
import { type Observation, observe } from "../enrichment/providers.js";
import { reconcileAxis, sameValue } from "../enrichment/reconcile.js";
import { ActionError } from "../errors.js";
import { type FirmObj, iso, logDecision, requireObject, snapshotScore } from "./common.js";
import { computeDriftForFirm } from "./drift.js";
import { type ActionContext, defineAction } from "./types.js";

type FindingObj = ObjectOf<"ResearchFinding">;

const moveToReview = (firm: FirmObj): Props<"Firm"> =>
  (firm.lifecycleState ?? "Discovered") === "Discovered"
    ? { lifecycleState: "In Review", currentStage: "In Review" }
    : {};

async function insertAnalystFinding(
  ctx: ActionContext,
  firm: FirmObj,
  axis: AxisDef,
  value: string,
  excerpt: string,
  normalizedScore?: number | null,
): Promise<string> {
  const findingId = ctx.newId("rf");
  await insertObject(ctx.tx, "ResearchFinding", {
    findingId,
    firmId: firm.$primaryKey,
    axis: axis.axis,
    value,
    provider: ANALYST,
    sourceType: "analyst",
    sourceExcerpt: excerpt,
    confidence: 1,
    confidenceTier: "high",
    // Analyst-authored: verified for the axis, but not "agent agreement".
    findingStatus: "verified",
    verifiedByHuman: false,
    verifiedBy: ctx.user,
    verifiedAt: iso(ctx.now),
    normalizedScore: normalizedScore ?? axisPoints(firm, axis, parseAxisValue(axis, value)),
    retrievedAt: iso(ctx.now),
  });
  return findingId;
}

export const runAgentEnrichment = defineAction<{ firm: FirmObj }>({
  params: { firm: { type: { object: "Firm" } } },
  async run(ctx, { firm }) {
    const model = firmModel(firm);
    const existing = await listObjects(ctx.tx, "ResearchFinding", {
      where: { firmId: { $eq: firm.$primaryKey } },
    });
    const created: string[] = [];
    for (const axis of ENRICH_AXES) {
      if (!axis.models.includes(model)) {
        continue;
      }
      const forAxis = existing.filter((f) => f.axis === axis.axis);
      if (forAxis.some((f) => f.findingStatus === "verified")) {
        continue;
      } // settled by a human
      for (const stale of forAxis.filter(
        (f) => f.findingStatus === "proposed" || f.findingStatus === "abstained",
      )) {
        await updateObject(ctx.tx, "ResearchFinding", stale.$primaryKey, {
          findingStatus: "superseded",
        });
      }
      const observations = PROVIDER_TRUST.map((p) => observe(p, firm, axis)).filter(
        (o): o is Observation => o !== null,
      );
      for (const plan of reconcileAxis(axis, observations, () => ctx.newId("cg"))) {
        const findingId = ctx.newId("rf");
        await insertObject(ctx.tx, "ResearchFinding", {
          findingId,
          firmId: firm.$primaryKey,
          ...plan,
          normalizedScore:
            plan.value === null ? null : axisPoints(firm, axis, parseAxisValue(axis, plan.value)),
          verifiedByHuman: false,
          retrievedAt: iso(ctx.now),
        });
        created.push(findingId);
      }
    }
    await updateObject(ctx.tx, "Firm", firm.$primaryKey, {
      enrichedBy: "agent",
      enrichedAt: iso(ctx.now),
      ...moveToReview(firm),
    });
    return { created, modified: [firm.$primaryKey] };
  },
});

export const verifyFinding = defineAction<{
  finding: FindingObj;
  overrideValue?: string;
  overrideNormalizedScore?: number;
}>({
  params: {
    finding: { type: { object: "ResearchFinding" } },
    overrideValue: { type: "string", nullable: true },
    overrideNormalizedScore: { type: "integer", nullable: true },
  },
  async run(ctx, { finding, overrideValue, overrideNormalizedScore }) {
    const status = finding.findingStatus ?? "proposed";
    if (status !== "proposed" && status !== "abstained") {
      throw new ActionError(
        `Finding is ${status}; only proposed or abstained findings can be verified`,
        409,
      );
    }
    const axis = axisByName(finding.axis ?? "");
    if (!axis) {
      throw new ActionError(`Unknown axis "${finding.axis ?? ""}"`);
    }
    const newValue = overrideValue?.trim() ?? "";
    if (status === "abstained" && newValue === "") {
      throw new ActionError("An abstained finding needs a value from the analyst");
    }
    const valueChanged =
      newValue !== "" && !(finding.value !== undefined && sameValue(axis, newValue, finding.value));
    const scoreChanged =
      overrideNormalizedScore !== undefined && overrideNormalizedScore !== finding.normalizedScore;
    const stamp = { verifiedBy: ctx.user, verifiedAt: iso(ctx.now) };

    if (!valueChanged && !scoreChanged) {
      await updateObject(ctx.tx, "ResearchFinding", finding.$primaryKey, {
        findingStatus: "verified",
        verifiedByHuman: true,
        ...stamp,
      });
      return { modified: [finding.$primaryKey] };
    }
    // Override: the agent's value is recorded as wrong (an abstention stays an
    // abstention), and the analyst's value becomes the verified record.
    if (status === "proposed") {
      await updateObject(ctx.tx, "ResearchFinding", finding.$primaryKey, {
        findingStatus: "rejected",
        ...stamp,
      });
    }
    const firm = await requireObject(ctx, "Firm", finding.firmId ?? "");
    const value = newValue !== "" ? newValue : (finding.value ?? "");
    const findingId = await insertAnalystFinding(
      ctx,
      firm,
      axis,
      value,
      `Analyst override of ${finding.provider ?? "agent"} value "${finding.value ?? "—"}".`,
      overrideNormalizedScore,
    );
    return { created: [findingId], modified: [finding.$primaryKey] };
  },
});

export const resolveConflict = defineAction<{
  chosenFinding: FindingObj;
  rejectedFinding: FindingObj;
  chosenValue: string;
}>({
  params: {
    chosenFinding: { type: { object: "ResearchFinding" } },
    rejectedFinding: { type: { object: "ResearchFinding" } },
    chosenValue: { type: "string" },
  },
  async run(ctx, { chosenFinding: chosen, rejectedFinding: rejected, chosenValue }) {
    if (chosen.$primaryKey === rejected.$primaryKey) {
      throw new ActionError("Pick two different findings");
    }
    if (!chosen.conflictGroupId || chosen.conflictGroupId !== rejected.conflictGroupId) {
      throw new ActionError("Findings are not in the same conflict group");
    }
    if (chosenValue.trim() !== (chosen.value ?? "").trim()) {
      throw new ActionError("chosenValue must match the chosen finding's value");
    }
    for (const f of [chosen, rejected]) {
      if (f.findingStatus !== "proposed") {
        throw new ActionError(`Finding ${f.$primaryKey} is already ${f.findingStatus}`, 409);
      }
    }
    const stamp = { verifiedBy: ctx.user, verifiedAt: iso(ctx.now) };
    await updateObject(ctx.tx, "ResearchFinding", chosen.$primaryKey, {
      findingStatus: "verified",
      verifiedByHuman: true,
      ...stamp,
    });
    await updateObject(ctx.tx, "ResearchFinding", rejected.$primaryKey, {
      findingStatus: "rejected",
      ...stamp,
    });
    const decisionId = await logDecision(ctx, {
      firmId: chosen.firmId,
      decisionType: DECISION.adjust,
      analystCategorization: `Resolved ${chosen.axis} conflict: ${chosen.provider} over ${rejected.provider}`,
    });
    return { created: [decisionId], modified: [chosen.$primaryKey, rejected.$primaryKey] };
  },
});

function parseKeyList(raw: string | undefined): Set<string> {
  if (!raw) {
    return new Set();
  }
  try {
    const v = JSON.parse(raw) as unknown;
    if (Array.isArray(v)) {
      return new Set(v.filter((x): x is string => typeof x === "string"));
    }
  } catch {
    // fall through to comma-separated
  }
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

type EnrichParams = {
  firm: FirmObj;
  servicesFit?: string;
  mdPedigree?: string;
  balanceSheetPrincipal?: string;
  dealSizeMUsd?: number;
  dealsPerMdL3y?: number;
  firmAge?: number;
  feeGeneratingCount?: number;
  advisoryConflict?: boolean;
  hasStOrBalanceSheet?: boolean;
  webActivity?: boolean;
  solvent?: boolean;
  employees?: number;
  coverageModel?: string;
  fieldsEnteredManually?: string;
  agentValuesOverridden?: string;
};

export const enrichFirm = defineAction<EnrichParams>({
  params: {
    firm: { type: { object: "Firm" } },
    servicesFit: { type: "string", nullable: true },
    mdPedigree: { type: "string", nullable: true },
    balanceSheetPrincipal: { type: "string", nullable: true },
    dealSizeMUsd: { type: "double", nullable: true },
    dealsPerMdL3y: { type: "double", nullable: true },
    firmAge: { type: "integer", nullable: true },
    feeGeneratingCount: { type: "integer", nullable: true },
    advisoryConflict: { type: "boolean", nullable: true },
    hasStOrBalanceSheet: { type: "boolean", nullable: true },
    webActivity: { type: "boolean", nullable: true },
    solvent: { type: "boolean", nullable: true },
    employees: { type: "integer", nullable: true },
    coverageModel: { type: "string", nullable: true },
    fieldsEnteredManually: { type: "string", nullable: true },
    agentValuesOverridden: { type: "string", nullable: true },
  },
  async run(ctx, p) {
    const { firm } = p;
    const values = p as unknown as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    const written: AxisDef[] = [];
    for (const axis of ENRICH_AXES) {
      const v = values[axis.actionParam];
      if (v !== undefined) {
        patch[axis.firmField] = v;
        written.push(axis);
      }
    }
    if (p.employees !== undefined) {
      patch.employees = p.employees;
    }
    if (p.coverageModel !== undefined) {
      patch.coverageModel = p.coverageModel;
    }
    if (Object.keys(patch).length === 0) {
      throw new ActionError("Nothing to enrich; pass at least one field");
    }

    await updateObject(ctx.tx, "Firm", firm.$primaryKey, {
      ...(patch as Props<"Firm">),
      enrichedBy: ctx.user,
      enrichedAt: iso(ctx.now),
      lastReviewed: iso(ctx.now),
      ...moveToReview(firm),
    });
    const fresh = await requireObject(ctx, "Firm", firm.$primaryKey);

    // Record analyst evidence only for manual values no existing finding backs;
    // accepted agent findings are verified separately by the desk's flush.
    const manual = parseKeyList(p.fieldsEnteredManually);
    const existing = await listObjects(ctx.tx, "ResearchFinding", {
      where: { firmId: { $eq: firm.$primaryKey } },
    });
    const created: string[] = [];
    for (const axis of written.filter((a) => manual.has(a.actionParam))) {
      const value = formatAxisValue(values[axis.actionParam] as string | number | boolean);
      const backed = existing.some(
        (f) =>
          f.axis === axis.axis &&
          f.value !== undefined &&
          (f.findingStatus === "proposed" || f.findingStatus === "verified") &&
          sameValue(axis, f.value, value),
      );
      if (!backed) {
        created.push(
          await insertAnalystFinding(
            ctx,
            fresh,
            axis,
            value,
            "Entered by the analyst on the enrichment desk.",
          ),
        );
      }
    }

    const result = await snapshotScore(ctx, fresh, "enrichFirm");
    created.push(
      await logDecision(ctx, {
        firmId: firm.$primaryKey,
        decisionType: DECISION.enrich,
        fieldsEnteredManually: p.fieldsEnteredManually ?? "[]",
        agentValuesOverridden: p.agentValuesOverridden,
        scoreAtDecision: result.weightedTotal,
        tierAtDecision: result.tier,
      }),
    );
    const driftId = await computeDriftForFirm(ctx, firm.$primaryKey, {
      source: manual.size > 0 ? ANALYST : "agent",
    });
    if (driftId) {
      created.push(driftId);
    }
    return { created, modified: [firm.$primaryKey] };
  },
});
