/** One rejection the clusterer may group: the analyst's words plus the firm's facts. */
export interface RejectionRow {
  decisionId: string;
  firmId: string;
  rationale: string;
  firm: Readonly<Record<string, unknown>>;
}

/** A candidate hard-screen rule. The action validates every field before persisting. */
export interface RuleProposal {
  predicateAxis: string;
  ruleOperator: string;
  ruleThreshold: string;
  ruleModel: "CF" | "CS" | "both";
  summary: string;
  supportingDecisionIds: string[];
}

export type Clusterer = (
  rows: readonly RejectionRow[],
) => Promise<{ proposals: RuleProposal[]; source: "claude" | "heuristic" }>;
