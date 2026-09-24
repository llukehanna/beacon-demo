/**
 * Enrichment Desk - queue prioritizer + shared hard-screen verdict.
 *
 * `computeHardScreen(firm, activeConfigs)` is the ONE source of truth for
 * whether a firm has been screened out. Both the queue's sink decision and
 * the header/badge label read from it, so the two can't disagree.
 *
 * The verdict combines three sources, in this order:
 *   1. Client base rules (from scoreMirror) — generalist coverage / S&T
 *      services for CF, principal investing / advisoryConflict for CS.
 *   2. Active approved HardScreenConfig rows — learned rules an analyst
 *      has approved via /rules. Filtered to configActive === true before
 *      being passed in, so pending / dismissed proposals never screen.
 *   3. Server disposition string — belt-and-braces for backend flags the
 *      client mirror can't reconstruct.
 *
 * Queue ranking then applies:
 *   • hard-screened → very bottom
 *   • terminal (Qualified / Rejected lifecycle) → above hard-screened
 *   • workable → gain desc, fewer-missing tiebreak
 */
import { type Model, type ScoreInput, mirrorScore } from "./scoreMirror";

export interface QueueFirm extends ScoreInput {
  firmId: string;
  firmName?: string | null;
  // Lifecycle carried through so the ranker can push Qualified / Rejected
  // firms to the bottom — the desk is a to-do list, not a leaderboard.
  lifecycleState?: string | null;
  currentStage?: string | null;
  // Disposition captures the server's judgement — the client mirror only
  // knows a subset of hard-screen rules (coverage/services/geo/conflict);
  // the server may have flagged the firm through a HardScreenConfig row
  // the client can't reconstruct. Reading disposition lets us honour the
  // server's decision even when the mirror sees the firm as workable.
  disposition?: string | null;
}

export interface RankedFirm {
  firm: QueueFirm;
  hardRejected: boolean;
  // True when the shared computeHardScreen verdict says the firm was
  // screened out. Both queue partition and header/badge label read from
  // the same function so they can't disagree.
  hardScreened: boolean;
  // Human-readable reason (base rule name / rule predicate / disposition
  // string) — surfaced by the header's "Hard-rejected · <reason>" chip.
  hardScreenReason: string | null;
  terminal: boolean;
  currentScore: number;
  ceiling: number;
  gain: number;
  missingCount: number;
  tier: string;
}

// ─── Active HardScreenConfig ────────────────────────────────────────────

export interface ActiveConfigRule {
  ruleId: string;
  axis: string; // backend vocab (e.g. "deal_size_usd_m", "employees")
  operator: string; // <, <=, >, >=, ==, !=, =, in
  threshold: string; // stringified value; parsed at compare-time
  model: string; // "CF" | "CS" | "both" — case-insensitive
}

// Backend axis vocab → firm field name. Kept close to the finding-axis
// map so a single canonical vocabulary drives all three surfaces
// (findings, rules, hard-screen). Values are stringly-typed so this map
// can include hard-gate fields (hasSTOrBalanceSheet, webActivity, solvent)
// that live on the Firm object but aren't part of the ScoreInput used
// by mirrorScore.
const AXIS_TO_FIRM_FIELD: Record<string, string> = {
  services_fit: "servicesFit",
  md_pedigree: "mdPedigree",
  balance_sheet_principal: "balanceSheetPrincipal",
  deal_size: "dealSizeMUsd",
  deal_size_usd_m: "dealSizeMUsd",
  deals_per_md: "dealsPerMdL3y",
  deals_per_md_l3y: "dealsPerMdL3y",
  firm_age: "firmAge",
  firm_age_years: "firmAge",
  fee_generating_count: "feeGeneratingCount",
  employees: "employees",
  coverage_model: "coverageModel",
  geographic_footprint: "geographicFootprint",
  geo_score: "geoScore",
  // The rule engine emits `geography` for geo-fit predicates ("geography
  // < 2"). Firm also has a literal `geography` STRING property ("Italy"),
  // and pointing a numeric predicate at it yields NaN — the rule silently
  // screens nobody. Numeric geo predicates mean the 0-2 geo score, so route
  // this axis there.
  geography: "geoScore",
  advisory_conflict: "advisoryConflict",
  has_st_or_balance_sheet: "hasSTOrBalanceSheet",
  web_activity: "webActivity",
  solvent: "solvent",
};

/**
 * Backend axis vocab → firm field name, or null when the axis is one we
 * can't resolve. Exported so ./activeScreening screens on the SAME
 * vocabulary this module ranks on — two axis maps would be two chances for
 * the desk and /rules to disagree about what a rule targets.
 */
export function firmFieldFor(axis: string): string | null {
  const key = axis.trim().toLowerCase();
  return AXIS_TO_FIRM_FIELD[key] ?? null;
}

function firmModel(firm: QueueFirm): "cf" | "cs" {
  return (firm.firmType ?? "").trim().toLowerCase() === "cs" ? "cs" : "cf";
}

function ruleAppliesToFirm(rule: ActiveConfigRule, firm: QueueFirm): boolean {
  const rm = (rule.model ?? "").trim().toLowerCase();
  if (rm === "" || rm === "both") {
    return true;
  }
  return rm === firmModel(firm);
}

// Numeric comparison when both sides parse as numbers; otherwise
// string-equality. `in` treats the threshold as a JSON array (["a","b"])
// with case-insensitive membership. Unknown operators return false rather
// than throw — a malformed rule shouldn't crash the desk.
function ruleMatches(firmValue: unknown, operator: string, threshold: string): boolean {
  if (firmValue === null || firmValue === undefined || firmValue === "") {
    // Missing data can't trip a rule — the analyst still needs to enrich.
    return false;
  }
  const op = operator.trim();
  const t = threshold.trim();

  const numV = typeof firmValue === "number" ? firmValue : Number(firmValue);
  const numT = Number(t);
  const numeric = !Number.isNaN(numV) && !Number.isNaN(numT);

  if (numeric) {
    switch (op) {
      case "<":
        return numV < numT;
      case "<=":
        return numV <= numT;
      case ">":
        return numV > numT;
      case ">=":
        return numV >= numT;
      case "=":
      case "==":
        return numV === numT;
      case "!=":
        return numV !== numT;
      default:
        break;
    }
  }

  // Boolean firm fields — advisoryConflict etc. — arrive as true/false.
  if (typeof firmValue === "boolean") {
    const lit = t.toLowerCase();
    const asBool = lit === "true" ? true : lit === "false" ? false : null;
    if (asBool !== null && (op === "=" || op === "==")) {
      return firmValue === asBool;
    }
  }

  const sV = String(firmValue).trim().toLowerCase();
  const sT = t.toLowerCase();
  switch (op) {
    case "=":
    case "==":
      return sV === sT;
    case "!=":
      return sV !== sT;
    case "in": {
      try {
        const arr = JSON.parse(t) as unknown;
        if (Array.isArray(arr)) {
          return arr.map((x) => String(x).trim().toLowerCase()).includes(sV);
        }
      } catch {
        // fall through
      }
      // CSV fallback: "a,b,c"
      return t
        .split(",")
        .map((x) => x.trim().toLowerCase())
        .includes(sV);
    }
    case "contains":
      return sV.includes(sT);
    default:
      return false;
  }
}

function formatRulePredicate(rule: ActiveConfigRule): string {
  const thresholdStr = /^-?\d+(\.\d+)?$/.test(rule.threshold)
    ? rule.threshold
    : `"${rule.threshold}"`;
  return `${rule.axis} ${rule.operator} ${thresholdStr}`;
}

export interface HardScreenVerdict {
  hardScreened: boolean;
  reason: string | null;
  source: "base" | "config" | "disposition" | null;
}

/**
 * The single source of truth for whether a firm is hard-screened. Both the
 * queue's sink partition and the header/badge label call this — they can't
 * disagree.
 *
 * `activeConfigs` should already be filtered to `configActive === true`
 * before it reaches this function; pending / dismissed proposals must
 * never screen.
 */
export function computeHardScreen(
  firm: QueueFirm,
  activeConfigs: readonly ActiveConfigRule[],
): HardScreenVerdict {
  // 1. Client base rules (mirrorScore captures them).
  const mirror = mirrorScore(firm);
  if (mirror.hardRejected) {
    return { hardScreened: true, reason: mirror.rejectReason, source: "base" };
  }
  // 2. Active approved HardScreenConfig rows — evaluate per firm type.
  for (const rule of activeConfigs) {
    if (!ruleAppliesToFirm(rule, firm)) {
      continue;
    }
    const field = firmFieldFor(rule.axis);
    if (field === null) {
      // Rule targets an axis we can't resolve — safest to skip rather
      // than false-positive the firm.
      continue;
    }
    const value = (firm as unknown as Record<string, unknown>)[field];
    if (ruleMatches(value, rule.operator, rule.threshold)) {
      return {
        hardScreened: true,
        reason: formatRulePredicate(rule),
        source: "config",
      };
    }
  }
  // 3. Server disposition — belt-and-braces if the backend flagged the
  // firm via a mechanism the client can't reconstruct locally.
  if (dispositionMarksHardScreen(firm.disposition)) {
    return {
      hardScreened: true,
      reason: (firm.disposition ?? "").trim() || "server-flagged",
      source: "disposition",
    };
  }
  return { hardScreened: false, reason: null, source: null };
}

const ENRICHABLE: { field: keyof ScoreInput; max: number; csOnly?: boolean }[] = [
  { field: "servicesFit", max: 2 },
  { field: "mdPedigree", max: 2 },
  { field: "balanceSheetPrincipal", max: 2, csOnly: true },
  { field: "dealSizeMUsd", max: 2 },
  { field: "dealsPerMdL3y", max: 2 },
  { field: "firmAge", max: 2 },
  { field: "feeGeneratingCount", max: 2 },
];

const TERMINAL_STATES = new Set(["qualified", "rejected"]);

// Disposition strings that indicate the firm was blocked by a hard-screen
// rule, however encoded server-side. Matched case-insensitively as a
// substring so variants like "hard_rejected" / "hard-screened" / "screened
// out" / "reject: sanctions" all light up.
const HARD_SCREEN_TOKENS = ["reject", "screen", "hard"];

function isMissing(v: unknown): boolean {
  return v === null || v === undefined || v === "";
}

function isTerminal(firm: QueueFirm): boolean {
  const life = (firm.lifecycleState ?? "").trim().toLowerCase();
  const stage = (firm.currentStage ?? "").trim().toLowerCase();
  return TERMINAL_STATES.has(life) || TERMINAL_STATES.has(stage);
}

export function dispositionMarksHardScreen(disposition: string | null | undefined): boolean {
  const d = (disposition ?? "").trim().toLowerCase();
  if (d === "") {
    return false;
  }
  return HARD_SCREEN_TOKENS.some((t) => d.includes(t));
}

export function rankFirm(
  firm: QueueFirm,
  activeConfigs: readonly ActiveConfigRule[] = [],
): RankedFirm {
  const res = mirrorScore(firm);
  const model: Model = res.model;
  let missingCount = 0;
  let headroom = 0;
  for (const { field, max, csOnly } of ENRICHABLE) {
    if (csOnly && model !== "CS") {
      continue;
    }
    if (isMissing(firm[field])) {
      missingCount++;
      headroom += max;
    }
  }
  const currentScore = res.hardRejected ? 0 : res.weightedTotal;
  const ceiling = res.hardRejected ? 0 : Math.min(res.maxPossible, currentScore + headroom);
  const gain = Math.max(0, ceiling - currentScore);
  const verdict = computeHardScreen(firm, activeConfigs);
  return {
    firm,
    hardRejected: res.hardRejected,
    hardScreened: verdict.hardScreened,
    hardScreenReason: verdict.reason,
    terminal: isTerminal(firm),
    currentScore,
    ceiling,
    gain,
    missingCount,
    tier: res.tier,
  };
}

export function orderEnrichmentQueue(
  firms: QueueFirm[],
  activeConfigs: readonly ActiveConfigRule[] = [],
): RankedFirm[] {
  return firms
    .map((f) => rankFirm(f, activeConfigs))
    .sort((a, b) => {
      // 1. Hard-screened firms (any lifecycle) sink to the very bottom —
      //    enrichment is worthless because the screen already made the call.
      //    This must run before the terminal check so a Discovered-but-
      //    hard-screened firm doesn't slip into the workable band via a
      //    high fictional "gain".
      if (a.hardScreened !== b.hardScreened) {
        return a.hardScreened ? 1 : -1;
      }
      // 2. Terminal firms (Qualified / Rejected lifecycle) drop below active
      //    work but above hard-screened.
      if (a.terminal !== b.terminal) {
        return a.terminal ? 1 : -1;
      }
      // 3. Among working firms, highest expected gain first — the most points
      //    on the table for one analyst pass.
      if (a.gain !== b.gain) {
        return b.gain - a.gain;
      }
      // 4. Tiebreak: fewer missing fields → closer to a decision.
      if (a.missingCount !== b.missingCount) {
        return a.missingCount - b.missingCount;
      }
      // 5. Deterministic final tiebreak so the order is stable across renders.
      return a.firm.firmId.localeCompare(b.firm.firmId);
    });
}
