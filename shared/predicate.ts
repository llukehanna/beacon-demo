/**
 * Hard-screen predicate evaluation for the server (rule proposals and
 * projected screen counts). Same semantics as the desk's queue.ts
 * ruleMatches: numeric compare when both sides parse, case-insensitive
 * string equality otherwise, and a missing value never screens a firm.
 */
import { OPERATORS } from "./vocab.js";

export interface Predicate {
  axis: string;
  operator: string;
  threshold: string;
  model?: string | null;
}

const AXIS_FIELD: Readonly<Record<string, string>> = {
  employees: "employees",
  deal_size_usd_m: "dealSizeMUsd",
  deals_per_md_l3y: "dealsPerMdL3y",
  firm_age: "firmAge",
  fee_generating_count: "feeGeneratingCount",
  geo_score: "geoScore",
  coverage_model: "coverageModel",
};

export const PREDICATE_AXES = Object.keys(AXIS_FIELD) as readonly string[];

export function predicateField(axis: string): string | null {
  return AXIS_FIELD[axis.trim().toLowerCase()] ?? null;
}

export function ruleKey(
  axis?: string | null,
  operator?: string | null,
  threshold?: string | null,
  model?: string | null,
): string {
  return [axis, operator, threshold, model || "both"]
    .map((s) => (s ?? "").trim().toLowerCase())
    .join("|");
}

export function matchesPredicate(firm: Readonly<Record<string, unknown>>, p: Predicate): boolean {
  const scope = (p.model ?? "").trim().toLowerCase();
  const firmScope =
    String(firm.firmType ?? "")
      .trim()
      .toLowerCase() === "cs"
      ? "cs"
      : "cf";
  if (scope !== "" && scope !== "both" && scope !== firmScope) {
    return false;
  }

  const field = predicateField(p.axis);
  if (field === null || !(OPERATORS as readonly string[]).includes(p.operator.trim())) {
    return false;
  }
  const value = firm[field];
  if (value === null || value === undefined || value === "") {
    return false;
  }

  const op = p.operator.trim();
  const t = p.threshold.trim();
  const a = typeof value === "number" ? value : Number(value);
  const b = Number(t);
  if (Number.isFinite(a) && Number.isFinite(b) && t !== "") {
    switch (op) {
      case "<":
        return a < b;
      case "<=":
        return a <= b;
      case ">":
        return a > b;
      case ">=":
        return a >= b;
      case "==":
        return a === b;
      case "!=":
        return a !== b;
    }
  }
  const eq = String(value).trim().toLowerCase() === t.toLowerCase();
  if (op === "==") {
    return eq;
  }
  if (op === "!=") {
    return !eq;
  }
  return false;
}
