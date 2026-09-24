/**
 * Tokens that stand in for the generated OSDK package: pages pass these to
 * the hooks exactly as they passed the SDK's object and action types.
 */
import type { ActionName, ObjectTypeName } from "../../shared/schema";

export interface ObjectTypeToken<N extends ObjectTypeName = ObjectTypeName> {
  readonly kind: "object";
  readonly apiName: N;
}
export interface ActionToken<N extends ActionName = ActionName> {
  readonly kind: "action";
  readonly apiName: N;
}

const obj = <N extends ObjectTypeName>(apiName: N): ObjectTypeToken<N> => ({
  kind: "object",
  apiName,
});
const act = <N extends ActionName>(apiName: N): ActionToken<N> => ({ kind: "action", apiName });

export const Firm = obj("Firm");
export const Mandate = obj("Mandate");
export const Search = obj("Search");
export const SearchList = obj("SearchList");
export const SearchMembership = obj("SearchMembership");
export const ResearchFinding = obj("ResearchFinding");
export const QualificationScore = obj("QualificationScore");
export const ReviewDecision = obj("ReviewDecision");
export const DriftEvent = obj("DriftEvent");
export const ProposedRule = obj("ProposedRule");
export const HardScreenConfig = obj("HardScreenConfig");

export const runMandateSearchAction = act("runMandateSearch");
export const runSearchAction = act("runSearch");
export const runAgentEnrichmentAction = act("runAgentEnrichment");
export const enrichFirmAction = act("enrichFirm");
export const verifyFindingAction = act("verifyFinding");
export const resolveConflictAction = act("resolveConflict");
export const qualifyFirmAction = act("qualifyFirm");
export const rejectFirmAction = act("rejectFirm");
export const advanceStageAction = act("advanceStage");
export const setFirmOutcomeAction = act("setFirmOutcome");
export const reEngageFirmAction = act("reEngageFirm");
export const keepPassedAction = act("keepPassed");
export const clusterRejectionsAction = act("clusterRejections");
export const approveRuleAction = act("approveRule");
export const dismissRuleAction = act("dismissRule");
export const unapproveRuleAction = act("unapproveRule");
export const amendRuleThresholdAction = act("amendRuleThreshold");
