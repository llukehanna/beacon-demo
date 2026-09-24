/**
 * The qualification rubric (v2): nine axes scored 0–2 (max 18), tiers A/B/C/Rejected.
 * Single source of truth. The server persists QualificationScores with it
 * and the Enrichment Desk previews scores with it, so they cannot drift.
 */

export type Model = "CF" | "CS";

export interface ScoreInput {
  firmType?: string | null;
  coverageModel?: string | null;
  servicesFit?: string | null;
  mdPedigree?: string | null;
  balanceSheetPrincipal?: string | null;
  geoScore?: number | null;
  dealSizeMUsd?: number | null;
  dealsPerMdL3y?: number | null;
  firmAge?: number | null;
  employees?: number | null;
  feeGeneratingCount?: number | null;
  geographicFootprint?: string | null;
  advisoryConflict?: boolean | null;
}

export interface AxisScore {
  axis: string;
  score: number;
  band: string;
  known: boolean;
}

export type Tier = "A" | "B" | "C" | "Rejected";
export type Action = "Outreach" | "Follow" | "Enrich" | "Reject";

export interface MirrorResult {
  model: Model;
  hardRejected: boolean;
  rejectReason: string;
  weightedTotal: number;
  maxPossible: number;
  pct: number;
  tier: Tier;
  action: Action;
  confidence: number;
  axisScores: AxisScore[];
}

/** Beacon rubric v2: nine axes scored 0–2. */
export const MAX_POSSIBLE = 18;
export const TIER_THRESHOLDS: Readonly<Record<Model, { A: number; B: number; C: number }>> = {
  CF: { A: 14, B: 10, C: 6 },
  CS: { A: 13, B: 10, C: 6 },
};
/** B-tier firms at or above this total go straight to outreach. */
export const B_OUTREACH_FLOOR = 12;

const COVERAGE: Record<string, number> = { generalist: 0, multi: 1, single: 2 };
const CF_SERVICES: Record<string, number> = {
  "conflicted: trading, lending or research": 0,
  "adjacent advisory services": 1,
  "full advisory suite": 2,
};
const CF_MD: Record<string, number> = {
  "operator / non-finance backgrounds": 0,
  "mixed: industry or boutique banking": 1,
  "bulge-bracket or elite-boutique alumni": 2,
};
const CS_BSP: Record<string, number> = {
  "invests its own balance sheet": 0,
  "occasional co-investment": 1,
  "advisory only": 2,
};
const CS_SERVICES: Record<string, number> = {
  "no private-capital products": 0,
  "some private-capital products": 1,
  "full private-capital suite": 2,
};
const CS_MD: Record<string, number> = {
  "non-finance backgrounds": 0,
  "some credit or banking experience": 1,
  "senior credit / capital-markets pedigree": 2,
};
const CF_HARD_SERVICES = "conflicted: trading, lending or research";
const CS_HARD_BSP = "invests its own balance sheet";

function norm(v: string | null | undefined): string {
  return (v ?? "").trim().toLowerCase();
}

function resolveModel(firmType: string | null | undefined): Model {
  return norm(firmType) === "cs" ? "CS" : "CF";
}

function coverageKey(raw: string | null | undefined): { key: string; known: boolean } {
  const n = norm(raw);
  if (n.includes("generalist")) {
    return { key: "generalist", known: true };
  }
  if (n.includes("multi")) {
    return { key: "multi", known: true };
  }
  if (n.includes("single")) {
    return { key: "single", known: true };
  }
  return { key: "unknown", known: false };
}

function cat(axis: string, map: Record<string, number>, raw: string | null | undefined): AxisScore {
  const hit = map[norm(raw)];
  return hit !== undefined
    ? { axis, score: hit, band: raw as string, known: true }
    : { axis, score: 0, band: "Unknown", known: false };
}

function num(v: number | null | undefined): number | null {
  return v === null || v === undefined || Number.isNaN(v) ? null : v;
}

/** Below `low` → 0, above `high` → 2, otherwise 1. */
function banded(
  axis: string,
  v: number | null | undefined,
  low: number,
  high: number,
  bands: [string, string, string],
): AxisScore {
  const x = num(v);
  if (x === null) {
    return { axis, score: 0, band: "Unknown", known: false };
  }
  if (x < low) {
    return { axis, score: 0, band: bands[0], known: true };
  }
  if (x > high) {
    return { axis, score: 2, band: bands[2], known: true };
  }
  return { axis, score: 1, band: bands[1], known: true };
}

function headcount(axis: string, v: number | null | undefined): AxisScore {
  const x = num(v);
  if (x === null) {
    return { axis, score: 0, band: "Unknown", known: false };
  }
  if (x < 8) {
    return { axis, score: 0, band: "<8", known: true };
  }
  if (x <= 40) {
    return { axis, score: 2, band: "8-40", known: true };
  }
  return { axis, score: 1, band: ">40", known: true };
}

function feeGen(axis: string, v: number | null | undefined): AxisScore {
  const x = num(v);
  if (x === null) {
    return { axis, score: 0, band: "Unknown", known: false };
  }
  if (x < 2) {
    return { axis, score: 0, band: "<2", known: true };
  }
  if (x <= 3) {
    return { axis, score: 1, band: "2-3", known: true };
  }
  return { axis, score: 2, band: ">=4", known: true };
}

function geo(axis: string, v: number | null | undefined): AxisScore {
  const x = num(v);
  if (x === null) {
    return { axis, score: 0, band: "Unknown", known: false };
  }
  const s = Math.max(0, Math.min(2, x));
  return { axis, score: s, band: "geo_score=" + s, known: true };
}

function tierFor(total: number, model: Model): Tier {
  const t = TIER_THRESHOLDS[model];
  if (total >= t.A) {
    return "A";
  }
  if (total >= t.B) {
    return "B";
  }
  if (total >= t.C) {
    return "C";
  }
  return "Rejected";
}

function hardReject(model: Model, input: ScoreInput, coverage: string): string | null {
  if (model === "CF") {
    if (coverage === "generalist") {
      return "Generalist coverage model (CF hard-reject)";
    }
    if (norm(input.servicesFit) === CF_HARD_SERVICES) {
      return "Conflicted services (CF hard-reject)";
    }
    return null;
  }
  if (input.advisoryConflict === true) {
    return "Advisory conflict (CS hard-reject)";
  }
  if (norm(input.balanceSheetPrincipal) === CS_HARD_BSP) {
    return "Principal investor (CS hard-reject)";
  }
  return null;
}

export function mirrorScore(input: ScoreInput): MirrorResult {
  const model = resolveModel(input.firmType);
  const cov = coverageKey(input.coverageModel);

  const rejectReason = hardReject(model, input, cov.key);
  if (rejectReason !== null) {
    return {
      model,
      hardRejected: true,
      rejectReason,
      weightedTotal: 0,
      maxPossible: MAX_POSSIBLE,
      pct: 0,
      tier: "Rejected",
      action: "Reject",
      confidence: 1,
      axisScores: [],
    };
  }

  const axes: AxisScore[] = [];
  if (model === "CF") {
    axes.push({
      axis: "Coverage Model",
      score: COVERAGE[cov.key] ?? 0,
      band: cov.known ? (input.coverageModel as string) : "Unknown",
      known: cov.known,
    });
    axes.push(cat("Services", CF_SERVICES, input.servicesFit));
    axes.push(cat("MD Experience", CF_MD, input.mdPedigree));
  } else {
    axes.push(cat("Balance Sheet / Principal", CS_BSP, input.balanceSheetPrincipal));
    axes.push(cat("CS Services Fit", CS_SERVICES, input.servicesFit));
    axes.push(cat("MD Experience", CS_MD, input.mdPedigree));
  }
  axes.push(geo("Geographic Footprint", input.geoScore));
  axes.push(banded("Deal Size", input.dealSizeMUsd, 25, 150, ["<$25m", "$25m-$150m", ">$150m"]));
  axes.push(banded("Deals per MD", input.dealsPerMdL3y, 1.5, 3.5, ["<1.5", "1.5-3.5", ">3.5"]));
  axes.push(banded("Firm Age", input.firmAge, 5, 12, ["<5", "5-12", ">12"]));
  axes.push(headcount("Headcount", input.employees));
  axes.push(feeGen("Fee-Generating", input.feeGeneratingCount));

  const weightedTotal = axes.reduce((s, a) => s + a.score, 0);
  const tier = tierFor(weightedTotal, model);
  const action: Action =
    tier === "A"
      ? "Outreach"
      : tier === "B"
        ? weightedTotal >= B_OUTREACH_FLOOR
          ? "Outreach"
          : "Follow"
        : tier === "C"
          ? "Follow"
          : "Enrich";

  return {
    model,
    hardRejected: false,
    rejectReason: "",
    weightedTotal,
    maxPossible: MAX_POSSIBLE,
    pct: weightedTotal / MAX_POSSIBLE,
    tier,
    action,
    confidence: axes.filter((a) => a.known).length / axes.length,
    axisScores: axes,
  };
}
