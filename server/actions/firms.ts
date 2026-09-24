import { scoreFirm } from "../../shared/scoring.js";
import { DECISION, QUALIFIED, REJECTED, nextLifecycle } from "../../shared/vocab.js";
import { updateObject } from "../db/repo.js";
import { ActionError } from "../errors.js";
import { type FirmObj, iso, logDecision, snapshotScore } from "./common.js";
import { defineAction } from "./types.js";

const TERMINAL = new Set<string>([QUALIFIED, REJECTED]);
const stateOf = (firm: FirmObj): string => firm.lifecycleState ?? "Discovered";

export const qualifyFirm = defineAction<{ firm: FirmObj }>({
  params: { firm: { type: { object: "Firm" } } },
  async run(ctx, { firm }) {
    const state = stateOf(firm);
    if (TERMINAL.has(state)) {
      throw new ActionError(`Firm is already ${state}`, 409);
    }
    const result = await snapshotScore(ctx, firm, "qualifyFirm");
    await updateObject(ctx.tx, "Firm", firm.$primaryKey, {
      lifecycleState: QUALIFIED,
      currentStage: QUALIFIED, // the pipeline buckets by currentStage first
      disposition: "qualified",
      scoreAtQualification: result.weightedTotal,
      tierAtQualification: result.tier,
      qualifiedAt: iso(ctx.now),
      lastReviewed: iso(ctx.now),
    });
    const decisionId = await logDecision(ctx, {
      firmId: firm.$primaryKey,
      decisionType: DECISION.accept,
      scoreAtDecision: result.weightedTotal,
      tierAtDecision: result.tier,
    });
    return { created: [decisionId], modified: [firm.$primaryKey] };
  },
});

export const rejectFirm = defineAction<{ firm: FirmObj; rejectionRationale: string }>({
  params: { firm: { type: { object: "Firm" } }, rejectionRationale: { type: "string" } },
  async run(ctx, { firm, rejectionRationale }) {
    const rationale = rejectionRationale.trim();
    if (rationale === "") {
      throw new ActionError("A rejection needs a rationale");
    }
    if (stateOf(firm) === REJECTED) {
      throw new ActionError("Firm is already Rejected", 409);
    }
    const result = await snapshotScore(ctx, firm, "rejectFirm");
    await updateObject(ctx.tx, "Firm", firm.$primaryKey, {
      lifecycleState: REJECTED,
      currentStage: REJECTED,
      disposition: "rejected",
      lastReviewed: iso(ctx.now),
    });
    const decisionId = await logDecision(ctx, {
      firmId: firm.$primaryKey,
      decisionType: DECISION.reject,
      rejectionRationale: rationale,
      scoreAtDecision: result.weightedTotal,
      tierAtDecision: result.tier,
    });
    return { created: [decisionId], modified: [firm.$primaryKey] };
  },
});

export const advanceStage = defineAction<{ firm: FirmObj; targetState: string }>({
  params: { firm: { type: { object: "Firm" } }, targetState: { type: "string" } },
  async run(ctx, { firm, targetState }) {
    const current = stateOf(firm);
    if (TERMINAL.has(current)) {
      throw new ActionError(`Firm is ${current}; its pipeline is closed`, 409);
    }
    const expected = nextLifecycle(current);
    if (targetState !== expected) {
      throw new ActionError(
        `Cannot move ${current} → ${targetState}; the next stage is ${expected ?? "none"}`,
        409,
      );
    }
    await updateObject(ctx.tx, "Firm", firm.$primaryKey, {
      lifecycleState: targetState,
      currentStage: targetState,
      lastReviewed: iso(ctx.now),
    });
    const live = scoreFirm(firm); // recorded on the decision, not persisted as a score version
    const decisionId = await logDecision(ctx, {
      firmId: firm.$primaryKey,
      decisionType: DECISION.advance,
      analystCategorization: `${current} → ${targetState}`,
      scoreAtDecision: live.weightedTotal,
      tierAtDecision: live.tier,
    });
    return { created: [decisionId], modified: [firm.$primaryKey] };
  },
});
