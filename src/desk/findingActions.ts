// Pure helpers for wiring Findings-panel Accept / Verify buttons into the
// analyst's edit map. Kept out of Desk.tsx so the conflict-detection logic
// is unit-testable without a React harness.
import { type FindingLike, isVerifiedFinding, pickAuthoritative } from "./axisState";

// Canonical axis vocabulary lives server-side (snake_case English). Older
// short forms stay as aliases so a mixed backlog still routes cleanly when
// the analyst clicks Accept. Hard-gate axes route to the WRITE key expected
// by enrichFirmAction (hasStOrBalanceSheet — action spelling), not the SDK
// READ key (hasSTOrBalanceSheet) — the edit map is applied to the action.
export const FINDING_AXIS_TO_KEY: Record<string, string> = {
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
  advisory_conflict: "advisoryConflict",
  has_st_or_balance_sheet: "hasStOrBalanceSheet",
  st_or_balance_sheet: "hasStOrBalanceSheet",
  web_activity: "webActivity",
  solvent: "solvent",
};

// Per-hard-gate display polarity — which stored boolean reads as "Pass"
// (cleared) for the analyst. Two of the four gates invert. Storage stays
// the same boolean the ontology already speaks; UI copy is uniform Pass /
// Fail. Single source of truth so a new gate can't ship ambiguous.
export const HARD_GATE_PASS_WHEN: Record<string, boolean> = {
  advisoryConflict: false,
  hasStOrBalanceSheet: false,
  webActivity: true,
  solvent: true,
};

// Edit-map keys whose analyst input is a boolean (hard gates). Derived
// from HARD_GATE_PASS_WHEN so adding a gate only touches one place.
export const HARD_GATE_EDIT_KEYS = new Set(Object.keys(HARD_GATE_PASS_WHEN));

// Edit keys that must be numeric when passed into enrichFirmAction. Kept in
// sync with NUMERIC_KEYS in Desk.tsx (single source of truth would be
// nicer but would drag more of the desk into this module).
export const NUMERIC_EDIT_KEYS = new Set([
  "dealSizeMUsd",
  "dealsPerMdL3y",
  "firmAge",
  "feeGeneratingCount",
  "employees",
]);

// Edit keys the rubric treats as enums — the "needs you" input should
// render a select, not a text box. Options themselves live in Desk.tsx
// (they depend on CF/CS model context); this set only says "which axes
// are enum-shaped."
export const ENUM_EDIT_KEYS = new Set([
  "servicesFit",
  "mdPedigree",
  "balanceSheetPrincipal",
  "coverageModel",
]);

// Unit hints for numeric axes — attached to the number input so the
// analyst isn't guessing whether "150" means dollars, millions, or L3Y
// counts.
export const NUMERIC_UNIT: Record<string, string> = {
  dealSizeMUsd: "$m USD",
  dealsPerMdL3y: "per MD, L3Y",
  firmAge: "yrs",
  feeGeneratingCount: "MDs",
  employees: "employees",
};

export type AxisInputKind = "boolean" | "number" | "enum" | "text";

// Resolve the input shape for an "axis abstained — needs you" cell. The
// axis argument accepts either the raw finding vocab (snake_case) or the
// canonical edit key — findings arrive as raw, but callers already holding
// an edit key shouldn't have to re-normalize.
export function axisInputKind(axisOrEditKey: string): AxisInputKind {
  const editKey = FINDING_AXIS_TO_KEY[(axisOrEditKey ?? "").trim().toLowerCase()] ?? axisOrEditKey;
  if (HARD_GATE_EDIT_KEYS.has(editKey)) {
    return "boolean";
  }
  if (NUMERIC_EDIT_KEYS.has(editKey)) {
    return "number";
  }
  if (ENUM_EDIT_KEYS.has(editKey)) {
    return "enum";
  }
  return "text";
}

// Firm READ keys don't always match edit keys — hasStOrBalanceSheet is the
// action spelling; hasSTOrBalanceSheet is the SDK spelling. Only one axis
// differs today.
const EDIT_KEY_TO_READ_KEY: Record<string, string> = {
  hasStOrBalanceSheet: "hasSTOrBalanceSheet",
};

export function readKeyFor(editKey: string): string {
  return EDIT_KEY_TO_READ_KEY[editKey] ?? editKey;
}

// Coerce a finding's raw string value into the shape enrichFirmAction expects
// for this axis. Returns undefined when the value can't be routed — the
// caller must surface that instead of silently no-op'ing.
export function coerceFindingValue(
  editKey: string,
  raw: string | null | undefined,
): string | number | boolean | undefined {
  if (raw === null || raw === undefined) {
    return undefined;
  }
  const trimmed = raw.trim();
  if (trimmed === "") {
    return undefined;
  }
  if (HARD_GATE_EDIT_KEYS.has(editKey)) {
    const s = trimmed.toLowerCase();
    if (s === "yes" || s === "true" || s === "y" || s === "1") {
      return true;
    }
    if (s === "no" || s === "false" || s === "n" || s === "0") {
      return false;
    }
    return undefined;
  }
  if (NUMERIC_EDIT_KEYS.has(editKey)) {
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : undefined;
  }
  return trimmed;
}

// Loose current-value read: prefer the analyst's in-progress edit, else
// fall back to whatever's persisted on the firm. Returns null/undefined
// verbatim so the caller can tell "unset" from "explicitly false".
export function effectiveAxisValue(
  firm: Record<string, unknown>,
  edits: Record<string, string | number | boolean>,
  editKey: string,
): string | number | boolean | null | undefined {
  if (Object.prototype.hasOwnProperty.call(edits, editKey)) {
    return edits[editKey];
  }
  const v = firm[readKeyFor(editKey)];
  return v as string | number | boolean | null | undefined;
}

// Normalized "is there an analyst-provided value here?" check. Empty strings
// and null/undefined all read as "unset"; a legitimate `false` on a hard
// gate counts as set.
function hasValue(v: unknown): boolean {
  if (v === null || v === undefined) {
    return false;
  }
  if (typeof v === "string" && v.trim() === "") {
    return false;
  }
  return true;
}

// Compare two axis values loosely enough that "150" and 150 match, and
// "Yes"/true don't cross wires — hard gates coerce upstream so both sides
// are booleans by the time they reach here.
function valuesMatch(
  a: string | number | boolean | null | undefined,
  b: string | number | boolean | null | undefined,
): boolean {
  if (a === b) {
    return true;
  }
  if (typeof a === "number" || typeof b === "number") {
    return Number(a) === Number(b);
  }
  return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
}

export type AcceptDecision =
  | { kind: "apply"; editKey: string; value: string | number | boolean }
  | {
      kind: "conflict";
      editKey: string;
      mine: string | number | boolean;
      theirs: string | number | boolean;
    }
  | { kind: "unroutable"; reason: "unknown-axis" | "uncoercible-value" };

// Decide what should happen when the analyst clicks Accept on a proposed
// finding. Never silently no-ops on conflict — the caller must render the
// Keep-mine / Take-agent's choice when kind === "conflict".
export function decideAccept(
  finding: { axis?: string | null; value?: string | null },
  current: string | number | boolean | null | undefined,
): AcceptDecision {
  const rawAxis = (finding.axis ?? "").trim().toLowerCase();
  const editKey = FINDING_AXIS_TO_KEY[rawAxis];
  if (editKey === undefined) {
    return { kind: "unroutable", reason: "unknown-axis" };
  }
  const theirs = coerceFindingValue(editKey, finding.value ?? "");
  if (theirs === undefined) {
    return { kind: "unroutable", reason: "uncoercible-value" };
  }
  if (!hasValue(current) || valuesMatch(current, theirs)) {
    return { kind: "apply", editKey, value: theirs };
  }
  return {
    kind: "conflict",
    editKey,
    mine: current as string | number | boolean,
    theirs,
  };
}

// Verify semantics: "confirm the current value as human-checked (writing
// it if absent)". If the axis is empty, write the finding value; if it
// already matches, no-op on the write; if it differs, don't overwrite —
// surface a conflict so the analyst chooses (same UI as Accept).
export function decideVerify(
  finding: { axis?: string | null; value?: string | null },
  current: string | number | boolean | null | undefined,
): AcceptDecision {
  const rawAxis = (finding.axis ?? "").trim().toLowerCase();
  const editKey = FINDING_AXIS_TO_KEY[rawAxis];
  if (editKey === undefined) {
    return { kind: "unroutable", reason: "unknown-axis" };
  }
  const theirs = coerceFindingValue(editKey, finding.value ?? "");
  if (theirs === undefined) {
    return { kind: "unroutable", reason: "uncoercible-value" };
  }
  if (!hasValue(current)) {
    return { kind: "apply", editKey, value: theirs };
  }
  if (valuesMatch(current, theirs)) {
    return { kind: "apply", editKey, value: theirs };
  }
  return {
    kind: "conflict",
    editKey,
    mine: current as string | number | boolean,
    theirs,
  };
}

// Rebuild the staged-edit baseline from human-verified findings.
//
// Clicking Verify stages the finding's value into the edit map AND marks
// the finding verified server-side — but the edit map is session state.
// A reload (or navigating away and back) keeps the finding verified while
// silently dropping its value from the preview score and the commit
// payload: the desk then shows "9 verified" next to blank axes, and Commit
// enrichment has nothing to send. This derives the edits a fresh session
// must re-stage: for every axis whose authoritative finding is verified
// and which currently has no value, stage the finding's value again.
// Persisted firm fields and in-session analyst edits always win — only
// unset axes are filled — so callers can re-run this until it returns [].
// Conflict-grouped findings are excluded: staging their values is the
// resolve flow's job, not the baseline's.
export function verifiedBaselineEdits(
  findings: readonly FindingLike[],
  getCurrent: (editKey: string) => string | number | boolean | null | undefined,
): Array<{ editKey: string; value: string | number | boolean }> {
  const byAxis = new Map<string, FindingLike[]>();
  for (const f of findings) {
    if ((f.findingStatus ?? "").toLowerCase() === "superseded") {
      continue;
    }
    const gid = f.conflictGroupId;
    if (gid !== null && gid !== undefined && gid !== "") {
      continue;
    }
    const axis = (f.axis ?? "").trim().toLowerCase();
    if (FINDING_AXIS_TO_KEY[axis] === undefined) {
      continue;
    }
    const arr = byAxis.get(axis) ?? [];
    arr.push(f);
    byAxis.set(axis, arr);
  }

  const out: Array<{ editKey: string; value: string | number | boolean }> = [];
  for (const [axis, arr] of byAxis) {
    const auth = pickAuthoritative(arr);
    if (!isVerifiedFinding(auth)) {
      continue;
    }
    const editKey = FINDING_AXIS_TO_KEY[axis];
    const value = coerceFindingValue(editKey, auth.value ?? "");
    if (value === undefined) {
      continue;
    }
    if (hasValue(getCurrent(editKey))) {
      continue;
    }
    out.push({ editKey, value });
  }
  return out;
}

// Coerce a raw finding value string through the axis's expected type and
// render it via formatAxisValue. This is the ONE entry point for showing
// a finding.value to the analyst — every card that renders one (proposed,
// history, abstained, conflict pair) should call this so gate findings
// never leak "true / false" or "yes / no" into the UI. When the axis
// isn't routable or the value can't be coerced, we fall through to the
// raw string so malformed backend data still shows *something* to the
// analyst instead of an empty cell.
export function displayFindingValue(
  rawAxis: string | null | undefined,
  rawValue: string | null | undefined,
): string {
  const raw = (rawValue ?? "").trim();
  if (raw === "") {
    return "—";
  }
  const axisKey = (rawAxis ?? "").trim().toLowerCase();
  const editKey = FINDING_AXIS_TO_KEY[axisKey];
  if (editKey === undefined) {
    return raw;
  }
  const coerced = coerceFindingValue(editKey, raw);
  if (coerced === undefined) {
    return raw;
  }
  return formatAxisValue(editKey, coerced);
}

// Human-facing rendering of a hard-gate boolean vs a scored string. Kept
// symmetric between "mine" and "theirs" in the conflict prompt copy. Hard
// gates read as Pass / Fail per their polarity — the raw booleans never
// leak into analyst copy.
export function formatAxisValue(
  editKey: string,
  v: string | number | boolean | null | undefined,
): string {
  if (v === null || v === undefined || v === "") {
    return "—";
  }
  if (HARD_GATE_EDIT_KEYS.has(editKey)) {
    if (typeof v !== "boolean") {
      return String(v);
    }
    const passWhen = HARD_GATE_PASS_WHEN[editKey];
    return v === passWhen ? "Pass" : "Fail";
  }
  return String(v);
}
