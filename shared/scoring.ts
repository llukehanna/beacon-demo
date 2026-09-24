import { type MirrorResult, type ScoreInput, mirrorScore } from "./scoreMirror.js";
import type { AxisDef } from "./vocab.js";

export const RUBRIC_VERSION = "rubric-v1";
export const THESIS_VERSION = "thesis-v1";

type FirmLike = Readonly<Record<string, unknown>>;

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const bool = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);

export function firmModel(firm: FirmLike): "CF" | "CS" {
  return (str(firm.firmType) ?? "").trim().toLowerCase() === "cs" ? "CS" : "CF";
}

export function scoreInputFromFirm(firm: FirmLike): ScoreInput {
  return {
    firmType: str(firm.firmType),
    coverageModel: str(firm.coverageModel),
    servicesFit: str(firm.servicesFit),
    mdPedigree: str(firm.mdPedigree),
    balanceSheetPrincipal: str(firm.balanceSheetPrincipal),
    geoScore: num(firm.geoScore),
    dealSizeMUsd: num(firm.dealSizeMUsd),
    dealsPerMdL3y: num(firm.dealsPerMdL3y),
    firmAge: num(firm.firmAge),
    employees: num(firm.employees),
    feeGeneratingCount: num(firm.feeGeneratingCount),
    geographicFootprint: str(firm.geographicFootprint),
    advisoryConflict: bool(firm.advisoryConflict),
  };
}

export function scoreFirm(firm: FirmLike): MirrorResult {
  return mirrorScore(scoreInputFromFirm(firm));
}

/** Parse a finding's string value into the firm field's type. */
export function parseAxisValue(axis: AxisDef, raw: string): string | number | boolean | null {
  const s = raw.trim();
  if (s === "") {
    return null;
  }
  if (axis.kind === "number") {
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  if (axis.kind === "gate") {
    const l = s.toLowerCase();
    if (["yes", "true", "y", "1"].includes(l)) {
      return true;
    }
    if (["no", "false", "n", "0"].includes(l)) {
      return false;
    }
    return null;
  }
  return s;
}

export function formatAxisValue(v: string | number | boolean): string {
  return String(v);
}

// Finding axis → rubric axis label per model (null = not scored for that model).
const RUBRIC_AXIS: Readonly<Record<string, { CF: string | null; CS: string | null }>> = {
  services_fit: { CF: "Services", CS: "CS Services Fit" },
  md_pedigree: { CF: "MD Experience", CS: "MD Experience" },
  balance_sheet_principal: { CF: null, CS: "Balance Sheet / Principal" },
  deal_size_usd_m: { CF: "Deal Size", CS: "Deal Size" },
  deals_per_md_l3y: { CF: "Deals per MD", CS: "Deals per MD" },
  firm_age: { CF: "Firm Age", CS: "Firm Age" },
  fee_generating_count: { CF: "Fee-Generating", CS: "Fee-Generating" },
};

/**
 * Points (0–2) a single value earns on its rubric axis, scored in isolation
 * so other fields can't mask it. Null for gates, unrecognized values, and
 * axes the firm's model doesn't score. Used for ResearchFinding.normalizedScore.
 */
export function axisPoints(
  firm: FirmLike,
  axis: AxisDef,
  value: string | number | boolean | null,
): number | null {
  const model = firmModel(firm);
  const label = RUBRIC_AXIS[axis.axis]?.[model] ?? null;
  if (label === null || value === null) {
    return null;
  }
  const input = { firmType: model, [axis.firmField]: value } as ScoreInput;
  const r = mirrorScore(input);
  if (r.hardRejected) {
    return 0;
  } // the value itself is a disqualifier (CF S&T services)
  const hit = r.axisScores.find((a) => a.axis === label);
  return hit !== undefined && hit.known ? hit.score : null;
}
