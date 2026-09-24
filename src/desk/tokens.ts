/**
 * Beacon tokens — Nocturne (dark navy + teal accent), sourced from
 * design/beacon-enrichment-desk-direction/project/nocturne-scoped.css
 * and dataProvider.js. Semantic colors here are for JS-only cases (tier
 * badges, band chips, confidence chips). Layout tokens are read from CSS
 * variables (see nocturne.css) via var(--color-*), var(--space-*), etc.
 */

// Tier palette — matches dataProvider.tierFromScore output.
export const TIER_COLOR: Record<string, string> = {
  A: "#57b98a",
  B: "#cba24f",
  C: "#cf7070",
  Rejected: "#8a8d99",
};

// Tier labels — note "Rejected" here means "weighted score below C" (a
// soft state that enrichment can move). "Hard-rejected" is a separate
// display state reserved for firms actually screened out (base rule or
// active approved HardScreenConfig row); it's decided at the render
// site, not looked up here, so a low-score firm doesn't accidentally
// read as "hard-rejected" when the screen never fired.
export const TIER_LABEL: Record<string, string> = {
  A: "Strong fit",
  B: "Moderate fit",
  C: "Weak fit",
  Rejected: "Rejected",
};

// Per-axis 0/1/2 band chip — matches support.js:bandChip().
export const BAND_COLOR: Record<number, { fg: string; bg: string }> = {
  0: { fg: "#e79191", bg: "rgba(207,112,112,.16)" },
  1: { fg: "#e6c878", bg: "rgba(203,162,79,.16)" },
  2: { fg: "#8fe3c0", bg: "rgba(87,185,138,.16)" },
};

// confidenceTier chip — matches dataProvider.CONFIDENCE.
export const CONFIDENCE_CHIP: Record<string, { label: string; fg: string; bg: string }> = {
  high: { label: "High", fg: "#9be9ca", bg: "rgba(87,185,138,.20)" },
  low: { label: "Low", fg: "#f2d488", bg: "rgba(203,162,79,.22)" },
  abstain: { label: "Abstain", fg: "#f4abab", bg: "rgba(207,112,112,.24)" },
};

// findingStatus chip — matches dataProvider.FINDING.
export const FINDING_CHIP: Record<string, { label: string; fg: string; bg: string }> = {
  proposed: { label: "Proposed", fg: "#9ecbf2", bg: "rgba(74,144,217,.20)" },
  verified: { label: "Verified", fg: "#9be9ca", bg: "rgba(87,185,138,.20)" },
  abstained: { label: "Abstained", fg: "#f4abab", bg: "rgba(207,112,112,.24)" },
  rejected: { label: "Rejected", fg: "#aab0bd", bg: "rgba(120,125,140,.18)" },
};

// Human-readable provider labels — keys match server/enrichment/providers.ts.
export const PROVIDER_LABEL: Record<string, string> = {
  beacondb: "BeaconDB",
  dealdb: "Deal DB",
  filings: "Filings",
  websearch: "Web search",
  analyst: "Analyst",
  agent: "Agent",
};

/** Label a provider key, including corroboration keys like "dealdb+websearch". */
export function providerLabel(raw: string): string {
  return raw
    .split("+")
    .map((k) => PROVIDER_LABEL[k] ?? k)
    .join(" + ");
}

// Body-void background — the design paints the outer void one step darker
// than the surface token (--color-bg #161826). Everything inside the desk
// still reads from --color-* variables.
export const VOID_BG = "#0f1118";

// Accent-tinted danger for reject buttons — the design uses this color-mix
// for the reject secondary button border.
export const REJECT_BORDER = "color-mix(in srgb, #cf7070 42%, transparent)";
export const REJECT_TEXT = "#e79191";
export const REJECT_ICON = "#f4abab";

// Commit-success (green) for the "your call · advance" primary action.
export const SUCCESS_TEXT = "#9be9ca";
export const SUCCESS_TINT_BG = "rgba(87,185,138,.20)";
export const SUCCESS_TINT_BORDER = "color-mix(in srgb, #57b98a 30%, transparent)";

// ─── Observed outcome (post-decision) ───────────────────────────────────
// Firm.outcome is backfilled by the FDE against decided firms; null on
// firms not yet observed. Rendered as a chip on the desk header, the
// pipeline detail rail, and aggregated on /accuracy. Vocabulary is the
// backend's snake_case; the labels are the display strings.

export const OUTCOME_LABEL: Record<string, string> = {
  converted_to_talks: "Converted to talks",
  loi: "LOI",
  went_cold: "Went cold",
  acquired_by_competitor: "Acquired by competitor",
};

// The one outcome that reads as a miss for a firm we passed — carries a
// muted red tint on chips and drives the /accuracy headline count.
export const OUTCOME_ACQUIRED = "acquired_by_competitor";

export function outcomeLabel(raw: string | null | undefined): string {
  if (raw === null || raw === undefined) {
    return "Not yet observed";
  }
  const key = raw.trim().toLowerCase();
  if (key === "") {
    return "Not yet observed";
  }
  return OUTCOME_LABEL[key] ?? raw;
}

// ─── Drift trigger vocabulary ───────────────────────────────────────────
// Three triggers today, each with a distinct visual anchor so the analyst
// can scan the review queue and read "why did this surface?" at a glance
// without opening the card:
//   tier_moved              → red     (score dropped past a tier boundary)
//   pass_reason_invalidated → amber   (an axis behind the pass changed)
//   outcome_diverged        → violet  (we passed, market didn't)
// Colors deliberately don't overlap the amber/red pair — a fourth trigger
// would need its own hue rather than reusing one of the existing three.
// Shared by /review and the Home "needs you" card so the violet reads as
// one vocabulary across both surfaces.

export interface DriftReasonStyle {
  label: string;
  fg: string;
  bg: string;
  border: string;
}

// The divergence violet, named so non-chip surfaces (Home's preview line,
// the outcome tile on the trust panel) can reach for the same values.
export const DIVERGENCE_FG = "#c9a9f7";
export const DIVERGENCE_BG = "rgba(155,127,224,.16)";
export const DIVERGENCE_BORDER = "color-mix(in srgb, #9b7fe0 40%, transparent)";

// The one-clause telling of the divergence story — reused verbatim by the
// Home card so the two surfaces don't drift apart in wording.
export const DIVERGENCE_PHRASE = "we passed, market didn't";

export const DRIFT_REASON_STYLE: Record<string, DriftReasonStyle> = {
  tier_moved: {
    label: "Tier moved",
    fg: "#e79191",
    bg: "rgba(207,112,112,.16)",
    border: "color-mix(in srgb, #cf7070 32%, transparent)",
  },
  pass_reason_invalidated: {
    label: "Pass reason invalidated",
    fg: "#e6c878",
    bg: "rgba(203,162,79,.16)",
    border: "color-mix(in srgb, #cba24f 32%, transparent)",
  },
  outcome_diverged: {
    label: `Outcome diverged — ${DIVERGENCE_PHRASE}`,
    fg: DIVERGENCE_FG,
    bg: DIVERGENCE_BG,
    border: DIVERGENCE_BORDER,
  },
};

export function driftReasonPresentation(raw: string | undefined): DriftReasonStyle {
  const key = (raw ?? "").toLowerCase();
  if (DRIFT_REASON_STYLE[key]) {
    return DRIFT_REASON_STYLE[key];
  }
  return {
    label: raw ?? "unknown reason",
    fg: "color-mix(in srgb, var(--color-text) 62%, transparent)",
    bg: "var(--color-neutral-800)",
    border: "var(--color-divider)",
  };
}

export function isOutcomeDivergence(raw: string | undefined): boolean {
  return (raw ?? "").trim().toLowerCase() === "outcome_diverged";
}

export function outcomeChipStyle(raw: string | null | undefined): {
  fg: string;
  bg: string;
  border: string;
} {
  const key = (raw ?? "").trim().toLowerCase();
  if (key === OUTCOME_ACQUIRED) {
    // Divergence violet — a firm we passed that the market bought IS the
    // outcome_diverged story, just observed on the firm rather than in the
    // review queue. Same hue on both surfaces so the thread is legible.
    // Red stays reserved for rejection.
    return {
      fg: DIVERGENCE_FG,
      bg: DIVERGENCE_BG,
      border: DIVERGENCE_BORDER,
    };
  }
  return {
    fg: "color-mix(in srgb, var(--color-text) 68%, transparent)",
    bg: "var(--color-neutral-800)",
    border: "color-mix(in srgb, var(--color-text) 18%, transparent)",
  };
}
