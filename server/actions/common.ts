import type { ObjectOf, ObjectTypeName, Props } from "../../shared/schema.js";
import type { MirrorResult } from "../../shared/scoreMirror.js";
import { RUBRIC_VERSION, THESIS_VERSION, scoreFirm } from "../../shared/scoring.js";
import { getObject, insertObject } from "../db/repo.js";
import { ActionError } from "../errors.js";
import type { ActionContext } from "./types.js";

export type FirmObj = ObjectOf<"Firm">;

export const iso = (d: Date): string => d.toISOString();

export async function requireObject<N extends ObjectTypeName>(
  ctx: ActionContext,
  type: N,
  pk: string,
): Promise<ObjectOf<N>> {
  const obj = await getObject(ctx.tx, type, pk);
  if (!obj) {
    throw new ActionError(`${type} ${pk} not found`, 404);
  }
  return obj;
}

/** Append a QualificationScore version for the firm as it stands now. */
export async function snapshotScore(
  ctx: ActionContext,
  firm: FirmObj,
  computedBy: string,
): Promise<MirrorResult> {
  const result = scoreFirm(firm);
  await insertObject(ctx.tx, "QualificationScore", {
    scoreId: ctx.newId("qs"),
    firmId: firm.$primaryKey,
    model: result.model,
    weightedTotal: result.weightedTotal,
    maxPossible: result.maxPossible,
    pct: result.pct,
    tier: result.tier,
    confidence: result.confidence,
    axisScoresJson: JSON.stringify(result.axisScores),
    thesisVersion: THESIS_VERSION,
    rubricVersion: RUBRIC_VERSION,
    computedBy,
    computedAt: iso(ctx.now),
  });
  return result;
}

/** Append a ReviewDecision stamped with the acting user and time. */
export async function logDecision(
  ctx: ActionContext,
  fields: Props<"ReviewDecision">,
): Promise<string> {
  const decisionId = ctx.newId("rd");
  await insertObject(ctx.tx, "ReviewDecision", {
    ...fields,
    decisionId,
    decidedBy: ctx.user,
    decidedAt: iso(ctx.now),
  });
  return decisionId;
}
