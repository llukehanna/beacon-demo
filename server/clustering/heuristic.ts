/**
 * Deterministic clustering: a fixed set of candidate predicates, each
 * supported by rejections whose rationale mentions it AND whose firm
 * actually satisfies it. Used by the seed, in tests, and whenever Claude
 * is off, throttled, or unavailable.
 */
import { matchesPredicate } from "../../shared/predicate.js";
import type { Clusterer, RuleProposal } from "./types.js";

interface Candidate {
  axis: string;
  operator: string;
  threshold: string;
  keywords: RegExp;
  summary: string;
}

export const CANDIDATES: readonly Candidate[] = [
  {
    axis: "employees",
    operator: "<",
    threshold: "10",
    keywords: /\b(small|headcount|staff|employees|people)\b/i,
    summary:
      "Analysts keep passing on firms too small to absorb an integration (fewer than 10 staff).",
  },
  {
    axis: "deal_size_usd_m",
    operator: "<",
    threshold: "30",
    keywords: /deal size|small deals|below our floor/i,
    summary: "Typical deal sizes under $30m are consistently rejected as below the floor.",
  },
  {
    axis: "deals_per_md_l3y",
    operator: "<",
    threshold: "2",
    keywords: /deal volume|too few deals|deals per md|productivity/i,
    summary: "Fewer than two deals per MD over three years reads as a weak franchise.",
  },
  {
    axis: "firm_age",
    operator: "<",
    threshold: "3",
    keywords: /too new|young|track record|founded/i,
    summary: "Firms under three years old lack the track record the thesis needs.",
  },
  {
    axis: "geo_score",
    operator: "<",
    threshold: "1",
    keywords: /geograph|footprint|region|market access/i,
    summary: "Firms outside core geographies are passed on for footprint.",
  },
  {
    axis: "coverage_model",
    operator: "==",
    threshold: "Generalist",
    keywords: /generalist|unfocused|no sector depth/i,
    summary: "Generalist coverage models are rejected for lacking sector depth.",
  },
];

export const heuristicClusterer: Clusterer = async (rows) => {
  const proposals: RuleProposal[] = CANDIDATES.map((c) => ({
    predicateAxis: c.axis,
    ruleOperator: c.operator,
    ruleThreshold: c.threshold,
    ruleModel: "both" as const,
    summary: c.summary,
    supportingDecisionIds: rows
      .filter(
        (r) =>
          c.keywords.test(r.rationale) &&
          matchesPredicate(r.firm, { axis: c.axis, operator: c.operator, threshold: c.threshold }),
      )
      .map((r) => r.decisionId),
  })).filter((p) => p.supportingDecisionIds.length > 0);
  return { proposals, source: "heuristic" };
};
