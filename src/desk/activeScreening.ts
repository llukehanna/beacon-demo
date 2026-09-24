/**
 * Approved-rule screening, evaluated client-side.
 *
 * WHY THIS EXISTS
 * The desk used to learn about screening only through HardScreenConfig rows
 * (`configActive === true`). When that table is empty — the backend has not
 * written it yet — the desk screens nobody and the queue header reads
 * "711 of 711", while /rules simultaneously shows an Approved rule claiming
 * it would screen 160 firms. Two surfaces, same underlying rules, opposite
 * arithmetic.
 *
 * So this module screens from the *approved ProposedRules themselves* — the
 * exact rows /rules renders. When a HardScreenConfig row does exist it still
 * wins, because amending a threshold writes a new config version and that
 * amended predicate is what /rules shows the analyst as "effective". The
 * config is an overlay on the proposal, never a precondition for screening.
 *
 * WHAT IT WILL NOT DO
 * A firm missing the predicate's property is NEVER screened. Unknown is not
 * a failure — it is the reason the firm is on the desk at all. A rule on
 * `employees < 10` must leave a firm with no headcount visible and workable,
 * because the analyst's whole job is to go find that headcount. This is the
 * one invariant in the file that is not a preference.
 */
import { firmFieldFor } from "./queue";

/**
 * A rule in the shape this module screens on, normalized away from the
 * ProposedRule / HardScreenConfig field-name split by `toScreeningRules`.
 */
export interface ScreeningRule {
  ruleId: string;
  axis: string; // backend vocab — "employees", "geo_score"
  operator: string; // "<", "<=", ">", ">=", "==", "!="
  threshold: string; // stringified; parsed at compare time
  model: string; // "CF" | "CS" | "both" — case-insensitive, "" means both
  /** Analyst-facing predicate, e.g. `employees < 10`. Shown on the chip. */
  label: string;
}

export interface ScreenResult {
  screened: boolean;
  /** The first rule that screened the firm, or null. */
  rule: ScreeningRule | null;
}

const NOT_SCREENED: ScreenResult = { screened: false, rule: null };

/** Numeric comparisons only. A third numeric axis needs no change here. */
const NUMERIC_OPS: Record<string, (a: number, b: number) => boolean> = {
  "<": (a, b) => a < b,
  "<=": (a, b) => a <= b,
  ">": (a, b) => a > b,
  ">=": (a, b) => a >= b,
  "=": (a, b) => a === b,
  "==": (a, b) => a === b,
  "!=": (a, b) => a !== b,
};

function firmModel(firm: ScreenableFirm): "cf" | "cs" {
  return (firm.firmType ?? "").trim().toLowerCase() === "cs" ? "cs" : "cf";
}

function ruleAppliesToModel(rule: ScreeningRule, firm: ScreenableFirm): boolean {
  const rm = rule.model.trim().toLowerCase();
  if (rm === "" || rm === "both") {
    return true;
  }
  return rm === firmModel(firm);
}

/**
 * Firms arrive from the SDK as wide objects; screening only needs firmType
 * (to honour a rule's model scope) plus whatever property the axis names,
 * which is read dynamically.
 */
export interface ScreenableFirm {
  firmType?: string | null;
  [key: string]: unknown;
}

/**
 * Does this one rule screen this one firm?
 *
 * Returns false — never throws — for every degenerate case: unresolvable
 * axis, unknown operator, non-numeric threshold, and above all a missing
 * firm value. Screening a firm hides it from the queue, so every ambiguity
 * resolves toward leaving it visible.
 */
export function ruleScreensFirm(rule: ScreeningRule, firm: ScreenableFirm): boolean {
  if (!ruleAppliesToModel(rule, firm)) {
    return false;
  }
  const field = firmFieldFor(rule.axis);
  if (field === null) {
    return false;
  }
  const raw = firm[field];
  // THE invariant: absent data never trips a screen.
  if (raw === null || raw === undefined || raw === "") {
    return false;
  }
  const compare = NUMERIC_OPS[rule.operator.trim()];
  if (compare === undefined) {
    return false;
  }
  const value = typeof raw === "number" ? raw : Number(raw);
  const threshold = Number(rule.threshold.trim());
  if (Number.isNaN(value) || Number.isNaN(threshold)) {
    return false;
  }
  return compare(value, threshold);
}

/**
 * Screen a firm against every approved rule, first match wins. `rules`
 * must already be filtered to approved — see `toScreeningRules`.
 */
export function screenFirm(firm: ScreenableFirm, rules: readonly ScreeningRule[]): ScreenResult {
  for (const rule of rules) {
    if (ruleScreensFirm(rule, firm)) {
      return { screened: true, rule };
    }
  }
  return NOT_SCREENED;
}

/**
 * Can this evaluator actually decide the rule? False for string predicates
 * (`contains`, `in`) and unresolvable axes.
 *
 * Callers that PRINT a count must check this first. `screenFirm` returns
 * "not screened" for a rule it can't evaluate, which is the right default
 * for hiding firms but a lie when rendered as "would screen 0 firms" —
 * that reads as "this rule is useless" rather than "not computed here".
 */
export function isEvaluable(rule: ScreeningRule): boolean {
  return (
    firmFieldFor(rule.axis) !== null &&
    NUMERIC_OPS[rule.operator.trim()] !== undefined &&
    !Number.isNaN(Number(rule.threshold.trim()))
  );
}

/** Count of firms screened by the approved rules — the header's third term. */
export function countScreened(
  firms: readonly ScreenableFirm[],
  rules: readonly ScreeningRule[],
): number {
  let n = 0;
  for (const firm of firms) {
    if (screenFirm(firm, rules).screened) {
      n++;
    }
  }
  return n;
}

// ─── Building the rule list ─────────────────────────────────────────────

/** ProposedRule, narrowed to the fields screening reads. */
export interface ProposedRuleLike {
  proposedRuleId: string;
  ruleStatus?: string;
  predicateAxis?: string;
  ruleOperator?: string;
  ruleThreshold?: string;
  ruleModel?: string;
}

/** HardScreenConfig, narrowed. One row is one version of one rule. */
export interface ConfigRowLike {
  sourceProposedRuleId?: string;
  configVersion?: number;
  configActive?: boolean;
  configAxis?: string;
  configOperator?: string;
  configThreshold?: string;
  configModel?: string;
}

function predicateLabel(axis: string, operator: string, threshold: string): string {
  const rhs = /^-?\d+(\.\d+)?$/.test(threshold) ? threshold : `"${threshold}"`;
  return `${axis} ${operator} ${rhs}`;
}

/**
 * Approved ProposedRules → the screening list the desk evaluates.
 *
 * Each approved proposal contributes at most one rule. Where the analyst
 * has amended the threshold, the latest ACTIVE HardScreenConfig row for
 * that proposal supplies the predicate instead — the same resolution
 * /rules uses for its "effective predicate", so the chip on a desk row and
 * the headline on the rule card cannot drift apart.
 *
 * An approved proposal whose config rows are ALL inactive has been
 * unapproved at the config layer; it drops out rather than screening on a
 * stale proposal predicate.
 */
export function toScreeningRules(
  proposals: readonly ProposedRuleLike[],
  configs: readonly ConfigRowLike[] = [],
): ScreeningRule[] {
  const byProposal = new Map<string, ConfigRowLike[]>();
  for (const c of configs) {
    const id = (c.sourceProposedRuleId ?? "").trim();
    if (id === "") {
      continue;
    }
    const list = byProposal.get(id);
    if (list === undefined) {
      byProposal.set(id, [c]);
    } else {
      list.push(c);
    }
  }

  const out: ScreeningRule[] = [];
  for (const p of proposals) {
    if ((p.ruleStatus ?? "").trim().toLowerCase() !== "approved") {
      continue;
    }
    const versions = byProposal.get(p.proposedRuleId) ?? [];
    const active = versions
      .filter((c) => c.configActive === true)
      .sort((a, b) => (a.configVersion ?? 0) - (b.configVersion ?? 0));
    const latest = active.length > 0 ? active[active.length - 1] : null;

    // Config rows exist but none are active → unapproved at the config
    // layer. Honour that over the proposal's stale "approved" status.
    if (latest === null && versions.length > 0) {
      continue;
    }

    const axis = (latest?.configAxis ?? p.predicateAxis ?? "").trim();
    const operator = (latest?.configOperator ?? p.ruleOperator ?? "").trim();
    const threshold = (latest?.configThreshold ?? p.ruleThreshold ?? "").trim();
    const model = (latest?.configModel ?? p.ruleModel ?? "both").trim();
    // Malformed proposals are dropped, not guessed at.
    if (axis === "" || operator === "" || threshold === "") {
      continue;
    }
    out.push({
      ruleId: p.proposedRuleId,
      axis,
      operator,
      threshold,
      model,
      label: predicateLabel(axis, operator, threshold),
    });
  }
  return out;
}

// ─── Live-queue partition ───────────────────────────────────────────────

/**
 * The default desk view: open work the approved rules have not screened out.
 *
 * `open` MUST come from pipelineBuckets.isOpenFirm — the funnel's definition
 * — not from a lifecycleState test done here. This module briefly owned its
 * own `isLiveState`, and it counted 674 open firms where the funnel counted
 * 441, because a base-rule hard-rejected firm keeps a "Discovered"
 * lifecycleState even after the funnel has filed it under Rejected. Screening
 * is this module's job; deciding what counts as open is not.
 */
export function isLiveQueueFirm(
  firm: ScreenableFirm,
  rules: readonly ScreeningRule[],
  open: boolean,
): boolean {
  return open && !screenFirm(firm, rules).screened;
}
