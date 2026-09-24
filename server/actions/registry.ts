import type { ActionName } from "../../shared/schema.js";
import { keepPassed, reEngageFirm, setFirmOutcome } from "./drift.js";
import { enrichFirm, resolveConflict, runAgentEnrichment, verifyFinding } from "./findings.js";
import { advanceStage, qualifyFirm, rejectFirm } from "./firms.js";
import {
  amendRuleThreshold,
  approveRule,
  clusterRejections,
  dismissRule,
  unapproveRule,
} from "./rules.js";
import { runMandateSearch, runSearch } from "./search.js";
import type { ActionDef } from "./types.js";

// Each action module registers here as it lands; Task 10 asserts full coverage.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const ACTIONS: Partial<Record<ActionName, ActionDef<any>>> = {
  qualifyFirm,
  rejectFirm,
  advanceStage,
  setFirmOutcome,
  reEngageFirm,
  keepPassed,
  runAgentEnrichment,
  verifyFinding,
  resolveConflict,
  enrichFirm,
  runMandateSearch,
  runSearch,
  clusterRejections,
  approveRule,
  dismissRule,
  unapproveRule,
  amendRuleThreshold,
};
