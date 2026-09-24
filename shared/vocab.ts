/** Canonical vocabulary shared by the server, the seed generator, and the UI. */

export const USER = "demo-analyst";

export const LIFECYCLE_ORDER = ["Discovered", "In Review", "Outreach", "In Talks"] as const;
export const QUALIFIED = "Qualified";
export const REJECTED = "Rejected";

/** Next forward stage, or null at the end / for terminal or unknown states. */
export function nextLifecycle(state: string | null | undefined): string | null {
  const key = (state ?? "").trim().toLowerCase();
  const idx = LIFECYCLE_ORDER.findIndex((s) => s.toLowerCase() === key);
  if (idx < 0 || idx >= LIFECYCLE_ORDER.length - 1) {
    return null;
  }
  return LIFECYCLE_ORDER[idx + 1];
}

export type Provider = "beacondb" | "dealdb" | "filings" | "websearch";
/** Most- to least-trusted. Reconciliation orders evidence by this. */
export const PROVIDER_TRUST: readonly Provider[] = ["beacondb", "dealdb", "filings", "websearch"];
export const ANALYST = "analyst";
export const AGENT = "agent";

export type AxisKind = "enum" | "number" | "gate";

export interface AxisDef {
  /** Finding vocabulary (snake_case), as the desk's FINDING_AXIS_TO_KEY expects. */
  axis: string;
  /** Firm property the value lands in. */
  firmField: string;
  /** enrichFirm parameter name (differs from firmField only for hasSTOrBalanceSheet). */
  actionParam: string;
  kind: AxisKind;
  models: readonly ("CF" | "CS")[];
}

const BOTH = ["CF", "CS"] as const;

export const ENRICH_AXES: readonly AxisDef[] = [
  {
    axis: "services_fit",
    firmField: "servicesFit",
    actionParam: "servicesFit",
    kind: "enum",
    models: BOTH,
  },
  {
    axis: "md_pedigree",
    firmField: "mdPedigree",
    actionParam: "mdPedigree",
    kind: "enum",
    models: BOTH,
  },
  {
    axis: "balance_sheet_principal",
    firmField: "balanceSheetPrincipal",
    actionParam: "balanceSheetPrincipal",
    kind: "enum",
    models: ["CS"],
  },
  {
    axis: "deal_size_usd_m",
    firmField: "dealSizeMUsd",
    actionParam: "dealSizeMUsd",
    kind: "number",
    models: BOTH,
  },
  {
    axis: "deals_per_md_l3y",
    firmField: "dealsPerMdL3y",
    actionParam: "dealsPerMdL3y",
    kind: "number",
    models: BOTH,
  },
  { axis: "firm_age", firmField: "firmAge", actionParam: "firmAge", kind: "number", models: BOTH },
  {
    axis: "fee_generating_count",
    firmField: "feeGeneratingCount",
    actionParam: "feeGeneratingCount",
    kind: "number",
    models: BOTH,
  },
  {
    axis: "advisory_conflict",
    firmField: "advisoryConflict",
    actionParam: "advisoryConflict",
    kind: "gate",
    models: BOTH,
  },
  {
    axis: "has_st_or_balance_sheet",
    firmField: "hasSTOrBalanceSheet",
    actionParam: "hasStOrBalanceSheet",
    kind: "gate",
    models: BOTH,
  },
  {
    axis: "web_activity",
    firmField: "webActivity",
    actionParam: "webActivity",
    kind: "gate",
    models: BOTH,
  },
  { axis: "solvent", firmField: "solvent", actionParam: "solvent", kind: "gate", models: BOTH },
];

export function axisByName(axis: string): AxisDef | undefined {
  return ENRICH_AXES.find((a) => a.axis === axis.trim().toLowerCase());
}

export function axisByActionParam(param: string): AxisDef | undefined {
  return ENRICH_AXES.find((a) => a.actionParam === param);
}

// Rubric v2 band labels, index = level. Must match the desk's option lists and scoreMirror.ts.
export const CF_SERVICES_LABELS = [
  "Conflicted: trading, lending or research",
  "Adjacent advisory services",
  "Full advisory suite",
] as const;
export const CF_MD_LABELS = [
  "Operator / non-finance backgrounds",
  "Mixed: industry or boutique banking",
  "Bulge-bracket or elite-boutique alumni",
] as const;
export const CS_SERVICES_LABELS = [
  "No private-capital products",
  "Some private-capital products",
  "Full private-capital suite",
] as const;
export const CS_MD_LABELS = [
  "Non-finance backgrounds",
  "Some credit or banking experience",
  "Senior credit / capital-markets pedigree",
] as const;
export const CS_BSP_LABELS = [
  "Invests its own balance sheet",
  "Occasional co-investment",
  "Advisory only",
] as const;
/** coverageKey() in the rubric matches on "generalist" / "multi" / "single". */
export const COVERAGE_LABELS = ["Generalist", "Multi-sector", "Single-sector focus"] as const;

export const DECISION = {
  enrich: "enrich",
  accept: "accept",
  adjust: "adjust",
  reject: "reject",
  reEngage: "re_engage",
  advance: "advance",
  keepPassed: "keep_passed",
  activity: "activity",
} as const;

export const ACQUIRED_BY_COMPETITOR = "acquired_by_competitor";
export const OUTCOMES = [
  "converted_to_talks",
  "loi",
  "closed",
  "went_cold",
  ACQUIRED_BY_COMPETITOR,
] as const;

export const OPERATORS = ["<", "<=", ">", ">=", "==", "!="] as const;

/** Firm primary key, same recipe as the original pipeline: name_country, lowercased, alphanumerics only. */
export function firmIdFor(name: string, country: string): string {
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  return `${slug(name)}_${slug(country)}`;
}
