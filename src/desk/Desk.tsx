import React from "react";
import { useSearchParams } from "react-router-dom";
import { useLinks, useObservableClient, useOsdkAction, useOsdkObjects } from "@/data/hooks";
import {
  Firm,
  HardScreenConfig,
  Mandate,
  ProposedRule,
  ResearchFinding,
  ReviewDecision,
  Search,
  advanceStageAction,
  enrichFirmAction,
  qualifyFirmAction,
  rejectFirmAction,
  resolveConflictAction,
  runAgentEnrichmentAction,
  verifyFindingAction,
} from "@/data/ontology";
import { Segmented } from "./Segmented";
import {
  type ScreeningRule,
  isLiveQueueFirm,
  screenFirm,
  toScreeningRules,
} from "./activeScreening";
// Axis-level classification is shared with Home, which counts "awaiting
// judgment" firms using this exact grouping rule.
import {
  type AxisGroup,
  type FindingLike,
  classifyAxis,
  pickAuthoritative,
  retrievedMs,
} from "./axisState";
import {
  type AcceptDecision,
  FINDING_AXIS_TO_KEY,
  HARD_GATE_EDIT_KEYS,
  HARD_GATE_PASS_WHEN,
  NUMERIC_UNIT,
  axisInputKind,
  coerceFindingValue,
  decideAccept,
  decideVerify,
  displayFindingValue,
  effectiveAxisValue,
  formatAxisValue,
  verifiedBaselineEdits,
} from "./findingActions";
import { BrandMark, WorkspaceNavLinks } from "./nav";
import "./nocturne.css";
// "Open" is the funnel's call, not the desk's — see pipelineBuckets.
import { isOpenFirm } from "./pipelineBuckets";
import {
  type ActiveConfigRule,
  type QueueFirm,
  type RankedFirm,
  computeHardScreen,
  orderEnrichmentQueue,
} from "./queue";
import {
  MAX_POSSIBLE,
  type MirrorResult,
  type Model,
  type ScoreInput,
  mirrorScore,
} from "./scoreMirror";
import {
  BAND_COLOR,
  CONFIDENCE_CHIP,
  FINDING_CHIP,
  REJECT_BORDER,
  REJECT_TEXT,
  TIER_COLOR,
  TIER_LABEL,
  VOID_BG,
  outcomeChipStyle,
  outcomeLabel,
  providerLabel,
} from "./tokens";

// ─── Preserved data logic ───────────────────────────────────────────────

interface FirmView {
  firmId?: string;
  firmName?: string | null;
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
  // NB: SDK spells this hasSTOrBalanceSheet; enrichFirmAction param is hasStOrBalanceSheet.
  hasSTOrBalanceSheet?: boolean | null;
  webActivity?: boolean | null;
  solvent?: boolean | null;
  hqCountry?: string | null;
  lifecycleState?: string | null;
  currentStage?: string | null;
  sector?: string | null;
  employeeGroup?: string | null;
  // Read by the header/queue to detect a server-side hard screen driven by
  // an approved HardScreenConfig row (post backend fix). Any string
  // containing "reject" / "screen" / "hard" is treated as hard-screened.
  disposition?: string | null;
}

type EditMap = Record<string, string | number | boolean>;

const NUMERIC_KEYS = ["dealSizeMUsd", "dealsPerMdL3y", "firmAge", "feeGeneratingCount"];

// Canonical axis→edit-key mapping lives in ./findingActions so the accept
// / verify / conflict-detection logic can be unit-tested without React.

// Human labels for the findings section header. Anything not in the map falls
// back to the raw axis key (still readable — the agent vocabulary is
// snake_case English).
const AXIS_DISPLAY_LABEL: Record<string, string> = {
  services_fit: "Services fit",
  md_pedigree: "MD pedigree",
  balance_sheet_principal: "Balance sheet / principal",
  deal_size: "Avg deal size",
  deal_size_usd_m: "Avg deal size",
  deals_per_md: "Deals / MD (L3Y)",
  deals_per_md_l3y: "Deals / MD (L3Y)",
  firm_age: "Firm age",
  firm_age_years: "Firm age",
  fee_generating_count: "Fee-earning heads",
  coverage_model: "Sector coverage",
  geographic_footprint: "Geographic fit",
  employees: "Employees",
  // Hard-gate axes render with the same labels as the HardGates row so
  // the analyst reads one vocabulary. Two spellings for the balance-sheet
  // gate mirror FINDING_AXIS_TO_KEY's alias.
  advisory_conflict: "Advisory conflict",
  has_st_or_balance_sheet: "S&T / balance sheet",
  st_or_balance_sheet: "S&T / balance sheet",
  web_activity: "Web activity",
  solvent: "Solvent",
};

function displayAxis(raw: string | undefined): string {
  if (raw === undefined || raw === "") {
    return "unknown axis";
  }
  return AXIS_DISPLAY_LABEL[raw.trim().toLowerCase()] ?? raw;
}

function toScoreInput(f: FirmView): ScoreInput {
  return {
    firmType: f.firmType,
    coverageModel: f.coverageModel,
    servicesFit: f.servicesFit,
    mdPedigree: f.mdPedigree,
    balanceSheetPrincipal: f.balanceSheetPrincipal,
    geoScore: f.geoScore,
    dealSizeMUsd: f.dealSizeMUsd,
    dealsPerMdL3y: f.dealsPerMdL3y,
    firmAge: f.firmAge,
    employees: f.employees,
    feeGeneratingCount: f.feeGeneratingCount,
    geographicFootprint: f.geographicFootprint,
    advisoryConflict: f.advisoryConflict,
  };
}

function buildMerged(base: ScoreInput, edits: EditMap): ScoreInput {
  const m: ScoreInput = { ...base };
  if (typeof edits.servicesFit === "string" && edits.servicesFit !== "") {
    m.servicesFit = edits.servicesFit;
  }
  if (typeof edits.mdPedigree === "string" && edits.mdPedigree !== "") {
    m.mdPedigree = edits.mdPedigree;
  }
  if (typeof edits.balanceSheetPrincipal === "string" && edits.balanceSheetPrincipal !== "") {
    m.balanceSheetPrincipal = edits.balanceSheetPrincipal;
  }
  if (edits.dealSizeMUsd !== undefined && edits.dealSizeMUsd !== "") {
    m.dealSizeMUsd = Number(edits.dealSizeMUsd);
  }
  if (edits.dealsPerMdL3y !== undefined && edits.dealsPerMdL3y !== "") {
    m.dealsPerMdL3y = Number(edits.dealsPerMdL3y);
  }
  if (edits.firmAge !== undefined && edits.firmAge !== "") {
    m.firmAge = Number(edits.firmAge);
  }
  if (edits.feeGeneratingCount !== undefined && edits.feeGeneratingCount !== "") {
    m.feeGeneratingCount = Number(edits.feeGeneratingCount);
  }
  if (typeof edits.advisoryConflict === "boolean") {
    m.advisoryConflict = edits.advisoryConflict;
  }
  return m;
}

// ─── Axis editor config ─────────────────────────────────────────────────

interface CatOption {
  score: 0 | 1 | 2;
  label: string;
}

const CF_SERVICES_OPTS: CatOption[] = [
  { score: 0, label: "Conflicted: trading, lending or research" },
  { score: 1, label: "Adjacent advisory services" },
  { score: 2, label: "Full advisory suite" },
];
const CF_MD_OPTS: CatOption[] = [
  { score: 0, label: "Operator / non-finance backgrounds" },
  { score: 1, label: "Mixed: industry or boutique banking" },
  { score: 2, label: "Bulge-bracket or elite-boutique alumni" },
];
const CS_SERVICES_OPTS: CatOption[] = [
  { score: 0, label: "No private-capital products" },
  { score: 1, label: "Some private-capital products" },
  { score: 2, label: "Full private-capital suite" },
];
const CS_MD_OPTS: CatOption[] = [
  { score: 0, label: "Non-finance backgrounds" },
  { score: 1, label: "Some credit or banking experience" },
  { score: 2, label: "Senior credit / capital-markets pedigree" },
];
const CS_BSP_OPTS: CatOption[] = [
  { score: 0, label: "Invests its own balance sheet" },
  { score: 1, label: "Occasional co-investment" },
  { score: 2, label: "Advisory only" },
];

interface AxisEditor {
  editKey: string;
  kind: "categorical" | "number";
  options?: CatOption[];
  unit?: string;
}

function editorForAxis(axisLabel: string, model: Model): AxisEditor | undefined {
  switch (axisLabel) {
    case "Services":
      return { editKey: "servicesFit", kind: "categorical", options: CF_SERVICES_OPTS };
    case "CS Services Fit":
      return { editKey: "servicesFit", kind: "categorical", options: CS_SERVICES_OPTS };
    case "MD Experience":
      return {
        editKey: "mdPedigree",
        kind: "categorical",
        options: model === "CS" ? CS_MD_OPTS : CF_MD_OPTS,
      };
    case "Balance Sheet / Principal":
      return { editKey: "balanceSheetPrincipal", kind: "categorical", options: CS_BSP_OPTS };
    case "Deal Size":
      return { editKey: "dealSizeMUsd", kind: "number", unit: "$m USD" };
    case "Deals per MD":
      return { editKey: "dealsPerMdL3y", kind: "number", unit: "per MD, L3Y" };
    case "Firm Age":
      return { editKey: "firmAge", kind: "number", unit: "yrs" };
    case "Fee-Generating":
      return { editKey: "feeGeneratingCount", kind: "number", unit: "MDs" };
    default:
      return undefined;
  }
}

interface HardGate {
  editKey: string;
  readKey: keyof FirmView;
  label: string;
  helper?: string;
  // Which stored boolean reads as "cleared" for this gate. Analyst-facing
  // copy is Pass/Fail (uniform "Pass = cleared"); storage stays the same
  // boolean the ontology already speaks. Two of the four gates invert:
  //   advisoryConflict / hasStOrBalanceSheet: true = has-problem = Fail
  //   webActivity / solvent:                  true = clean = Pass
  passWhen: boolean;
}

// SDK read key is hasSTOrBalanceSheet; action write key is hasStOrBalanceSheet.
// Polarity lives in HARD_GATE_PASS_WHEN (findingActions) so it stays in
// sync with the conflict-prompt formatter and the accept/verify logic.
const HARD_GATES: HardGate[] = [
  {
    editKey: "advisoryConflict",
    readKey: "advisoryConflict",
    label: "Advisory conflict",
    helper: "CS hard-reject",
    passWhen: HARD_GATE_PASS_WHEN.advisoryConflict,
  },
  {
    editKey: "hasStOrBalanceSheet",
    readKey: "hasSTOrBalanceSheet",
    label: "S&T / balance sheet",
    passWhen: HARD_GATE_PASS_WHEN.hasStOrBalanceSheet,
  },
  {
    editKey: "webActivity",
    readKey: "webActivity",
    label: "Web activity",
    passWhen: HARD_GATE_PASS_WHEN.webActivity,
  },
  {
    editKey: "solvent",
    readKey: "solvent",
    label: "Solvent",
    passWhen: HARD_GATE_PASS_WHEN.solvent,
  },
];

// ─── Search filter (rediscovery) ─────────────────────────────────────────
// When the desk is opened from Interpret & run search, ?search=<id> pins
// the queue to that search's firm set. Each firm carries a rediscovery
// signal — new firms have discoveredViaSearchId === this search; existing
// firms (dedupe hits) have absent / different discoveredViaSearchId and
// arrive with prior decision history the analyst should see up front.
type RediscoveryKind = "new" | "rediscovered";
interface RediscoveryInfo {
  kind: RediscoveryKind;
  priorDecisions: number;
}

// Canonical forward-only lifecycle. Advance offers only the immediate next
// state relative to the firm's currentStage / lifecycleState.
// Discovered → In Review → Outreach → In Talks. Qualified and Rejected are
// terminal, reached only via qualifyFirmAction / rejectFirmAction — never Advance.
const LIFECYCLE_ORDER = ["Discovered", "In Review", "Outreach", "In Talks"] as const;
type LifecycleState = (typeof LIFECYCLE_ORDER)[number];

const TERMINAL_STATES = ["Qualified", "Rejected"] as const;

// Render an action error as something an analyst can read and report.
// String(err) on a server error object prints "[object Object]", which
// hides the one thing the banner exists to show. Prefer the message,
// fall back to a JSON dump, and truncate so a nested stack can't flood the
// banner.
function formatActionError(err: unknown): string {
  if (err === null || err === undefined) {
    return "";
  }
  if (typeof err === "string") {
    return err;
  }
  // The server error can be wrapped one level down (e.g. { unknown: {...} }),
  // so check the object itself first, then each direct child.
  const candidates: unknown[] = [err];
  if (typeof err === "object") {
    candidates.push(...Object.values(err as Record<string, unknown>));
  }
  for (const c of candidates) {
    if (c === null || typeof c !== "object") {
      continue;
    }
    const e = c as { message?: unknown; errorName?: unknown };
    const parts: string[] = [];
    if (typeof e.errorName === "string" && e.errorName !== "") {
      parts.push(e.errorName);
    }
    if (typeof e.message === "string" && e.message !== "") {
      parts.push(e.message);
    }
    if (parts.length > 0) {
      const out = parts.join(": ");
      return out.length > 400 ? `${out.slice(0, 400)}…` : out;
    }
  }
  let out: string;
  try {
    out = JSON.stringify(err);
  } catch {
    out = String(err);
  }
  return out.length > 400 ? `${out.slice(0, 400)}…` : out;
}

// Fold whitespace, underscores, and hyphens down to a single space so
// backend variants ("in_review", "In-Review", "In  Review") all match the
// canonical "In Review". Keeps the header + queue in sync with Pipeline's
// bucket derivation — they used to require exact-lowercase match and
// silently misclassified any snake_case lifecycleState.
function foldLifecycle(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, " ");
}

function normalizeLifecycle(raw: string | null | undefined): LifecycleState | null {
  if (raw === null || raw === undefined || raw === "") {
    return null;
  }
  const n = foldLifecycle(raw);
  for (const s of LIFECYCLE_ORDER) {
    if (foldLifecycle(s) === n) {
      return s;
    }
  }
  return null;
}

function isTerminalLifecycle(raw: string | null | undefined): boolean {
  if (raw === null || raw === undefined || raw === "") {
    return false;
  }
  const n = foldLifecycle(raw);
  return TERMINAL_STATES.some((s) => foldLifecycle(s) === n);
}

function nextLifecycle(current: string | null | undefined): LifecycleState | null {
  if (isTerminalLifecycle(current)) {
    return null;
  }
  // Unknown non-terminal states fall back to the first tracked stage.
  const normalized = normalizeLifecycle(current) ?? "Discovered";
  const idx = LIFECYCLE_ORDER.indexOf(normalized);
  if (idx < 0 || idx >= LIFECYCLE_ORDER.length - 1) {
    return null;
  }
  return LIFECYCLE_ORDER[idx + 1];
}

// Human-readable value per axis. Never surface rubric-band expressions
// ("geo_score=2", "8-40", ">$150m") — those are internal to mirrorScore.
function humanAxisValue(axisLabel: string, firm: FirmView): string {
  switch (axisLabel) {
    case "Coverage Model":
      return firm.coverageModel ?? "—";
    case "Services":
    case "CS Services Fit":
      return firm.servicesFit ?? "—";
    case "MD Experience":
      return firm.mdPedigree ?? "—";
    case "Balance Sheet / Principal":
      return firm.balanceSheetPrincipal ?? "—";
    case "Geographic Footprint": {
      const parts: string[] = [];
      if (firm.hqCountry) {
        parts.push(firm.hqCountry);
      }
      if (firm.geographicFootprint && firm.geographicFootprint !== firm.hqCountry) {
        parts.push(firm.geographicFootprint);
      }
      return parts.length > 0 ? parts.join(" · ") : "—";
    }
    case "Deal Size":
      return firm.dealSizeMUsd !== null && firm.dealSizeMUsd !== undefined
        ? `$${firm.dealSizeMUsd}m`
        : "—";
    case "Deals per MD":
      return firm.dealsPerMdL3y !== null && firm.dealsPerMdL3y !== undefined
        ? `${firm.dealsPerMdL3y} deals/MD`
        : "—";
    case "Firm Age":
      return firm.firmAge !== null && firm.firmAge !== undefined ? `${firm.firmAge} yrs` : "—";
    case "Headcount":
      return firm.employees !== null && firm.employees !== undefined
        ? `${firm.employees} employees`
        : "—";
    case "Fee-Generating":
      return firm.feeGeneratingCount !== null && firm.feeGeneratingCount !== undefined
        ? `${firm.feeGeneratingCount} fee-earning heads`
        : "—";
    default:
      return "—";
  }
}

// ─── Small primitives ───────────────────────────────────────────────────

// Word-boundary truncation. Rewinds from a hard character cap back to the
// last space before appending "…" — avoids the mid-word cut ("geographic
// footpri") the character-count truncator produces on tokens without
// spaces near the limit. Falls back to hard cut when there's no space to
// rewind to (rare — a single very long token).
function truncateAtWord(s: string, max: number): string {
  const trimmed = s.trim();
  if (trimmed.length <= max) {
    return trimmed;
  }
  const clipped = trimmed.slice(0, max);
  const lastSpace = clipped.lastIndexOf(" ");
  const cut = lastSpace > max * 0.5 ? clipped.slice(0, lastSpace) : clipped;
  return cut.trimEnd() + "…";
}

// Nocturne kicker — 10-11px uppercase 0.12em tracking, ~45% text.
function Kicker({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}): React.ReactElement {
  return (
    <div
      style={{
        fontSize: 10,
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        color: "color-mix(in srgb, var(--color-text) 45%, transparent)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// Observed-outcome chip. Rendered on the firm header and the pipeline
// detail rail when Firm.outcome is non-null. `acquired_by_competitor`
// renders in muted red — that's the miss story the drift loop exists to
// catch. Null / unknown outcomes render nothing (there's no useful chip
// for "not yet observed" on a single firm — the /accuracy panel handles
// that aggregate).
function OutcomeChip({
  outcome,
  observedAt,
}: {
  outcome: string | null | undefined;
  observedAt: unknown;
}): React.ReactElement | null {
  const raw = (outcome ?? "").trim();
  if (raw === "") {
    return null;
  }
  const style = outcomeChipStyle(raw);
  const label = outcomeLabel(raw);
  const dateStr = formatObservedDate(observedAt);
  const tooltip = dateStr === null ? `Outcome: ${label}` : `Outcome: ${label} · ${dateStr}`;
  return (
    <span
      className="tag"
      title={tooltip}
      style={{
        fontSize: 11,
        padding: "2px 8px",
        borderRadius: "var(--radius-chip)",
        color: style.fg,
        background: style.bg,
        border: `1px solid ${style.border}`,
        fontWeight: 500,
      }}
    >
      Outcome: {label}
      {dateStr !== null && (
        <span style={{ opacity: 0.75, marginLeft: 6, fontWeight: 400 }}>· {dateStr}</span>
      )}
    </span>
  );
}

function formatObservedDate(raw: unknown): string | null {
  if (raw === null || raw === undefined) {
    return null;
  }
  const t = raw instanceof Date ? raw.getTime() : new Date(raw as string | number).getTime();
  if (Number.isNaN(t)) {
    return null;
  }
  const d = new Date(t);
  // "Mar 2026" — matches the user's example.
  return d.toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

// Tier tag — accent-tinted 16% bg, tier-colored text.
function TierTag({ tier }: { tier: string }): React.ReactElement {
  const c = TIER_COLOR[tier] ?? TIER_COLOR.Rejected;
  return (
    <span
      className="tag"
      style={{
        fontSize: 11,
        fontWeight: 600,
        padding: "2px 8px",
        borderRadius: "var(--radius-chip)",
        color: c,
        background: `color-mix(in srgb, ${c} 16%, transparent)`,
      }}
    >
      {tier === "Rejected" ? "R" : tier}
    </span>
  );
}

function BandChip({ band }: { band: 0 | 1 | 2 | null }): React.ReactElement | null {
  if (band === null) {
    return null;
  }
  const c = BAND_COLOR[band];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 18,
        height: 18,
        borderRadius: "var(--radius-chip)",
        fontSize: 11,
        fontWeight: 600,
        fontVariantNumeric: "tabular-nums",
        color: c.fg,
        background: c.bg,
      }}
    >
      {band}
    </span>
  );
}

function ProviderChip({ provider }: { provider?: string }): React.ReactElement {
  // Findings with no provider are analyst-entered — badge them explicitly so
  // no card ever renders a bare em-dash where a source badge should be.
  const raw = provider ?? "";
  const label =
    raw === "" || raw.toLowerCase() === "none" || raw.toLowerCase() === "unknown"
      ? "Analyst"
      : providerLabel(raw);
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        fontSize: 10,
        padding: "2px 7px",
        borderRadius: "var(--radius-chip)",
        color: "color-mix(in srgb, var(--color-text) 62%, transparent)",
        background: "var(--color-neutral-800)",
      }}
    >
      {label}
    </span>
  );
}

function ConfidenceChip({ tier }: { tier?: string }): React.ReactElement {
  const key = (tier ?? "").toLowerCase();
  const known = CONFIDENCE_CHIP[key];
  const c = known ?? {
    label: tier ?? "—",
    fg: "var(--color-text)",
    bg: "var(--color-neutral-800)",
  };
  // "—" appears on analyst-entered rows (no model ran, so no confidence
  // tier). Everything else is the agent's own tier — label that so the
  // chip doesn't read as an unlabeled color swatch.
  const title = known
    ? "source confidence"
    : "n/a: human-entered values carry no model confidence.";
  return (
    <span
      title={title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        fontSize: 10,
        padding: "2px 7px",
        borderRadius: "var(--radius-chip)",
        color: c.fg,
        background: c.bg,
        cursor: "help",
      }}
    >
      {c.label}
    </span>
  );
}

function FindingStatusChip({ status }: { status?: string }): React.ReactElement | null {
  const key = (status ?? "").toLowerCase();
  const c = FINDING_CHIP[key];
  if (!c) {
    return null;
  }
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        fontSize: 10,
        padding: "2px 7px",
        borderRadius: "var(--radius-chip)",
        color: c.fg,
        background: c.bg,
      }}
    >
      {c.label}
    </span>
  );
}

// Score->pct helper — mirrorScore reports weightedTotal/maxPossible (MAX_POSSIBLE),
// design shows a 0-100 percentage.
function pctScore(m: MirrorResult): number {
  return Math.round(m.pct * 100);
}

// Compact per-firm rediscovery badge for the queue row. "new" = firm was
// created by the current search; "rediscovered" = firm already existed
// and was attached (dedupe hit), with N prior decisions in the ontology.
function RediscoveryBadge({ info }: { info: RediscoveryInfo }): React.ReactElement {
  const isNew = info.kind === "new";
  const label = isNew
    ? "new"
    : info.priorDecisions === 0
      ? "in DB"
      : `in DB · ${info.priorDecisions} prior`;
  const title = isNew
    ? "Newly discovered by this search"
    : info.priorDecisions === 0
      ? "Already in the database, no prior decisions on file"
      : `Already in the database — ${info.priorDecisions} prior decision${
          info.priorDecisions === 1 ? "" : "s"
        }`;
  return (
    <span
      title={title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        fontSize: 10,
        padding: "1px 5px",
        borderRadius: "var(--radius-sm)",
        fontWeight: 600,
        letterSpacing: "0.02em",
        color: isNew ? "#9be9ca" : "#c9a9f7",
        background: isNew ? "rgba(87,185,138,.18)" : "rgba(155,127,224,.16)",
        whiteSpace: "nowrap",
        cursor: "help",
      }}
    >
      {label}
    </span>
  );
}

// Top strip on the enrichment desk when the queue is pinned to a Search.
// Reads intent statement, search name / #N, and total member count. The
// "clear" pill drops ?search from the URL, restoring the master queue.
function SearchFilterBar({
  intentText,
  searchName,
  searchIndex,
  memberCount,
  loading,
  onClear,
}: {
  intentText: string;
  searchName?: string | null;
  // 1-based rank of this search under the mandate (freshest = 1). Used
  // when the search has no human-readable name — reads as "Search #2".
  searchIndex?: number;
  memberCount: number;
  loading: boolean;
  onClear: () => void;
}): React.ReactElement {
  const label = (searchName ?? "").trim() || (searchIndex ? `Search #${searchIndex}` : "Search");
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "8px 16px",
        borderBottom: "1px solid var(--color-divider)",
        background: "color-mix(in srgb, var(--color-accent) 6%, transparent)",
        fontSize: 12,
        color: "color-mix(in srgb, var(--color-text) 82%, transparent)",
        flex: "0 0 auto",
      }}
    >
      <span
        style={{
          fontSize: 10,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "var(--color-accent)",
          fontWeight: 600,
        }}
      >
        Filtered
      </span>
      <span
        style={{
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          minWidth: 0,
          flex: 1,
        }}
        title={intentText}
      >
        <strong style={{ fontWeight: 600 }}>Mandate:</strong> {intentText || "—"}
        <span
          style={{
            color: "color-mix(in srgb, var(--color-text) 40%, transparent)",
            margin: "0 6px",
          }}
        >
          ·
        </span>
        {label}
        <span
          style={{
            color: "color-mix(in srgb, var(--color-text) 40%, transparent)",
            margin: "0 6px",
          }}
        >
          ·
        </span>
        {loading ? "loading firms…" : `${memberCount} firm${memberCount === 1 ? "" : "s"}`}
      </span>
      <button
        type="button"
        className="btn btn-ghost"
        style={{ fontSize: 12, padding: "3px 10px" }}
        onClick={onClear}
      >
        Clear
      </button>
    </div>
  );
}

// ─── Queue sidebar ──────────────────────────────────────────────────────

function QueueSidebar({
  queue,
  isLoading,
  selectedId,
  onSelect,
  screeningRules,
  scopeLabel,
  membershipPinned,
  rediscoveryByFirmId,
}: {
  queue: RankedFirm[];
  isLoading: boolean;
  selectedId: string | undefined;
  onSelect: (id: string) => void;
  // Approved rules, already resolved to their effective predicates. Drive
  // both the live-queue partition and the per-row "screened · <rule>" chip.
  screeningRules: readonly ScreeningRule[];
  // "in database" normally; "in search" when a Search pins the desk, so the
  // middle term never claims to describe the whole database while the view
  // is scoped to one search's members.
  scopeLabel: string;
  // True when a search / mandate membership chip scopes the desk. Like the
  // search box, an explicit "show me this set" action bypasses the live-queue
  // narrowing — an analyst reviewing what a search returned needs to see the
  // screened members too, chip and all, not a silently shortened list.
  membershipPinned: boolean;
  // Populated only when the desk is filtered by a Search. Missing entries
  // render no badge — the queue row degrades to its normal appearance.
  rediscoveryByFirmId?: Map<string, RediscoveryInfo>;
}): React.ReactElement {
  const [q, setQ] = React.useState("");
  // Default view is the live queue. The toggle reveals decided and screened
  // firms; it does not change what the search box can reach.
  const [showAll, setShowAll] = React.useState(false);
  const searching = q.trim() !== "";

  // Per-firm screening verdict, computed once for the whole queue and reused
  // by the partition, the counts, and the chip — one evaluation, so a row's
  // chip can't contradict the header that counted it.
  const screenByFirmId = React.useMemo(() => {
    const m = new Map<string, ScreeningRule>();
    for (const r of queue) {
      const res = screenFirm(r.firm as never, screeningRules);
      if (res.screened && res.rule !== null) {
        m.set(r.firm.firmId, res.rule);
      }
    }
    return m;
  }, [queue, screeningRules]);

  // Open per the funnel — isOpenFirm, the same derivation /pipeline and
  // Home's strip use — so "N open" here equals Discovered + In Review there.
  // Everything else in the header is computed against that base, so
  // live + openScreened === open, and open ⊆ database.
  const openByFirmId = React.useMemo(() => {
    const s = new Set<string>();
    for (const r of queue) {
      if (isOpenFirm(r.firm, r.hardRejected)) {
        s.add(r.firm.firmId);
      }
    }
    return s;
  }, [queue]);

  const { liveCount, openCount, openScreenedCount } = React.useMemo(() => {
    let openScreened = 0;
    for (const firmId of openByFirmId) {
      if (screenByFirmId.has(firmId)) {
        openScreened++;
      }
    }
    const open = openByFirmId.size;
    return { liveCount: open - openScreened, openCount: open, openScreenedCount: openScreened };
  }, [openByFirmId, screenByFirmId]);

  const filtered = React.useMemo(() => {
    // The search box reaches every firm in scope regardless of the toggle —
    // an analyst looking up a firm by name should never have to know it was
    // screened or already decided to find it.
    const base =
      searching || showAll || membershipPinned
        ? queue
        : queue.filter((r) =>
            // Same predicate the header counts, so the list length and the
            // "N in live queue" figure above it can never disagree.
            isLiveQueueFirm(r.firm as never, screeningRules, openByFirmId.has(r.firm.firmId)),
          );
    if (!searching) {
      return base;
    }
    const needle = q.trim().toLowerCase();
    return base.filter(
      (r) =>
        (r.firm.firmName ?? "").toLowerCase().includes(needle) ||
        (r.firm.firmId ?? "").toLowerCase().includes(needle),
    );
  }, [queue, q, searching, showAll, membershipPinned, screeningRules, openByFirmId]);

  return (
    <aside
      style={{
        width: 280,
        flex: "0 0 280px",
        borderRight: "1px solid var(--color-divider)",
        display: "flex",
        flexDirection: "column",
        padding: 16,
        gap: 12,
        minHeight: 0,
      }}
    >
      <BrandMark section="Enrichment Desk" />
      <WorkspaceNavLinks />

      <div style={{ padding: "0 4px", marginTop: 4 }}>
        <Kicker>Queue</Kicker>
        <div
          style={{
            fontSize: 10,
            marginTop: 4,
            color: "color-mix(in srgb, var(--color-text) 45%, transparent)",
          }}
        >
          sorted by expected gain
        </div>
      </div>

      {/* Search */}
      <div style={{ position: "relative" }}>
        <input
          className="input"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search firms…"
          style={{ paddingLeft: 30 }}
        />
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          style={{ position: "absolute", left: 9, top: 11, opacity: 0.5, pointerEvents: "none" }}
        >
          <circle cx="11" cy="11" r="7" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
      </div>

      {/* Queue arithmetic. Every number here is computed from the same firm
          set and the same approved rules /rules screens on, so the desk and
          the rule cards can no longer disagree about how many firms a rule
          takes off the desk. */}
      <div
        style={{
          fontSize: 10,
          lineHeight: 1.5,
          color: "color-mix(in srgb, var(--color-text) 45%, transparent)",
          padding: "0 4px",
        }}
      >
        {isLoading && queue.length === 0 ? (
          "Loading…"
        ) : (
          <>
            <strong style={{ color: "var(--color-text)", fontWeight: 600 }}>{liveCount}</strong> in
            live queue{" · "}
            <span style={{ fontVariantNumeric: "tabular-nums" }}>{openCount}</span> open{" · "}
            <span style={{ fontVariantNumeric: "tabular-nums" }}>{queue.length}</span> {scopeLabel}
            {": "}
            <span style={{ fontVariantNumeric: "tabular-nums" }}>{openScreenedCount}</span> open
            firm{openScreenedCount === 1 ? "" : "s"} screened by approved rules
          </>
        )}
      </div>

      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "0 4px",
          fontSize: 11,
          cursor: "pointer",
          color: "color-mix(in srgb, var(--color-text) 62%, transparent)",
        }}
      >
        <input
          type="checkbox"
          checked={showAll}
          onChange={(e) => setShowAll(e.target.checked)}
          style={{ accentColor: "var(--color-accent)", cursor: "pointer" }}
        />
        Show all firms
      </label>

      {/* Only shown when the view is narrower or wider than the header's
          headline number, so the list count is never ambiguous. */}
      {!isLoading && (searching || showAll || membershipPinned) && (
        <div
          style={{
            fontSize: 10,
            padding: "0 4px",
            marginTop: -6,
            color: "color-mix(in srgb, var(--color-text) 40%, transparent)",
          }}
        >
          {searching
            ? `${filtered.length} matching · searching all firms`
            : membershipPinned
              ? `showing all ${filtered.length} in this search`
              : `showing all ${filtered.length}`}
        </div>
      )}

      <div
        style={{
          flex: 1,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 2,
          minHeight: 0,
        }}
      >
        {isLoading && queue.length === 0 && (
          <div
            style={{
              padding: "10px 8px",
              fontSize: 12,
              color: "color-mix(in srgb, var(--color-text) 48%, transparent)",
            }}
          >
            Loading firms…
          </div>
        )}
        {!isLoading && filtered.length === 0 && (
          <div
            style={{
              padding: "10px 8px",
              fontSize: 12,
              color: "color-mix(in srgb, var(--color-text) 48%, transparent)",
            }}
          >
            {q === "" ? "No firms in the queue." : "No firms match that search."}
          </div>
        )}
        {filtered.map((r) => {
          const selected = r.firm.firmId === selectedId;
          // R-badge decision now reads from the shared hard-screen verdict
          // (r.hardScreened) rather than the client mirror alone. A firm
          // whose tier is Rejected via low score but hasn't tripped any
          // rule stays workable — we don't wear an R at the top of the
          // queue for those firms; the score row already conveys the
          // low current standing.
          const displayTier: string = r.hardScreened
            ? "Rejected"
            : r.tier === "Rejected"
              ? "C"
              : r.tier;
          const pct = r.hardScreened ? 0 : Math.round((r.currentScore / MAX_POSSIBLE) * 100);
          // An approved rule took this firm off the live queue. Named, not
          // just dimmed — "why is this firm greyed out" should be readable
          // from the row without opening it.
          const screenedBy = screenByFirmId.get(r.firm.firmId) ?? null;
          const dimmed = r.hardScreened || screenedBy !== null;
          return (
            <button
              key={r.firm.firmId}
              onClick={() => onSelect(r.firm.firmId)}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr auto",
                gap: 4,
                width: "100%",
                textAlign: "left",
                padding: "8px 8px",
                border: "1px solid transparent",
                borderColor: selected ? "var(--color-accent)" : "transparent",
                borderRadius: "var(--radius-chip)",
                cursor: "pointer",
                background: selected
                  ? "color-mix(in srgb, var(--color-accent) 10%, transparent)"
                  : "transparent",
                color: "inherit",
                font: "inherit",
                opacity: dimmed ? 0.55 : 1,
              }}
            >
              <span
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  minWidth: 0,
                  fontWeight: 500,
                  fontSize: 13,
                }}
              >
                <span
                  style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    minWidth: 0,
                    textDecorationLine: dimmed ? "line-through" : "none",
                    textDecorationColor: "color-mix(in srgb, var(--color-text) 40%, transparent)",
                  }}
                >
                  {r.firm.firmName ?? r.firm.firmId}
                </span>
                {(() => {
                  const info = rediscoveryByFirmId?.get(r.firm.firmId ?? "");
                  return info ? <RediscoveryBadge info={info} /> : null;
                })()}
              </span>
              <TierTag tier={displayTier} />
              <div
                style={{
                  gridColumn: "1 / 3",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 10,
                  color: "color-mix(in srgb, var(--color-text) 48%, transparent)",
                }}
              >
                {screenedBy !== null ? (
                  <span
                    title={`Screened by an approved rule: ${screenedBy.label}`}
                    style={{
                      padding: "1px 6px",
                      borderRadius: "var(--radius-sm)",
                      background: "color-mix(in srgb, var(--color-text) 8%, transparent)",
                      border: "1px solid color-mix(in srgb, var(--color-text) 12%, transparent)",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    screened · {screenedBy.label}
                  </span>
                ) : r.hardScreened ? (
                  <span title={r.hardScreenReason ?? undefined}>
                    hard-screened{r.hardScreenReason ? ` · ${r.hardScreenReason}` : ""}
                  </span>
                ) : (
                  <>
                    <span
                      style={{ fontVariantNumeric: "tabular-nums" }}
                      title={`${r.currentScore} of ${MAX_POSSIBLE} signal points known → ${r.ceiling} reachable if the remaining fields were filled`}
                    >
                      {r.currentScore}/{MAX_POSSIBLE} → {r.ceiling}
                    </span>
                    <span
                      style={{
                        flex: 1,
                        height: 4,
                        borderRadius: "var(--radius-xs)",
                        background: "var(--color-neutral-800)",
                        overflow: "hidden",
                      }}
                    >
                      <span
                        style={{
                          display: "block",
                          height: "100%",
                          width: `${pct}%`,
                          background: TIER_COLOR[r.tier] ?? "var(--color-neutral-500)",
                        }}
                      />
                    </span>
                    <span style={{ fontVariantNumeric: "tabular-nums" }}>{r.missingCount}m</span>
                  </>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </aside>
  );
}

// ─── Firm header ────────────────────────────────────────────────────────

// Three distinct states the header must not conflate:
//   • Hard-rejected — the *system* screened the firm out (client base rule
//     or server-side approved HardScreenConfig row). Shows the reason.
//   • Rejected — soft state: analyst rejected (lifecycleState=Rejected)
//     or the weighted score fell below C. Enrichment can still move it.
//   • Otherwise — the tier label (Strong / Moderate / Weak).
// TIER_LABEL used to spell "Hard-rejected" for the Rejected tier, so any
// low-score firm (like Aspect at 4 employees) read as a hard reject even
// when no screen ever fired. This helper is the single source of truth
// for the header state string and delegates the hard-screen verdict to
// the shared computeHardScreen so the queue and header can't disagree.
function headerStateLabel(
  firm: FirmView,
  after: MirrorResult,
  tier: string,
  activeConfigs: readonly ActiveConfigRule[],
  configsLoading: boolean,
): string {
  // Base-rule verdict is client-computable and reflects edits in progress,
  // so render it immediately without waiting on the HardScreenConfig query.
  if (after.hardRejected) {
    return `Hard-rejected · ${after.rejectReason || "base rule"}`;
  }
  // Config + disposition checks depend on the HardScreenConfig query —
  // avoid a false "Rejected" flicker by falling back to the tier label
  // until the query resolves. Once configs land, the shared verdict wins.
  if (configsLoading) {
    return TIER_LABEL[tier] ?? tier;
  }
  const verdict = computeHardScreen({ ...firm, firmId: firm.firmId ?? "" } as never, activeConfigs);
  if (verdict.hardScreened) {
    return `Hard-rejected · ${verdict.reason ?? "screened"}`;
  }
  return TIER_LABEL[tier] ?? tier;
}

function FirmHeader({
  firm,
  before,
  after,
  elapsed,
  saving,
  activeConfigs,
  configsLoading,
}: {
  firm: FirmView;
  before: MirrorResult;
  after: MirrorResult;
  elapsed: number;
  saving: boolean;
  activeConfigs: readonly ActiveConfigRule[];
  configsLoading: boolean;
}): React.ReactElement {
  const tier = after.tier;
  const tierColor = TIER_COLOR[tier] ?? TIER_COLOR.Rejected;
  const status = firm.lifecycleState ?? firm.currentStage ?? "In Review";
  const pct = after.hardRejected ? null : pctScore(after);
  const beforePct = before.hardRejected ? null : pctScore(before);
  const changed = pct !== null && beforePct !== null && pct !== beforePct;

  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 16 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <h3
            style={{
              margin: 0,
              fontSize: 26,
              fontWeight: 500,
              overflowWrap: "anywhere",
              textDecorationLine: after.hardRejected ? "line-through" : "none",
              textDecorationColor: "color-mix(in srgb, var(--color-text) 40%, transparent)",
            }}
          >
            {firm.firmName ?? firm.firmId}
          </h3>
          <span
            className="tag"
            style={{
              fontSize: 11,
              padding: "2px 8px",
              borderRadius: "var(--radius-chip)",
              color: "color-mix(in srgb, var(--color-text) 78%, transparent)",
              background: "var(--color-neutral-800)",
            }}
          >
            {status}
          </span>
          <span className="tag tag-neutral" style={{ fontWeight: 600 }}>
            {after.model}
          </span>
          <OutcomeChip
            outcome={(firm as unknown as { outcome?: string | null }).outcome}
            observedAt={(firm as unknown as { outcomeObservedAt?: unknown }).outcomeObservedAt}
          />
        </div>
        {(firm.sector || firm.coverageModel || firm.hqCountry) && (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: 8,
              marginTop: 8,
              fontSize: 13,
              color: "color-mix(in srgb, var(--color-text) 62%, transparent)",
            }}
          >
            {firm.sector && <span className="tag tag-outline">{firm.sector}</span>}
            {firm.coverageModel && <span>{firm.coverageModel}</span>}
            {firm.hqCountry && (
              <>
                {firm.coverageModel && <span style={{ opacity: 0.4 }}>·</span>}
                <span>{firm.hqCountry}</span>
              </>
            )}
          </div>
        )}
      </div>
      <div style={{ flex: "none", textAlign: "right" }}>
        <div
          style={{ display: "flex", alignItems: "baseline", gap: 8, justifyContent: "flex-end" }}
        >
          <span
            style={{
              fontSize: 44,
              fontWeight: 600,
              lineHeight: 1,
              fontVariantNumeric: "tabular-nums",
              color: after.hardRejected
                ? "color-mix(in srgb, var(--color-text) 40%, transparent)"
                : tierColor,
            }}
          >
            {pct ?? "—"}
          </span>
          <TierTag tier={tier} />
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            justifyContent: "flex-end",
            marginTop: 4,
          }}
        >
          {saving && (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                fontSize: 11,
                color: "var(--color-accent)",
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: "currentColor",
                }}
              />
              Saving…
            </span>
          )}
          {changed && !saving && (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                fontSize: 11,
                color: "var(--color-accent)",
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: "currentColor",
                }}
              />
              {beforePct} → {pct}
            </span>
          )}
          <span
            style={{
              fontSize: 11,
              letterSpacing: "0.04em",
              color: "color-mix(in srgb, var(--color-text) 48%, transparent)",
            }}
          >
            {headerStateLabel(firm, after, tier, activeConfigs, configsLoading)} · {elapsed}s on
            firm
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── Axis breakdown ─────────────────────────────────────────────────────

function AxisBreakdown({
  firm,
  mirror,
  edits,
  setAxis,
  focused,
  setFocused,
  findingsByAxisKey,
}: {
  firm: FirmView;
  mirror: MirrorResult;
  edits: EditMap;
  setAxis: (key: string, value: string | number | boolean) => void;
  focused: string | undefined;
  setFocused: (k: string | undefined) => void;
  findingsByAxisKey: Map<string, FindingLike[]>;
}): React.ReactElement {
  const model = mirror.model;
  const firmRecord = firm as unknown as Record<
    string,
    string | number | boolean | null | undefined
  >;

  return (
    <div
      style={{
        border: "1px solid var(--color-divider)",
        borderRadius: "var(--radius-md)",
        padding: 8,
        background: "color-mix(in srgb, var(--color-neutral-900) 45%, transparent)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "4px 10px 8px",
        }}
      >
        <Kicker>Axis breakdown · {mirror.axisScores.length} rubric axes</Kicker>
        <span
          style={{
            fontSize: 11,
            color: "color-mix(in srgb, var(--color-text) 42%, transparent)",
          }}
        >
          Click a row to edit · score recomputes live
        </span>
      </div>
      {mirror.axisScores.map((axis) => {
        const ed = editorForAxis(axis.axis, model);
        const editing = ed !== undefined && focused === `axis:${axis.axis}`;
        const finding = findingsByAxisKey.get(ed?.editKey ?? "")?.[0];
        const bandInt = Number.isInteger(axis.score) ? (axis.score as 0 | 1 | 2) : null;
        const editValue = ed ? edits[ed.editKey] : undefined;
        const onFile = ed ? firmRecord[ed.editKey] : undefined;
        const canEdit = ed !== undefined;

        return (
          <div
            key={axis.axis}
            role={canEdit ? "button" : undefined}
            tabIndex={canEdit ? 0 : undefined}
            onClick={() => {
              if (canEdit) {
                setFocused(`axis:${axis.axis}`);
              }
            }}
            onKeyDown={(e) => {
              if (canEdit && (e.key === "Enter" || e.key === " ")) {
                setFocused(`axis:${axis.axis}`);
                e.preventDefault();
              }
            }}
            style={{
              display: "grid",
              gridTemplateColumns: "150px 1fr auto",
              gap: 12,
              alignItems: "center",
              padding: "9px 10px",
              borderRadius: "var(--radius-chip)",
              cursor: canEdit ? "pointer" : "default",
              background: editing
                ? "color-mix(in srgb, var(--color-accent) 8%, transparent)"
                : "transparent",
              boxShadow: editing
                ? "inset 0 0 0 1px color-mix(in srgb, var(--color-accent) 45%, transparent)"
                : "none",
            }}
          >
            <span
              style={{
                fontSize: 12,
                color: "color-mix(in srgb, var(--color-text) 60%, transparent)",
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              {axis.axis}
              {editing && ed?.kind === "categorical" && (
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 600,
                    letterSpacing: "0.06em",
                    color: "var(--color-accent)",
                    background: "color-mix(in srgb, var(--color-accent) 18%, transparent)",
                    padding: "1px 6px",
                    borderRadius: "var(--radius-lg)",
                  }}
                >
                  0 1 2 · ESC
                </span>
              )}
            </span>
            <div style={{ minWidth: 0 }}>
              {!editing && (
                <>
                  <div
                    style={{
                      fontSize: 14,
                      fontWeight: 500,
                      color: axis.known
                        ? "var(--color-text)"
                        : "color-mix(in srgb, var(--color-text) 45%, transparent)",
                    }}
                  >
                    {axis.known ? humanAxisValue(axis.axis, firm) : "—"}
                  </div>
                  {ed && editValue !== undefined && editValue !== "" && (
                    <div
                      style={{
                        fontSize: 11,
                        color: "var(--color-accent)",
                        marginTop: 1,
                      }}
                    >
                      pending: {String(editValue)}
                    </div>
                  )}
                  {!axis.known && !editValue && (
                    <div
                      style={{
                        fontSize: 11,
                        color: "color-mix(in srgb, var(--color-text) 45%, transparent)",
                        marginTop: 1,
                      }}
                    >
                      {canEdit ? "needs you" : "spine · not analyst-editable"}
                    </div>
                  )}
                </>
              )}
              {editing && ed?.kind === "categorical" && ed.options && (
                <div
                  style={{
                    display: "flex",
                    gap: 4,
                    width: 180,
                    background: "var(--color-neutral-900)",
                    borderRadius: "var(--radius-chip)",
                    padding: 3,
                  }}
                >
                  {ed.options.map((o) => {
                    const chosen = editValue === o.label;
                    return (
                      <button
                        key={o.score}
                        onClick={(e) => {
                          e.stopPropagation();
                          setAxis(ed.editKey, o.label);
                        }}
                        title={o.label}
                        style={{
                          flex: 1,
                          padding: "4px 0",
                          borderRadius: "var(--radius-chip)",
                          fontSize: 12,
                          fontWeight: 600,
                          fontVariantNumeric: "tabular-nums",
                          border: "none",
                          cursor: "pointer",
                          background: chosen
                            ? "color-mix(in srgb, var(--color-accent) 20%, transparent)"
                            : "transparent",
                          color: chosen
                            ? "var(--color-accent)"
                            : "color-mix(in srgb, var(--color-text) 62%, transparent)",
                          boxShadow: chosen ? "inset 0 0 0 1px var(--color-accent)" : "none",
                        }}
                      >
                        {o.score}
                      </button>
                    );
                  })}
                </div>
              )}
              {editing && ed?.kind === "number" && (
                <input
                  ref={(el) => {
                    if (el !== null && document.activeElement !== el) {
                      el.focus();
                    }
                  }}
                  className="input"
                  type="number"
                  value={
                    typeof editValue === "number" || typeof editValue === "string"
                      ? String(editValue)
                      : ""
                  }
                  onChange={(e) => setAxis(ed.editKey, e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  placeholder={
                    onFile !== null && onFile !== undefined ? String(onFile) : (ed.unit ?? "")
                  }
                  style={{ width: 150, height: 32 }}
                />
              )}
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                justifySelf: "end",
              }}
            >
              <BandChip band={bandInt} />
              {finding && (
                <>
                  <ProviderChip provider={finding.provider} />
                  <ConfidenceChip tier={finding.confidenceTier} />
                </>
              )}
            </div>
          </div>
        );
      })}
      {mirror.hardRejected && (
        <div
          style={{
            marginTop: 4,
            padding: "8px 12px",
            borderRadius: "var(--radius-md)",
            background: "rgba(207,112,112,.14)",
            color: "#e79191",
            fontSize: 13,
            fontWeight: 500,
          }}
        >
          Hard-rejected: {mirror.rejectReason}
        </div>
      )}
    </div>
  );
}

// ─── Hard gates ─────────────────────────────────────────────────────────

function HardGates({
  firm,
  edits,
  setAxis,
  focused,
  setFocused,
}: {
  firm: FirmView;
  edits: EditMap;
  setAxis: (key: string, value: string | number | boolean) => void;
  focused: string | undefined;
  setFocused: (k: string | undefined) => void;
}): React.ReactElement {
  return (
    <div>
      <Kicker style={{ marginBottom: 8 }}>Hard gates</Kicker>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 12,
        }}
      >
        {HARD_GATES.map((g) => {
          const editVal = edits[g.editKey];
          const onFile = firm[g.readKey];
          const effective =
            typeof editVal === "boolean" ? editVal : (onFile as boolean | null | undefined);
          const isFocused = focused === `gate:${g.editKey}`;
          return (
            <div
              key={g.editKey}
              style={{
                padding: 12,
                background: "var(--color-surface)",
                borderRadius: "var(--radius-md)",
                boxShadow: "var(--shadow-sm)",
                display: "flex",
                flexDirection: "column",
                gap: 8,
                outline: isFocused ? "1px solid var(--color-accent)" : "none",
              }}
              onFocus={() => setFocused(`gate:${g.editKey}`)}
            >
              <div>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{g.label}</div>
                {g.helper && (
                  <div
                    style={{
                      fontSize: 11,
                      color: "color-mix(in srgb, var(--color-text) 45%, transparent)",
                      marginTop: 1,
                    }}
                  >
                    {g.helper}
                  </div>
                )}
              </div>
              <Segmented<boolean>
                block
                ariaLabel={`${g.label}: Pass or Fail`}
                // Pass always means "cleared" — the underlying bool is
                // whatever passWhen resolves to for this gate. Two of the
                // four gates invert (advisoryConflict, hasStOrBalanceSheet).
                options={[
                  { label: "Pass", v: g.passWhen },
                  { label: "Fail", v: !g.passWhen },
                ].map((o) => ({ label: o.label, value: o.v }))}
                value={typeof effective === "boolean" ? effective : undefined}
                onFocus={() => setFocused(`gate:${g.editKey}`)}
                onChange={(v) => {
                  setFocused(`gate:${g.editKey}`);
                  setAxis(g.editKey, v);
                }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Decision memory banner ─────────────────────────────────────────────
// Aggregates ReviewDecisions across the current firm's COHORT (same firmType
// + employeeGroup, excluding the current firm) — surfaces the pattern so the
// analyst can spot repeat rejections. Never renders raw actor UUIDs.

function DecisionMemory({
  firm,
  allFirms,
  firmsLoading,
}: {
  firm: FirmView;
  allFirms: FirmView[];
  firmsLoading: boolean;
}): React.ReactElement | null {
  const { data: decisionData, isLoading: decisionsLoading } = useOsdkObjects(ReviewDecision, {
    pageSize: 500,
    orderBy: { decidedAt: "desc" },
  });

  const cohortIds = React.useMemo(() => {
    const s = new Set<string>();
    const t = firm.firmType ?? null;
    const g = firm.employeeGroup ?? null;
    if (t === null && g === null) {
      return s;
    }
    for (const f of allFirms) {
      if (f.firmId === firm.firmId) {
        continue;
      }
      if (t !== null && f.firmType !== t) {
        continue;
      }
      if (g !== null && f.employeeGroup !== g) {
        continue;
      }
      if (f.firmId) {
        s.add(f.firmId);
      }
    }
    return s;
  }, [allFirms, firm.firmId, firm.firmType, firm.employeeGroup]);

  // Both queries feed the prose — decisions AND the firm cohort come from
  // separate Firm / ReviewDecision streams that finish independently. If
  // we render before either resolves, an interpolated count would come out
  // as an empty slot ("You've reviewed  similar firms."). Track both and
  // show a skeleton until they're settled.
  const anyPending =
    firmsLoading ||
    decisionsLoading ||
    decisionData === undefined ||
    // firmType is our cohort key — no cohort key means allFirms is still
    // hydrating (or this firm genuinely has no cohort; either way, wait).
    (firmsLoading && allFirms.length === 0);

  const banner = React.useMemo(() => {
    if (anyPending || cohortIds.size === 0 || decisionData === undefined) {
      return null;
    }
    const decisions = decisionData.filter(
      (d) => d.firmId !== null && d.firmId !== undefined && cohortIds.has(d.firmId),
    );
    if (decisions.length === 0) {
      return null;
    }
    const uniqueFirms = new Set(decisions.map((d) => d.firmId ?? "")).size;
    let rejects = 0;
    let advances = 0;
    const rationales = new Map<string, number>();
    for (const d of decisions) {
      // decisionType comes from the backend as free-form strings —
      // "reject", "hard_reject", "advance", "qualify", "outreach",
      // "accept", "enrich", "re_engage", "keep_passed", "activity".
      // We bucket into two states an analyst cares about: rejects vs
      // "advanced-in-some-way". Being inclusive on the second bucket
      // avoids the blank-count symptom where nothing matched the
      // classifier and the strong element rendered empty.
      const type = (d.decisionType ?? "").toLowerCase();
      if (type.includes("reject")) {
        rejects++;
        const r = (d.rejectionRationale ?? "").trim();
        if (r !== "") {
          rationales.set(r, (rationales.get(r) ?? 0) + 1);
        }
      } else if (type !== "") {
        // Anything non-reject counts as forward motion (advance / qualify
        // / outreach / accept / enrich / re_engage / keep_passed / etc).
        advances++;
      }
    }
    let topRationale: { text: string; count: number } | null = null;
    for (const [text, count] of rationales) {
      if (topRationale === null || count > topRationale.count) {
        topRationale = { text, count };
      }
    }
    return { uniqueFirms, rejects, advances, topRationale };
  }, [decisionData, anyPending, cohortIds]);

  // Skeleton while pending — a soft shimmering bar the same height as the
  // final strip so the surrounding layout doesn't jump when counts arrive.
  if (anyPending) {
    return <DecisionMemorySkeleton />;
  }
  if (banner === null || banner.uniqueFirms <= 0) {
    // Nothing meaningful to say (no cohort or no prior decisions).
    return null;
  }

  const cohortLabel = describeCohort(firm);
  // Coerce defensively — banner values are numbers by construction, but
  // rendering `undefined` interpolated into <strong> shows as blank. The
  // Number() + `|| 0` idiom guarantees a numeric display no matter what.
  const uniqueFirms = Number(banner.uniqueFirms) || 0;
  const rejects = Number(banner.rejects) || 0;
  const advances = Number(banner.advances) || 0;
  const hasRationale = banner.topRationale !== null && banner.topRationale.text.trim() !== "";
  const rationaleText = banner.topRationale ? truncateAtWord(banner.topRationale.text, 60) : "";
  const rationaleCount = banner.topRationale?.count ?? 0;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: 12,
        borderRadius: "var(--radius-md)",
        background: "color-mix(in srgb, var(--color-accent) 8%, transparent)",
        border: "1px solid color-mix(in srgb, var(--color-accent) 22%, transparent)",
      }}
    >
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="var(--color-accent)"
        strokeWidth={2}
        style={{ flex: "none" }}
      >
        <circle cx="12" cy="12" r="9" />
        <path d="M12 8v4M12 16h.01" />
      </svg>
      {/* Single flowing sentence — every dynamic value is inline text
          inside one <span> so nothing wraps to a new line or renders as a
          nested block. Numbers wrap in <strong>; the rationale uses <em>
          without decorative quotes so the sentence reads naturally. */}
      <span
        style={{
          fontSize: 13,
          lineHeight: 1.55,
          color: "color-mix(in srgb, var(--color-text) 78%, transparent)",
          display: "inline",
        }}
      >
        You&rsquo;ve reviewed <strong style={{ fontWeight: 600 }}>{uniqueFirms}</strong>{" "}
        {cohortLabel} firm{uniqueFirms === 1 ? "" : "s"}.
        {rejects > 0 && (
          <>
            {" "}
            <strong style={{ fontWeight: 600 }}>{rejects}</strong> rejected
            {hasRationale && banner.topRationale ? (
              <>
                {" "}
                &mdash; most-cited reason:{" "}
                <em
                  style={{
                    fontStyle: "italic",
                    color: "var(--color-text)",
                    display: "inline",
                  }}
                  title={banner.topRationale.text}
                >
                  {rationaleText}
                </em>
                {rationaleCount > 1 ? ` (${rationaleCount}×)` : ""}
              </>
            ) : null}
            {advances > 0 ? " · " : "."}
          </>
        )}
        {advances > 0 && (
          <>
            <strong style={{ fontWeight: 600 }}>{advances}</strong> advanced.
          </>
        )}
      </span>
    </div>
  );
}

function DecisionMemorySkeleton(): React.ReactElement {
  return (
    <div
      aria-busy="true"
      aria-label="Loading decision precedent"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: 12,
        borderRadius: "var(--radius-md)",
        background: "color-mix(in srgb, var(--color-accent) 6%, transparent)",
        border: "1px solid color-mix(in srgb, var(--color-accent) 15%, transparent)",
      }}
    >
      <span
        style={{
          width: 15,
          height: 15,
          borderRadius: "50%",
          background: "color-mix(in srgb, var(--color-text) 12%, transparent)",
          flex: "none",
        }}
      />
      <span
        style={{
          display: "block",
          height: 12,
          borderRadius: "var(--radius-sm)",
          flex: 1,
          background:
            "linear-gradient(90deg, color-mix(in srgb, var(--color-text) 6%, transparent) 0%, color-mix(in srgb, var(--color-text) 18%, transparent) 50%, color-mix(in srgb, var(--color-text) 6%, transparent) 100%)",
          backgroundSize: "200% 100%",
          animation: "beacon-shimmer 1.6s linear infinite",
        }}
      />
    </div>
  );
}

function describeCohort(firm: FirmView): string {
  const bits: string[] = [];
  if (firm.firmType) {
    bits.push(firm.firmType);
  }
  if (firm.employeeGroup) {
    bits.push(firm.employeeGroup);
  }
  const label = bits.join(" · ");
  return label === "" ? "similar" : `similar (${label})`;
}

// ─── Findings ───────────────────────────────────────────────────────────

function findingCardShell(border: string): React.CSSProperties {
  return {
    padding: 12,
    background: "var(--color-surface)",
    borderRadius: "var(--radius-md)",
    boxShadow: "var(--shadow-sm)",
    border,
    display: "flex",
    flexDirection: "column",
  };
}

function formatRetrievedShort(f: FindingLike): string {
  const ms = retrievedMs(f);
  if (ms === 0) {
    return "";
  }
  const d = new Date(ms);
  // Compact local date — enough context for "which of these is newer".
  return d.toISOString().slice(0, 10);
}

// Format a coerced axis value as the string verifyFindingAction.overrideValue
// expects. Boolean gates read as "Yes" / "No"; everything else stringifies.
function stringifyOverride(editKey: string, v: string | number | boolean): string {
  if (HARD_GATE_EDIT_KEYS.has(editKey)) {
    return v === true ? "Yes" : v === false ? "No" : String(v);
  }
  return String(v);
}

// Per-axis card. Renders the authoritative finding prominently, folds any
// older/lower-priority findings for the same axis into a collapsed
// disclosure. Used for both Proposed and Verified sections; buttons vary.
// Owns the Accept/Verify decision so the conflict prompt renders inline
// next to the finding (never a silent no-op).
function AxisCard({
  group,
  getCurrent,
  applyEdit,
  verifyFinding,
  verifying,
}: {
  group: AxisGroup;
  getCurrent: (editKey: string) => string | number | boolean | null | undefined;
  applyEdit: (editKey: string, value: string | number | boolean) => void;
  verifyFinding: (f: FindingLike, overrideValue?: string) => void;
  verifying: boolean;
}): React.ReactElement {
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [conflict, setConflict] = React.useState<{
    mine: string | number | boolean;
    theirs: string | number | boolean;
    editKey: string;
    // Track whether the analyst opened the prompt via Accept or Verify
    // so "Take agent's" can also flip the finding to verified on the
    // Verify path.
    alsoVerify: boolean;
  } | null>(null);
  const [unroutable, setUnroutable] = React.useState<string | null>(null);
  const f = group.authoritative;
  const verified = group.state === "verified";

  const handleDecision = (
    decision: AcceptDecision,
    finding: FindingLike,
    alsoVerify: boolean,
  ): void => {
    if (decision.kind === "unroutable") {
      setConflict(null);
      setUnroutable(
        decision.reason === "unknown-axis"
          ? "This finding's axis doesn't map to a firm field yet."
          : "Finding value can't be routed to this field. Enter it manually.",
      );
      return;
    }
    setUnroutable(null);
    if (decision.kind === "apply") {
      applyEdit(decision.editKey, decision.value);
      if (alsoVerify) {
        verifyFinding(finding);
      } else {
        // Accept also marks the finding verified so the card leaves the
        // Proposed pile — matches the "marks the finding accepted" spec.
        verifyFinding(finding);
      }
      setConflict(null);
      return;
    }
    // conflict → surface the inline choice, don't silently no-op.
    setConflict({
      mine: decision.mine,
      theirs: decision.theirs,
      editKey: decision.editKey,
      alsoVerify,
    });
  };

  const onAcceptClick = (): void => {
    const rawAxis = (f.axis ?? "").trim().toLowerCase();
    const editKey = FINDING_AXIS_TO_KEY[rawAxis];
    const current = editKey !== undefined ? getCurrent(editKey) : undefined;
    handleDecision(decideAccept(f, current), f, false);
  };

  const onVerifyClick = (): void => {
    const rawAxis = (f.axis ?? "").trim().toLowerCase();
    const editKey = FINDING_AXIS_TO_KEY[rawAxis];
    const current = editKey !== undefined ? getCurrent(editKey) : undefined;
    handleDecision(decideVerify(f, current), f, true);
  };

  const onKeepMine = (): void => {
    if (conflict === null) {
      return;
    }
    // Preserve the analyst's value; record the override on the finding so
    // the accuracy layer sees an explicit disagreement rather than an
    // orphan proposal.
    verifyFinding(f, stringifyOverride(conflict.editKey, conflict.mine));
    setConflict(null);
  };

  const onTakeAgents = (): void => {
    if (conflict === null) {
      return;
    }
    applyEdit(conflict.editKey, conflict.theirs);
    verifyFinding(f);
    setConflict(null);
  };

  return (
    <div style={findingCardShell("none")}>
      <div
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}
      >
        <span
          style={{ fontSize: 11, color: "color-mix(in srgb, var(--color-text) 52%, transparent)" }}
        >
          {displayAxis(group.axis)}
        </span>
        <FindingStatusChip status={verified ? "verified" : f.findingStatus} />
      </div>
      <div
        style={{
          fontSize: 19,
          fontWeight: 600,
          marginTop: 4,
          overflowWrap: "anywhere",
          lineHeight: 1.25,
        }}
      >
        {displayFindingValue(group.axis, f.value)}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8 }}>
        <ProviderChip provider={f.provider} />
        <ConfidenceChip tier={f.confidenceTier} />
      </div>
      {f.sourceExcerpt && (
        <div
          style={{
            fontSize: 11,
            color: "#f2d488",
            marginTop: 4,
            overflowWrap: "anywhere",
          }}
        >
          “{f.sourceExcerpt}”
        </div>
      )}
      <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
        {verified ? (
          <>
            {f.sourceUrl && (
              <a
                href={f.sourceUrl}
                target="_blank"
                rel="noreferrer"
                style={{ fontSize: 12, alignSelf: "center", color: "var(--color-accent)" }}
              >
                source ↗
              </a>
            )}
          </>
        ) : (
          <>
            <button
              className="btn btn-ghost"
              style={{ fontSize: 12, padding: "3px 8px" }}
              disabled={verifying}
              onClick={onAcceptClick}
              title="Write the agent's proposed value to this axis and mark the finding accepted"
            >
              Accept →
            </button>
            <button
              className="btn btn-secondary"
              style={{ fontSize: 12, padding: "3px 10px" }}
              disabled={verifying}
              onClick={onVerifyClick}
              title="Confirm the current value as human-checked"
            >
              {verifying ? "Verifying…" : "Verify"}
            </button>
            {f.sourceUrl && (
              <a
                href={f.sourceUrl}
                target="_blank"
                rel="noreferrer"
                style={{ fontSize: 12, alignSelf: "center", color: "var(--color-accent)" }}
              >
                source ↗
              </a>
            )}
          </>
        )}
      </div>

      {conflict !== null && (
        <div
          role="alert"
          aria-live="polite"
          style={{
            marginTop: 8,
            padding: "8px 10px",
            borderRadius: "var(--radius-md)",
            background: "rgba(203,162,79,.10)",
            border: "1px solid color-mix(in srgb, #cba24f 40%, transparent)",
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          <div style={{ fontSize: 12, color: "#e6c878", lineHeight: 1.4 }}>
            You set <strong>{formatAxisValue(conflict.editKey, conflict.mine)}</strong>
            {" · "}
            agent proposes <strong>{formatAxisValue(conflict.editKey, conflict.theirs)}</strong>
            {" ("}
            {f.provider ? providerLabel(f.provider) : "unknown source"}
            {f.confidenceTier ? `, ${f.confidenceTier}` : ""}
            {")"}
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button
              className="btn btn-secondary"
              style={{ fontSize: 12, padding: "3px 9px" }}
              disabled={verifying}
              onClick={onKeepMine}
            >
              Keep mine
            </button>
            <button
              className="btn btn-primary"
              style={{ fontSize: 12, padding: "3px 9px" }}
              disabled={verifying}
              onClick={onTakeAgents}
            >
              Take agent&rsquo;s
            </button>
          </div>
        </div>
      )}

      {unroutable !== null && (
        <div
          role="alert"
          style={{
            marginTop: 8,
            fontSize: 11,
            color: "#e79191",
          }}
        >
          {unroutable}
        </div>
      )}

      {group.history.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <button
            type="button"
            onClick={() => setHistoryOpen((v) => !v)}
            aria-expanded={historyOpen}
            style={{
              background: "none",
              border: 0,
              padding: 0,
              cursor: "pointer",
              font: "inherit",
              fontSize: 11,
              color: "color-mix(in srgb, var(--color-text) 55%, transparent)",
              textAlign: "left",
            }}
            title="Prior findings for this axis from other providers or older runs"
          >
            {historyOpen
              ? `Hide history (${group.history.length})`
              : `history (${group.history.length}) ▾`}
          </button>
          {historyOpen && (
            <ul
              style={{
                listStyle: "none",
                margin: "6px 0 0",
                padding: 0,
                display: "flex",
                flexDirection: "column",
                gap: 4,
              }}
            >
              {group.history.map((h) => {
                const dateLabel = formatRetrievedShort(h);
                return (
                  <li
                    key={h.findingId}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      fontSize: 11,
                      color: "color-mix(in srgb, var(--color-text) 68%, transparent)",
                    }}
                  >
                    <ProviderChip provider={h.provider} />
                    <span style={{ overflowWrap: "anywhere" }}>
                      {displayFindingValue(group.axis, h.value)}
                    </span>
                    {dateLabel && (
                      <span
                        style={{
                          marginLeft: "auto",
                          fontSize: 10,
                          color: "color-mix(in srgb, var(--color-text) 42%, transparent)",
                          fontVariantNumeric: "tabular-nums",
                        }}
                      >
                        {dateLabel}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// Enum options for abstain axes that are picklists in the rubric. Two of
// them (servicesFit, mdPedigree) split by model — CF vs CS. Everything
// numeric / boolean / free-text is handled elsewhere via axisInputKind.
function enumOptionsFor(editKey: string, model: Model): string[] {
  switch (editKey) {
    case "servicesFit":
      return (model === "CS" ? CS_SERVICES_OPTS : CF_SERVICES_OPTS).map((o) => o.label);
    case "mdPedigree":
      return (model === "CS" ? CS_MD_OPTS : CF_MD_OPTS).map((o) => o.label);
    case "balanceSheetPrincipal":
      return CS_BSP_OPTS.map((o) => o.label);
    case "coverageModel":
      return ["Single Coverage Focus", "Multi-Coverage Focus", "Generalist Focus"];
    default:
      return [];
  }
}

function AbstainFindingCard({
  finding,
  firmModel,
  applyEdit,
}: {
  finding: FindingLike;
  firmModel: Model;
  // Typed apply — mirrors AxisCard so the abstain path doesn't need to
  // round-trip through the legacy coerce-in-parent handler.
  applyEdit: (editKey: string, value: string | number | boolean) => void;
}): React.ReactElement {
  const rawAxis = (finding.axis ?? "").trim().toLowerCase();
  const editKey = FINDING_AXIS_TO_KEY[rawAxis];
  const kind = editKey === undefined ? "text" : axisInputKind(editKey);
  const [text, setText] = React.useState("");
  const border = "1px solid color-mix(in srgb, #cf7070 45%, transparent)";

  const submitText = (): void => {
    if (editKey === undefined || text.trim() === "") {
      return;
    }
    const coerced = coerceFindingValue(editKey, text);
    if (coerced === undefined) {
      return;
    }
    applyEdit(editKey, coerced);
    setText("");
  };

  const submitBool = (v: boolean): void => {
    if (editKey === undefined) {
      return;
    }
    applyEdit(editKey, v);
  };

  const submitEnum = (v: string): void => {
    if (editKey === undefined || v === "") {
      return;
    }
    applyEdit(editKey, v);
  };

  const shell = (body: React.ReactNode): React.ReactElement => (
    <div style={findingCardShell(border)}>
      <div
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}
      >
        <span
          style={{ fontSize: 11, color: "color-mix(in srgb, var(--color-text) 52%, transparent)" }}
        >
          {displayAxis(finding.axis)}
        </span>
        <FindingStatusChip status={"abstained"} />
      </div>
      <div style={{ fontSize: 13, color: "#e79191", marginTop: 4, fontWeight: 500 }}>
        No source had this, needs you
      </div>
      {body}
    </div>
  );

  // Axis the client can't route to a firm field — degrade to disabled text
  // input with a note rather than pretending the input does anything.
  if (editKey === undefined) {
    return shell(
      <div style={{ marginTop: 8, fontSize: 11, color: "#e79191" }}>
        Not routable. Enter this value in the axis breakdown above.
      </div>,
    );
  }

  if (kind === "boolean") {
    const passWhen = HARD_GATE_PASS_WHEN[editKey] ?? true;
    return shell(
      <Segmented<boolean>
        style={{ marginTop: 8 }}
        ariaLabel={`${displayAxis(finding.axis)}: Pass or Fail`}
        options={[
          { label: "Pass", value: passWhen },
          { label: "Fail", value: !passWhen },
        ]}
        // The conflict prompt asks for a fresh call; nothing is preselected.
        value={undefined}
        onChange={submitBool}
      />,
    );
  }

  if (kind === "enum") {
    const options = enumOptionsFor(editKey, firmModel);
    return shell(
      <div style={{ marginTop: 8, display: "flex", gap: 6, flexDirection: "column" }}>
        <select
          className="input"
          value=""
          onChange={(e) => submitEnum(e.target.value)}
          style={{ height: 32 }}
          aria-label={`${displayAxis(finding.axis)} value`}
        >
          <option value="" disabled>
            Pick a value…
          </option>
          {options.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      </div>,
    );
  }

  const numeric = kind === "number";
  const unit = numeric ? NUMERIC_UNIT[editKey] : undefined;
  return shell(
    <>
      <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 6 }}>
        <input
          className="input"
          type={numeric ? "number" : "text"}
          inputMode={numeric ? "decimal" : undefined}
          placeholder={numeric ? "0" : "Enter value…"}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              submitText();
            }
          }}
          style={{
            flex: 1,
            height: 32,
            borderColor: "color-mix(in srgb, #cf7070 40%, transparent)",
          }}
        />
        {unit !== undefined && (
          <span
            style={{
              fontSize: 11,
              color: "color-mix(in srgb, var(--color-text) 55%, transparent)",
              whiteSpace: "nowrap",
            }}
          >
            {unit}
          </span>
        )}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
        <button
          className="btn btn-primary"
          style={{ fontSize: 12, padding: "3px 10px" }}
          disabled={text.trim() === ""}
          onClick={submitText}
        >
          Fill from analyst
        </button>
      </div>
    </>,
  );
}

function ConflictFindingCard({
  findings,
  onApply,
}: {
  findings: FindingLike[];
  onApply: (axis: string, value: string) => void;
}): React.ReactElement {
  const resolve = useOsdkAction(resolveConflictAction);
  const axisRaw = findings[0]?.axis ?? "unknown";
  const axis = displayAxis(axisRaw);
  const [a, b] = findings;
  const [threwError, setThrewError] = React.useState<string | null>(null);

  const pick = async (chosen: FindingLike, rejected: FindingLike): Promise<void> => {
    setThrewError(null);
    try {
      // Both `chosen` and `rejected` here are the raw WireObject rows from
      // the ResearchFinding query (FindingLike is a shape-only cast). The
      // action needs the objects themselves so the ontology can traverse
      // and mutate them — never IDs.
      await resolve.applyAction({
        chosenFinding: chosen,
        rejectedFinding: rejected,
        chosenValue: chosen.value ?? "",
      } as never);
      // Only after the ontology confirms the resolve, mirror the choice
      // into the local edit map so the axis breakdown reflects it.
      onApply(chosen.axis ?? "", chosen.value ?? "");
    } catch (e) {
      setThrewError(String(e));
    }
  };

  const errorText = resolve.error !== undefined ? String(resolve.error) : threwError;

  return (
    <div style={findingCardShell("1px solid color-mix(in srgb, #cba24f 40%, transparent)")}>
      <div
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}
      >
        <span
          style={{ fontSize: 11, color: "color-mix(in srgb, var(--color-text) 52%, transparent)" }}
        >
          {axis}
        </span>
        <span
          style={{
            fontSize: 10,
            padding: "2px 7px",
            borderRadius: "var(--radius-chip)",
            color: "#e6c878",
            background: "rgba(203,162,79,.20)",
          }}
        >
          Conflict
        </span>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        {[a, b].filter(Boolean).map((f, i) => {
          const other = i === 0 ? b : a;
          const disabled = resolve.isPending || !other;
          return (
            <button
              key={f.findingId}
              type="button"
              onClick={() => {
                if (other) {
                  void pick(f, other);
                }
              }}
              disabled={disabled}
              style={{
                flex: 1,
                border: "1px solid var(--color-divider)",
                borderRadius: "var(--radius-chip)",
                padding: 8,
                background: "none",
                color: "inherit",
                cursor: disabled ? "default" : "pointer",
                textAlign: "left",
                font: "inherit",
              }}
              title={`Accept ${f.provider ? providerLabel(f.provider) : "this source"} and mark the other as rejected`}
            >
              <div
                style={{
                  fontSize: 10,
                  color: "color-mix(in srgb, var(--color-text) 50%, transparent)",
                }}
              >
                {f.provider ? providerLabel(f.provider) : "—"}
              </div>
              <div
                style={{
                  fontSize: 16,
                  fontWeight: 600,
                  color: "#e6c878",
                  overflowWrap: "anywhere",
                }}
              >
                {/* Route through the shared vocab so gate conflicts read
                    Pass / Fail (matching the gates row + conflict prompt)
                    instead of leaking raw "true" / "false" strings. */}
                {displayFindingValue(f.axis, f.value)}
              </div>
              <div
                style={{
                  fontSize: 10,
                  color: "var(--color-accent)",
                  marginTop: 4,
                }}
              >
                {resolve.isPending
                  ? "Resolving…"
                  : `Accept ${f.provider ? providerLabel(f.provider) : ""} →`}
              </div>
            </button>
          );
        })}
      </div>
      <div
        style={{
          fontSize: 10,
          color: "color-mix(in srgb, var(--color-text) 45%, transparent)",
          marginTop: 4,
        }}
      >
        Pick the source you trust. Resolves to verified.
      </div>
      {errorText !== null && (
        <div
          style={{
            marginTop: 8,
            padding: "6px 10px",
            borderRadius: "var(--radius-md)",
            background: "rgba(207,112,112,.12)",
            color: "#e79191",
            fontSize: 11,
          }}
        >
          Resolve failed: {errorText}
        </div>
      )}
    </div>
  );
}

function FindingsSection({
  firm,
  actionFirm,
  edits,
  onApply,
  applyEdit,
  pendingVerify,
  queueVerify,
}: {
  firm: FirmView;
  actionFirm: unknown;
  edits: EditMap;
  // Legacy raw-string apply — still used by AbstainFindingCard (analyst-
  // typed) and ConflictFindingCard (winner-of-two-sources), where the
  // value is already the analyst's chosen answer and no conflict UI is
  // needed. Both feed through setAxis in the parent.
  onApply: (axis: string, value: string) => void;
  // Typed apply used by AxisCard after decideAccept/decideVerify. Values
  // are already coerced to the shape enrichFirmAction expects.
  applyEdit: (editKey: string, value: string | number | boolean) => void;
  // Verifications stage locally and flush on Commit enrichment — the panel
  // owns the queue so it resets alongside the edit map.
  pendingVerify: Record<string, string | true>;
  queueVerify: (f: FindingLike, overrideValue?: string) => void;
}): React.ReactElement {
  const firmId = firm.firmId ?? "";
  const { data, isLoading, error } = useOsdkObjects(ResearchFinding, {
    where: { firmId: { $eq: firmId } },
    pageSize: 100,
  });
  const runAgent = useOsdkAction(runAgentEnrichmentAction);
  // resolveConflictAction now lives inside ConflictFindingCard so per-card
  // errors surface next to the buttons that triggered them.

  // Staged verifications render as verified ahead of the commit that will
  // persist them — same overlay the panel applies for the axis chips.
  const findings = React.useMemo(() => {
    const raw = (data ?? []) as unknown as FindingLike[];
    return raw.map((f) =>
      f.findingId !== undefined && f.findingId !== "" && pendingVerify[f.findingId] !== undefined
        ? { ...f, findingStatus: "verified", verifiedByHuman: true }
        : f,
    );
  }, [data, pendingVerify]);

  // Server-side dedupe now marks prior same-(firm, axis, provider) findings
  // superseded on every agent run and never touches human-verified ones —
  // so the visible set is simply everything that isn't marked superseded.
  // From there we group by axis and pick one authoritative finding per axis.
  const groups = React.useMemo(() => {
    const visible = findings.filter((f) => (f.findingStatus ?? "").toLowerCase() !== "superseded");

    const conflictMap = new Map<string, FindingLike[]>();
    const nonConflict: FindingLike[] = [];
    for (const f of visible) {
      const gid = f.conflictGroupId;
      if (gid !== null && gid !== undefined && gid !== "") {
        const arr = conflictMap.get(gid) ?? [];
        arr.push(f);
        conflictMap.set(gid, arr);
      } else {
        nonConflict.push(f);
      }
    }

    const byAxis = new Map<string, FindingLike[]>();
    for (const f of nonConflict) {
      const ax = f.axis ?? "";
      const arr = byAxis.get(ax) ?? [];
      arr.push(f);
      byAxis.set(ax, arr);
    }

    const proposed: AxisGroup[] = [];
    const abstained: AxisGroup[] = [];
    const verified: AxisGroup[] = [];
    for (const [axis, arr] of byAxis) {
      const authoritative = pickAuthoritative(arr);
      const history = arr.filter((x) => x.findingId !== authoritative.findingId);
      const group: AxisGroup = {
        axis,
        authoritative,
        history,
        state: classifyAxis(authoritative),
      };
      if (group.state === "proposed") {
        proposed.push(group);
      } else if (group.state === "abstained") {
        abstained.push(group);
      } else {
        verified.push(group);
      }
    }
    // Stable, human-friendly order inside each group: by axis label.
    const byLabel = (a: AxisGroup, b: AxisGroup): number =>
      displayAxis(a.axis).localeCompare(displayAxis(b.axis));
    proposed.sort(byLabel);
    abstained.sort(byLabel);
    verified.sort(byLabel);

    return { conflicts: [...conflictMap.values()], proposed, abstained, verified };
  }, [findings]);

  const [abstainOpen, setAbstainOpen] = React.useState(false);
  const [verifiedOpen, setVerifiedOpen] = React.useState(false);
  const isEmpty =
    groups.conflicts.length === 0 &&
    groups.proposed.length === 0 &&
    groups.abstained.length === 0 &&
    groups.verified.length === 0;

  const getCurrent = React.useCallback(
    (editKey: string) =>
      effectiveAxisValue(firm as unknown as Record<string, unknown>, edits, editKey),
    [firm, edits],
  );

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 8,
        }}
      >
        <Kicker>Findings</Kicker>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span
            style={{
              fontSize: 11,
              color: "color-mix(in srgb, var(--color-text) 48%, transparent)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {isLoading
              ? "loading…"
              : `${groups.conflicts.length} conflict${groups.conflicts.length === 1 ? "" : "s"} · ${groups.proposed.length} proposed · ${groups.abstained.length} abstained · ${groups.verified.length} verified · axes`}
          </span>
          <button
            className="btn btn-secondary"
            style={{ fontSize: 12, padding: "5px 12px" }}
            disabled={runAgent.isPending}
            onClick={() => void runAgent.applyAction({ firm: actionFirm } as never)}
            title="Re-query sources and propose fresh findings for unresolved axes"
          >
            {runAgent.isPending ? "Running…" : "Run agent"}
          </button>
        </div>
      </div>

      {runAgent.error !== undefined && (
        <div
          style={{
            padding: "8px 12px",
            marginBottom: 8,
            borderRadius: "var(--radius-md)",
            background: "rgba(207,112,112,.12)",
            color: "#e79191",
            fontSize: 12,
          }}
        >
          Agent run failed: {formatActionError(runAgent.error)}
        </div>
      )}
      {error && (
        <div
          style={{
            padding: "8px 12px",
            marginBottom: 8,
            borderRadius: "var(--radius-md)",
            background: "rgba(207,112,112,.12)",
            color: "#e79191",
            fontSize: 12,
          }}
        >
          {String(error)}
        </div>
      )}

      {!isLoading && isEmpty ? (
        <div
          style={{
            padding: "40px 20px",
            border: "1px dashed var(--color-divider)",
            borderRadius: "var(--radius-md)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 12,
            textAlign: "center",
          }}
        >
          <span
            style={{
              width: 40,
              height: 40,
              borderRadius: "var(--radius-lg)",
              background: "color-mix(in srgb, var(--color-accent) 12%, transparent)",
              display: "grid",
              placeItems: "center",
              color: "var(--color-accent)",
            }}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path d="M12 2v6M12 22v-6M4.9 4.9l4.2 4.2M14.9 14.9l4.2 4.2M2 12h6M22 12h-6" />
            </svg>
          </span>
          <div style={{ fontSize: 16, fontWeight: 500 }}>No enrichment run yet</div>
          <p
            style={{
              margin: 0,
              fontSize: 13,
              color: "color-mix(in srgb, var(--color-text) 60%, transparent)",
              maxWidth: "40ch",
            }}
          >
            Beacon hasn&rsquo;t scored this firm against the rubric. Run agent enrichment to pull
            findings from every source.
          </p>
          <button
            className="btn btn-primary"
            style={{ marginTop: 4 }}
            disabled={runAgent.isPending}
            onClick={() => void runAgent.applyAction({ firm: actionFirm } as never)}
            title="Re-query sources and propose fresh findings for unresolved axes"
          >
            {runAgent.isPending ? "Running…" : "Run agent enrichment"}
          </button>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {groups.conflicts.length > 0 && (
            <div>
              <SectionHeader
                label={groups.conflicts.length === 1 ? "Conflict" : "Conflicts"}
                count={groups.conflicts.length}
              />
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                  gap: 12,
                }}
              >
                {groups.conflicts.map((pair, i) => (
                  <ConflictFindingCard key={`conflict-${i}`} findings={pair} onApply={onApply} />
                ))}
              </div>
            </div>
          )}

          {groups.proposed.length > 0 && (
            <div>
              <SectionHeader label="Proposed" count={groups.proposed.length} />
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                  gap: 12,
                }}
              >
                {groups.proposed.map((g) => (
                  <AxisCard
                    key={`prop-${g.axis}`}
                    group={g}
                    getCurrent={getCurrent}
                    applyEdit={applyEdit}
                    verifyFinding={queueVerify}
                    verifying={false}
                  />
                ))}
              </div>
            </div>
          )}

          {groups.abstained.length > 0 && (
            <div
              style={{
                border: "1px solid color-mix(in srgb, #cf7070 30%, transparent)",
                borderRadius: "var(--radius-md)",
                background: "rgba(207,112,112,.06)",
              }}
            >
              <button
                type="button"
                onClick={() => setAbstainOpen((v) => !v)}
                aria-expanded={abstainOpen}
                style={{
                  width: "100%",
                  padding: 12,
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  background: "transparent",
                  border: "none",
                  color: "inherit",
                  cursor: "pointer",
                  font: "inherit",
                  textAlign: "left",
                }}
              >
                <span
                  style={{
                    display: "inline-grid",
                    placeItems: "center",
                    width: 18,
                    height: 18,
                    borderRadius: "var(--radius-chip)",
                    background: "rgba(207,112,112,.24)",
                    color: "#f4abab",
                    fontSize: 11,
                    fontWeight: 600,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {groups.abstained.length}
                </span>
                <span style={{ fontSize: 13, color: "#e79191", fontWeight: 500 }}>
                  {groups.abstained.length === 1 ? "1 axis" : `${groups.abstained.length} axes`} had
                  no source, needs you
                </span>
                <span
                  style={{
                    marginLeft: "auto",
                    fontSize: 11,
                    color: "color-mix(in srgb, var(--color-text) 50%, transparent)",
                  }}
                >
                  {abstainOpen ? "collapse ▲" : "expand ▼"}
                </span>
              </button>
              {abstainOpen && (
                <div
                  style={{
                    padding: "0 12px 12px",
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                    gap: 12,
                  }}
                >
                  {groups.abstained.map((g) => (
                    <AbstainFindingCard
                      key={g.authoritative.findingId}
                      finding={g.authoritative}
                      firmModel={(firm.firmType ?? "").trim().toLowerCase() === "cs" ? "CS" : "CF"}
                      applyEdit={applyEdit}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {groups.verified.length > 0 && (
            <div
              style={{
                border: "1px solid var(--color-divider)",
                borderRadius: "var(--radius-md)",
                background: "color-mix(in srgb, var(--color-neutral-900) 40%, transparent)",
              }}
            >
              <button
                type="button"
                onClick={() => setVerifiedOpen((v) => !v)}
                aria-expanded={verifiedOpen}
                style={{
                  width: "100%",
                  padding: 12,
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  background: "transparent",
                  border: "none",
                  color: "inherit",
                  cursor: "pointer",
                  font: "inherit",
                  textAlign: "left",
                }}
              >
                <span
                  style={{
                    display: "inline-grid",
                    placeItems: "center",
                    width: 18,
                    height: 18,
                    borderRadius: "var(--radius-chip)",
                    background: "rgba(87,185,138,.20)",
                    color: "#9be9ca",
                    fontSize: 11,
                    fontWeight: 600,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {groups.verified.length}
                </span>
                <span style={{ fontSize: 13, fontWeight: 500 }}>
                  Verified ·{" "}
                  {groups.verified.length === 1 ? "1 axis" : `${groups.verified.length} axes`}{" "}
                  confirmed
                </span>
                <span
                  style={{
                    marginLeft: "auto",
                    fontSize: 11,
                    color: "color-mix(in srgb, var(--color-text) 50%, transparent)",
                  }}
                >
                  {verifiedOpen ? "collapse ▲" : "expand ▼"}
                </span>
              </button>
              {verifiedOpen && (
                <div
                  style={{
                    padding: "0 12px 12px",
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                    gap: 12,
                  }}
                >
                  {groups.verified.map((g) => (
                    <AxisCard
                      key={`ver-${g.axis}`}
                      group={g}
                      getCurrent={getCurrent}
                      applyEdit={applyEdit}
                      verifyFinding={queueVerify}
                      verifying={false}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SectionHeader({ label, count }: { label: string; count: number }): React.ReactElement {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        marginBottom: 8,
      }}
    >
      <Kicker>{label}</Kicker>
      <span
        style={{
          fontSize: 10,
          padding: "1px 6px",
          borderRadius: "var(--radius-chip)",
          background: "var(--color-neutral-800)",
          color: "color-mix(in srgb, var(--color-text) 62%, transparent)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {count}
      </span>
    </div>
  );
}

// ─── Confirm-before-advancing checklist ─────────────────────────────────

function ConfirmChecklist({
  firm,
  mirror,
  edits,
}: {
  firm: FirmView;
  mirror: MirrorResult;
  edits: EditMap;
}): React.ReactElement {
  const knownAxes = mirror.axisScores.filter((a) => a.known).length;
  const totalAxes = mirror.axisScores.length;
  const gatesSet = HARD_GATES.filter((g) => {
    const editVal = edits[g.editKey];
    const onFile = firm[g.readKey];
    return typeof editVal === "boolean" || onFile === true || onFile === false;
  }).length;

  const items = [
    {
      label: "All rubric axes have a signal",
      detail: `${knownAxes}/${totalAxes} axes known`,
      ok: knownAxes === totalAxes,
    },
    {
      label: "Hard gates recorded",
      detail: `${gatesSet}/${HARD_GATES.length} gates answered`,
      ok: gatesSet === HARD_GATES.length,
    },
    {
      label: mirror.hardRejected ? "Hard screen (rejected)" : "Cleared the hard screen",
      detail: mirror.hardRejected ? mirror.rejectReason : "no rejection triggers",
      ok: !mirror.hardRejected,
    },
  ];
  const done = items.filter((i) => i.ok).length;
  const barPct = Math.round((done / items.length) * 100);

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 8,
        }}
      >
        <Kicker>Confirm before advancing</Kicker>
        <span
          style={{
            fontSize: 11,
            color: "color-mix(in srgb, var(--color-text) 45%, transparent)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {done}/{items.length}
        </span>
      </div>
      <div
        style={{
          height: 4,
          borderRadius: "var(--radius-xs)",
          background: "var(--color-neutral-800)",
          marginBottom: 12,
          position: "relative",
          overflow: "hidden",
        }}
      >
        <span
          style={{
            display: "block",
            height: "100%",
            width: `${barPct}%`,
            background: "var(--color-accent)",
          }}
        />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 13 }}>
        {items.map((it) => (
          <label
            key={it.label}
            style={{ display: "flex", alignItems: "flex-start", gap: 8, cursor: "default" }}
          >
            <span
              aria-hidden
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 16,
                height: 16,
                marginTop: 1,
                borderRadius: "var(--radius-sm)",
                border: `1.5px solid ${it.ok ? "var(--color-accent)" : "var(--color-divider)"}`,
                background: it.ok ? "var(--color-accent)" : "transparent",
                color: "var(--color-bg)",
                fontSize: 10,
                fontWeight: 700,
                flex: "none",
              }}
            >
              {it.ok ? "✓" : ""}
            </span>
            <span style={{ minWidth: 0 }}>
              <span style={{ fontWeight: 500 }}>{it.label}</span>
              <span
                style={{
                  fontSize: 11,
                  color: "color-mix(in srgb, var(--color-text) 45%, transparent)",
                  display: "block",
                }}
              >
                {it.detail}
              </span>
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}

// ─── Source excerpts ────────────────────────────────────────────────────

function SourceExcerpts({ findings }: { findings: FindingLike[] }): React.ReactElement | null {
  const withExcerpts = findings
    .filter((f) => f.sourceExcerpt && f.sourceExcerpt !== "")
    .slice(0, 4);
  if (withExcerpts.length === 0) {
    return null;
  }
  return (
    <div>
      <Kicker style={{ marginBottom: 8 }}>Source excerpts</Kicker>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {withExcerpts.map((f) => (
          <div
            key={f.findingId}
            style={{
              borderLeft: "2px solid var(--color-divider)",
              padding: "2px 0 2px 11px",
            }}
          >
            <div
              style={{
                fontSize: 13,
                color: "color-mix(in srgb, var(--color-text) 82%, transparent)",
                fontStyle: "italic",
              }}
            >
              &ldquo;{f.sourceExcerpt}&rdquo;
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginTop: 4,
              }}
            >
              <ProviderChip provider={f.provider} />
              <span
                style={{
                  fontSize: 10,
                  color: "color-mix(in srgb, var(--color-text) 42%, transparent)",
                }}
              >
                {f.axis ?? ""}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── "Your call" rail (sticky footer) ───────────────────────────────────

function YourCallRail({
  firm,
  actionFirm,
  onCommit,
  dirty,
  enrichPending,
  enrichError,
}: {
  firm: FirmView;
  actionFirm: unknown;
  onCommit: () => void;
  dirty: boolean;
  enrichPending: boolean;
  enrichError: unknown;
}): React.ReactElement {
  const qualify = useOsdkAction(qualifyFirmAction);
  const reject = useOsdkAction(rejectFirmAction);
  const advance = useOsdkAction(advanceStageAction);
  const observable = useObservableClient();
  const [note, setNote] = React.useState("");

  // Function-backed actions report their created objects (the ReviewDecision)
  // but not reliably the firm they modified, so the automatic cache
  // invalidation refreshes the decision-memory banner while the firm header
  // keeps its stale lifecycle — and the rail then offers a transition the
  // server has already completed. Invalidate the firm explicitly after every
  // successful decision.
  const refreshFirm = React.useCallback((): void => {
    void observable.invalidateObjects(actionFirm as never);
  }, [observable, actionFirm]);

  // Derive the advance target from lifecycleState FIRST — the same field
  // the header chip trusts. The advance function updates lifecycleState
  // but not currentStage, so preferring currentStage left the rail
  // offering "Advance → In Review" on a firm already In Review (the chip
  // and the button disagreed, and the server rightly rejected the repeat).
  const rawStage = firm.lifecycleState ?? firm.currentStage ?? null;
  const nextState = nextLifecycle(rawStage);
  const stageLabel =
    normalizeLifecycle(rawStage) ??
    (rawStage !== null && rawStage.trim() !== "" ? rawStage.trim() : "Discovered");
  // Firms in a terminal lifecycle (Qualified / Rejected) no longer accept
  // Advance or Qualify — surface a muted "Terminal state · X" line instead.
  // Terminal detection has to inspect BOTH fields (lifecycleState *and*
  // currentStage): the firm header chip prefers lifecycleState, and in
  // practice a firm can be Qualified in one field while currentStage still
  // reads "In Review" (Qualify flips lifecycleState without rewinding the
  // ordinal stage). If we only look at currentStage the rail keeps offering
  // Advance / Qualify on a Qualified firm — exactly the bug reported.
  const lifecycleLower = (firm.lifecycleState ?? "").trim().toLowerCase();
  const stageLower = (firm.currentStage ?? "").trim().toLowerCase();
  const terminalKind: "qualified" | "rejected" | null =
    lifecycleLower === "rejected" || stageLower === "rejected"
      ? "rejected"
      : lifecycleLower === "qualified" || stageLower === "qualified"
        ? "qualified"
        : null;

  const onQualify = (): void => {
    void qualify.applyAction({ firm: actionFirm } as never).then(refreshFirm);
  };
  const onAdvance = (): void => {
    if (nextState === null) {
      return;
    }
    void advance
      .applyAction({ firm: actionFirm, targetState: nextState } as never)
      .then(refreshFirm);
  };
  const onReject = (): void => {
    // Note preserved if reject fails (only cleared on success).
    void reject
      .applyAction({ firm: actionFirm, rejectionRationale: note.trim() } as never)
      .then(() => {
        setNote("");
        refreshFirm();
      });
  };

  const canReject = note.trim().length > 0 && !reject.isPending;
  const anyError =
    enrichError !== undefined ||
    qualify.error !== undefined ||
    reject.error !== undefined ||
    advance.error !== undefined;

  return (
    <div
      style={{
        borderTop: "1px solid var(--color-divider)",
        background: "color-mix(in srgb, var(--color-neutral-900) 55%, transparent)",
        padding: "12px 24px",
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      {anyError && (
        <div
          style={{
            padding: 12,
            borderRadius: "var(--radius-md)",
            background: "rgba(207,112,112,.12)",
            border: "1px solid color-mix(in srgb, #cf7070 40%, transparent)",
            fontSize: 12,
            color: "#e79191",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 500 }}>
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path d="M12 9v4M12 17h.01" />
              <circle cx="12" cy="12" r="9" />
            </svg>
            Couldn&rsquo;t save your decision. Your note is preserved below.
          </div>
          {enrichError !== undefined && (
            <div style={{ marginTop: 4 }}>Commit: {formatActionError(enrichError)}</div>
          )}
          {qualify.error !== undefined && (
            <div style={{ marginTop: 4 }}>Qualify: {formatActionError(qualify.error)}</div>
          )}
          {advance.error !== undefined && (
            <div style={{ marginTop: 4 }}>Advance: {formatActionError(advance.error)}</div>
          )}
          {reject.error !== undefined && (
            <div style={{ marginTop: 4 }}>Reject: {formatActionError(reject.error)}</div>
          )}
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "auto 1fr auto",
          gap: 12,
          alignItems: "start",
        }}
      >
        {/* Actions */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 240 }}>
          <Kicker>Your call</Kicker>
          <button
            className="btn btn-primary btn-block"
            style={{
              justifyContent: "space-between",
              background: "color-mix(in srgb, var(--color-accent) 15%, transparent)",
            }}
            disabled={!dirty || enrichPending}
            onClick={onCommit}
            title="Save verified state without moving the firm"
          >
            <span>{enrichPending ? "Saving…" : "Commit enrichment"}</span>
            <kbd
              style={{
                fontSize: 10,
                border: "1px solid var(--color-accent)",
                borderRadius: "var(--radius-sm)",
                padding: "1px 5px",
                opacity: 0.85,
              }}
            >
              ⌘↵
            </kbd>
          </button>
          {terminalKind === null ? (
            <>
              <button
                className="btn btn-primary btn-block"
                style={{ justifyContent: "space-between", marginTop: 0 }}
                disabled={advance.isPending || nextState === null}
                onClick={onAdvance}
                // Canonical explanation first, then the specific target the
                // analyst is about to move this firm to.
                title={
                  nextState === null
                    ? `${stageLabel} is the final tracked stage. No further advance available.`
                    : `Move one stage down the pipeline: ${stageLabel} to ${nextState}`
                }
              >
                <span>
                  {advance.isPending
                    ? "Advancing…"
                    : nextState !== null
                      ? `Advance → ${nextState}`
                      : `${stageLabel} · no next stage`}
                </span>
                <kbd
                  style={{
                    fontSize: 10,
                    border: "1px solid var(--color-accent)",
                    borderRadius: "var(--radius-sm)",
                    padding: "1px 5px",
                    opacity: nextState === null ? 0.4 : 0.85,
                  }}
                >
                  2
                </kbd>
              </button>
              <button
                className="btn btn-secondary btn-block"
                style={{ marginTop: 0, justifyContent: "space-between" }}
                disabled={qualify.isPending}
                onClick={onQualify}
                title="Terminal yes"
              >
                <span>{qualify.isPending ? "Qualifying…" : "Qualify firm"}</span>
                <kbd
                  style={{
                    fontSize: 10,
                    border: "1px solid var(--color-divider)",
                    borderRadius: "var(--radius-sm)",
                    padding: "1px 5px",
                    opacity: 0.7,
                  }}
                >
                  Q
                </kbd>
              </button>
              <button
                className="btn btn-secondary btn-block"
                style={{
                  marginTop: 0,
                  justifyContent: "space-between",
                  color: REJECT_TEXT,
                  borderColor: REJECT_BORDER,
                }}
                disabled={!canReject}
                onClick={onReject}
                title={note.trim() === "" ? "A note is required to reject" : "Reject firm"}
              >
                <span>{reject.isPending ? "Rejecting…" : "Reject…"}</span>
                <kbd
                  style={{
                    fontSize: 10,
                    border: `1px solid ${REJECT_BORDER}`,
                    borderRadius: "var(--radius-sm)",
                    padding: "1px 5px",
                    opacity: 0.85,
                  }}
                >
                  R
                </kbd>
              </button>
            </>
          ) : (
            <div
              style={{
                marginTop: 2,
                padding: 12,
                borderRadius: "var(--radius-md)",
                border: "1px dashed var(--color-divider)",
                fontSize: 12,
                color: "color-mix(in srgb, var(--color-text) 55%, transparent)",
              }}
              title="Advance, Qualify, and Reject are unavailable once a firm reaches Qualified or Rejected."
            >
              Terminal state · {terminalKind === "qualified" ? "Qualified" : "Rejected"}
            </div>
          )}
        </div>

        {/* Decision note */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <Kicker>Decision note</Kicker>
          <textarea
            className="input"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={
              terminalKind === null
                ? "Optional for advance/qualify · required to reject…"
                : "Firm is in a terminal state. Notes here won't be attached to a decision."
            }
            style={{ minHeight: 104, lineHeight: 1.45 }}
          />
          <div
            style={{
              fontSize: 11,
              color:
                terminalKind !== null
                  ? "color-mix(in srgb, var(--color-text) 45%, transparent)"
                  : note.trim() === ""
                    ? "#e79191"
                    : "color-mix(in srgb, var(--color-text) 45%, transparent)",
            }}
          >
            {terminalKind !== null
              ? "No decision actions available in a terminal state."
              : note.trim() === ""
                ? "A note is required to reject."
                : "Note captured for reject rationale."}
          </div>
        </div>

        {/* Shortcuts */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 220 }}>
          <Kicker>Shortcuts</Kicker>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "auto 1fr",
              gap: "6px 10px",
              fontSize: 12,
              color: "color-mix(in srgb, var(--color-text) 62%, transparent)",
            }}
          >
            <span style={{ display: "flex", gap: 4 }}>
              <kbd style={kbdStyle}>↑</kbd>
              <kbd style={kbdStyle}>↓</kbd>
            </span>
            <span>Focus axis / gate</span>
            <span style={{ display: "flex", gap: 4 }}>
              <kbd style={kbdStyle}>0</kbd>
              <kbd style={kbdStyle}>1</kbd>
              <kbd style={kbdStyle}>2</kbd>
            </span>
            <span>Set band on focused axis</span>
            <span style={{ display: "flex", gap: 4 }}>
              <kbd style={kbdStyle}>P</kbd>
              <kbd style={kbdStyle}>F</kbd>
            </span>
            <span>Pass / Fail focused hard gate</span>
            <span>
              <kbd style={kbdStyle}>⌘/Ctrl</kbd>+<kbd style={kbdStyle}>↵</kbd>
            </span>
            <span>Commit enrichment</span>
          </div>
        </div>
      </div>
    </div>
  );
}

const kbdStyle: React.CSSProperties = {
  fontSize: 10,
  border: "1px solid var(--color-divider)",
  borderRadius: "var(--radius-sm)",
  padding: "1px 6px",
  fontFamily: "inherit",
};

// ─── Panel: one selected firm ───────────────────────────────────────────

function EnrichmentPanel({
  firm,
  actionFirm,
  allFirms,
  firmsLoading,
  activeConfigs,
  configsLoading,
}: {
  firm: FirmView;
  actionFirm: unknown;
  allFirms: FirmView[];
  firmsLoading: boolean;
  activeConfigs: readonly ActiveConfigRule[];
  configsLoading: boolean;
}): React.ReactElement {
  const [edits, setEdits] = React.useState<EditMap>({});
  // Verifications staged locally — findingId → true (plain verify) or the
  // override value string ("Keep mine"). Nothing reaches verifyFindingAction
  // until Commit enrichment: walking away from the desk discards these,
  // exactly like uncommitted axis edits. Commit is the one transaction
  // boundary for both the firm fields and the finding statuses.
  const [pendingVerify, setPendingVerify] = React.useState<Record<string, string | true>>({});
  const [flushError, setFlushError] = React.useState<string | null>(null);
  const [focused, setFocused] = React.useState<string | undefined>(undefined);
  const [elapsed, setElapsed] = React.useState(0);
  const enrich = useOsdkAction(enrichFirmAction);
  const verify = useOsdkAction(verifyFindingAction);
  const observable = useObservableClient();

  React.useEffect(() => {
    setEdits({});
    setPendingVerify({});
    setFlushError(null);
    setFocused(undefined);
    setElapsed(0);
    const timer = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(timer);
  }, [firm.firmId]);

  const base = toScoreInput(firm);
  const before = mirrorScore(base);
  const after = mirrorScore(buildMerged(base, edits));

  const setAxis = React.useCallback((key: string, value: string | number | boolean) => {
    setEdits((prev) => ({ ...prev, [key]: value }));
  }, []);

  const queueVerify = React.useCallback((f: FindingLike, overrideValue?: string): void => {
    const id = f.findingId;
    if (id === undefined || id === "") {
      return;
    }
    setPendingVerify((prev) => ({ ...prev, [id]: overrideValue ?? true }));
  }, []);

  const dirty = Object.keys(edits).length > 0 || Object.keys(pendingVerify).length > 0;

  // Findings query (shared by axis breakdown + section + excerpts).
  const firmId = firm.firmId ?? "";
  const { data: findingsData } = useOsdkObjects(ResearchFinding, {
    where: { firmId: { $eq: firmId } },
    pageSize: 100,
  });
  const findings = React.useMemo(
    () => (findingsData ?? []) as unknown as FindingLike[],
    [findingsData],
  );
  // Staged verifications render as verified before they're committed — the
  // overlay is display state only; the server still says proposed.
  const overlaidFindings = React.useMemo(
    () =>
      findings.map((f) =>
        f.findingId !== undefined && f.findingId !== "" && pendingVerify[f.findingId] !== undefined
          ? { ...f, findingStatus: "verified", verifiedByHuman: true }
          : f,
      ),
    [findings, pendingVerify],
  );

  const findingsByAxisKey = React.useMemo(() => {
    const m = new Map<string, FindingLike[]>();
    for (const f of overlaidFindings) {
      if ((f.findingStatus ?? "").toLowerCase() === "superseded") {
        continue;
      }
      const key = FINDING_AXIS_TO_KEY[f.axis ?? ""];
      if (key) {
        const arr = m.get(key) ?? [];
        arr.push(f);
        m.set(key, arr);
      }
    }
    return m;
  }, [overlaidFindings]);

  // Re-stage values from findings verified by past commits. The edit map
  // resets on reload / firm switch — without this, a firm could read
  // "9 verified" beside blank axes, a stale preview score, and a Commit
  // button with nothing to send. Reads SERVER state only (never staged
  // verifications), and only fills axes that are unset — firm fields and
  // in-session edits win — so the effect converges: once staged,
  // verifiedBaselineEdits returns [].
  React.useEffect(() => {
    const staged = verifiedBaselineEdits(findings, (editKey) =>
      effectiveAxisValue(firm as unknown as Record<string, unknown>, edits, editKey),
    );
    if (staged.length === 0) {
      return;
    }
    setEdits((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const { editKey, value } of staged) {
        if (!Object.prototype.hasOwnProperty.call(next, editKey)) {
          next[editKey] = value;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [findings, firm, edits]);

  const findingObjById = React.useMemo(() => {
    const m = new Map<string, FindingLike>();
    for (const f of findings) {
      if (f.findingId !== undefined && f.findingId !== "") {
        m.set(f.findingId, f);
      }
    }
    return m;
  }, [findings]);

  const onCommit = React.useCallback(() => {
    const args: Record<string, unknown> = {
      firm: actionFirm,
      fieldsEnteredManually: JSON.stringify(Object.keys(edits)),
    };
    for (const [k, v] of Object.entries(edits)) {
      if (v === "" || v === undefined) {
        continue;
      }
      args[k] = NUMERIC_KEYS.includes(k) ? Number(v) : v;
    }
    void (async () => {
      try {
        await enrich.applyAction(args as never);
      } catch {
        // Surfaced via enrich.error; everything stays staged for retry.
        return;
      }
      // Field write landed — now flush staged verifications. Failures keep
      // their queue entry (and the dirty bit) so a retry re-flushes them.
      const failed: Record<string, string | true> = {};
      let firstError: unknown = null;
      for (const [findingId, ov] of Object.entries(pendingVerify)) {
        const obj = findingObjById.get(findingId);
        if (obj === undefined) {
          continue;
        }
        const vArgs: Record<string, unknown> = { finding: obj };
        if (ov !== true) {
          vArgs.overrideValue = ov;
        }
        try {
          await verify.applyAction(vArgs as never);
        } catch (e) {
          failed[findingId] = ov;
          if (firstError === null) {
            firstError = e;
          }
        }
      }
      setEdits({});
      setPendingVerify(failed);
      setFlushError(firstError === null ? null : String(firstError));
      // The enrich function modifies the firm, but the action's edit
      // response doesn't reliably list it — refresh explicitly so the
      // committed fields land in the axis rows (and the staged-edit
      // hydration sees fresh firm state instead of racing a stale one).
      void observable.invalidateObjects(actionFirm as never);
    })();
  }, [actionFirm, edits, enrich, pendingVerify, findingObjById, verify, observable]);

  // Keyboard shortcuts.
  const focusEntries = React.useMemo(() => {
    const list: string[] = [];
    for (const a of after.axisScores) {
      if (editorForAxis(a.axis, after.model)) {
        list.push(`axis:${a.axis}`);
      }
    }
    for (const g of HARD_GATES) {
      list.push(`gate:${g.editKey}`);
    }
    return list;
  }, [after]);

  const focusRef = React.useRef(focused);
  focusRef.current = focused;
  const entriesRef = React.useRef(focusEntries);
  entriesRef.current = focusEntries;
  const commitRef = React.useRef<() => void>(() => undefined);
  commitRef.current = onCommit;

  React.useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        commitRef.current();
        e.preventDefault();
        return;
      }
      if (e.key === "Escape") {
        setFocused(undefined);
        e.preventDefault();
        return;
      }
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
        return;
      }
      const entries = entriesRef.current;
      const currentIdx = entries.findIndex((x) => x === focusRef.current);
      if (e.key === "ArrowDown") {
        const next = entries[Math.min(entries.length - 1, currentIdx + 1)];
        if (next) {
          setFocused(next);
        }
        e.preventDefault();
        return;
      }
      if (e.key === "ArrowUp") {
        const prev = entries[Math.max(0, currentIdx - 1)];
        if (prev) {
          setFocused(prev);
        }
        e.preventDefault();
        return;
      }
      const entry = entries[currentIdx];
      if (!entry) {
        return;
      }
      if (entry.startsWith("axis:")) {
        const axisLabel = entry.slice(5);
        const ed = editorForAxis(axisLabel, after.model);
        if (ed?.kind === "categorical" && ed.options && ["0", "1", "2"].includes(e.key)) {
          const opt = ed.options.find((o) => o.score === Number(e.key));
          if (opt) {
            setAxis(ed.editKey, opt.label);
          }
          e.preventDefault();
        }
      } else if (entry.startsWith("gate:") && (e.key === "p" || e.key === "f")) {
        // Pass/Fail is polarity-mapped per gate — the stored boolean flips
        // for advisoryConflict / hasStOrBalanceSheet where "true" means
        // "has-problem". Look up the gate's passWhen before writing.
        const gateKey = entry.slice(5);
        const gate = HARD_GATES.find((h) => h.editKey === gateKey);
        if (gate) {
          setAxis(gateKey, e.key === "p" ? gate.passWhen : !gate.passWhen);
        }
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [after.model, setAxis]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <main
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "20px 24px 28px",
          display: "flex",
          flexDirection: "column",
          gap: 16,
          minWidth: 0,
        }}
      >
        <FirmHeader
          firm={firm}
          before={before}
          after={after}
          elapsed={elapsed}
          saving={enrich.isPending}
          activeConfigs={activeConfigs}
          configsLoading={configsLoading}
        />

        <AxisBreakdown
          firm={firm}
          mirror={after}
          edits={edits}
          setAxis={setAxis}
          focused={focused}
          setFocused={setFocused}
          findingsByAxisKey={findingsByAxisKey}
        />

        <DecisionMemory firm={firm} allFirms={allFirms} firmsLoading={firmsLoading} />

        <HardGates
          firm={firm}
          edits={edits}
          setAxis={setAxis}
          focused={focused}
          setFocused={setFocused}
        />

        <FindingsSection
          firm={firm}
          actionFirm={actionFirm}
          edits={edits}
          onApply={(axis, value) => {
            // Legacy path — analyst-typed / conflict-resolved value.
            // Coerce booleans + numbers so a hard-gate axis picks up as
            // typed data rather than being ignored by HardGates' segmented
            // control (which only honors real booleans).
            const key = FINDING_AXIS_TO_KEY[(axis ?? "").trim().toLowerCase()];
            if (key === undefined) {
              return;
            }
            const coerced = coerceFindingValue(key, value);
            if (coerced === undefined) {
              return;
            }
            setAxis(key, coerced);
          }}
          applyEdit={setAxis}
          pendingVerify={pendingVerify}
          queueVerify={queueVerify}
        />

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
          <ConfirmChecklist firm={firm} mirror={after} edits={edits} />
          <SourceExcerpts findings={findings} />
        </div>
      </main>

      <YourCallRail
        firm={firm}
        actionFirm={actionFirm}
        onCommit={onCommit}
        dirty={dirty}
        enrichPending={enrich.isPending}
        enrichError={enrich.error ?? (flushError === null ? undefined : flushError)}
      />
    </div>
  );
}

// ─── Empty state ────────────────────────────────────────────────────────

function EmptyState(): React.ReactElement {
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div style={{ maxWidth: 380, textAlign: "center", padding: 32 }}>
        <span
          style={{
            display: "inline-grid",
            placeItems: "center",
            width: 44,
            height: 44,
            borderRadius: "var(--radius-lg)",
            border: "1px solid var(--color-accent)",
            color: "var(--color-accent)",
            fontSize: 19,
            fontWeight: 600,
            marginBottom: 16,
          }}
        >
          B
        </span>
        <div style={{ fontSize: 19, fontWeight: 500, marginBottom: 8 }}>
          Pick a firm from the queue
        </div>
        <p
          style={{
            margin: 0,
            fontSize: 13,
            color: "color-mix(in srgb, var(--color-text) 60%, transparent)",
            lineHeight: 1.55,
          }}
        >
          Sorted by expected gain: points still on the table if the remaining fields were filled.
          Firms tripping a base rule or an active approved hard-screen sink to the bottom, above
          Qualified / analyst-rejected firms. Pending or dismissed rule proposals never screen.
          Approve one in /rules to see firms move.
        </p>
      </div>
    </div>
  );
}

// ─── Root ───────────────────────────────────────────────────────────────

function Desk(): React.ReactElement {
  const { data, isLoading, error } = useOsdkObjects(Firm, {
    pageSize: 300,
    orderBy: { firmName: "asc" },
    autoFetchMore: true,
  });
  // Active approved HardScreenConfig rows drive the shared hard-screen
  // verdict for both the queue and the header/badge — see queue.ts
  // computeHardScreen. Filter to configActive === true so pending or
  // dismissed proposals cannot silently screen firms.
  const { data: configData, isLoading: configLoading } = useOsdkObjects(HardScreenConfig, {
    pageSize: 200,
    autoFetchMore: true,
  });
  const activeConfigs = React.useMemo<ActiveConfigRule[]>(() => {
    return (
      (
        (configData ?? []) as unknown as Array<{
          configRuleId: string;
          configActive?: boolean;
          configAxis?: string;
          configOperator?: string;
          configThreshold?: string;
          configModel?: string;
        }>
      )
        .filter((r) => r.configActive === true)
        .map((r) => ({
          ruleId: r.configRuleId,
          axis: r.configAxis ?? "",
          operator: r.configOperator ?? "",
          threshold: r.configThreshold ?? "",
          model: r.configModel ?? "both",
        }))
        // Skip malformed rows — a rule with no axis / no operator / no
        // threshold can't be evaluated. Better to omit than to false-positive.
        .filter((r) => r.axis !== "" && r.operator !== "" && r.threshold !== "")
    );
  }, [configData]);

  // The approved rules /rules renders. The desk screens on these directly
  // rather than waiting for HardScreenConfig rows to exist — that dependency
  // is what let the header read "711 of 711" while /rules showed an approved
  // rule claiming 160 firms. Config rows still win where present, because an
  // amended threshold is what the analyst sees as the effective predicate.
  const { data: proposedRuleData } = useOsdkObjects(ProposedRule, {
    pageSize: 200,
    autoFetchMore: true,
  });
  const screeningRules = React.useMemo<ScreeningRule[]>(
    () =>
      toScreeningRules(
        (proposedRuleData ?? []) as unknown as Parameters<typeof toScreeningRules>[0],
        (configData ?? []) as unknown as Parameters<typeof toScreeningRules>[1],
      ),
    [proposedRuleData, configData],
  );

  // One rule list drives ranking and the view filter. ScreeningRule is a
  // superset of ActiveConfigRule, so the queue's shared hard-screen verdict
  // reads the same approved rules the sidebar partitions on.
  const rankingRules = React.useMemo<ActiveConfigRule[]>(() => {
    const seen = new Set(screeningRules.map((r) => r.ruleId));
    return [...screeningRules, ...activeConfigs.filter((c) => !seen.has(c.ruleId))];
  }, [screeningRules, activeConfigs]);
  const [searchParams, setSearchParams] = useSearchParams();
  const initialFirmId = searchParams.get("firmId") ?? undefined;
  const [selectedId, setSelectedIdState] = React.useState<string | undefined>(initialFirmId);
  const setSelectedId = React.useCallback(
    (id: string | undefined) => {
      setSelectedIdState(id);
      // Keep the URL in sync so the /pipeline → /desk handoff round-trips.
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (id) {
            next.set("firmId", id);
          } else {
            next.delete("firmId");
          }
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  // ── Search-scoped view ──────────────────────────────────────────────
  // ?search=<id> pins the queue to a specific Search's firm set. We
  // filter client-side against Search↔firms membership since the desk
  // still relies on useOsdkObjects(Firm) — the scoped getQueue query
  // isn't in the SDK yet, so we intentionally leave the master fetch
  // alone and narrow after the fact.
  const searchIdParam = searchParams.get("search") ?? "";
  const searchActive = searchIdParam !== "";

  const { data: pinnedSearchData } = useOsdkObjects(Search, {
    where: { searchId: { $eq: searchIdParam } },
    pageSize: 1,
  });
  const pinnedSearchList = (pinnedSearchData ?? []) as unknown as Array<{
    searchId: string;
    mandateId?: string | null;
    name?: string | null;
    runAt?: string | number | Date | null;
  }>;
  const pinnedSearch = searchActive ? pinnedSearchList[0] : undefined;
  // Raw WireObject for useLinks — the link traversal needs the
  // instance itself, not the widened POJO.
  const pinnedSearchInstance = searchActive ? (pinnedSearchData ?? [])[0] : undefined;
  const pinnedMandateId = pinnedSearch?.mandateId ?? "";

  // Sibling searches under the same mandate — we number the pinned one
  // by its rank (freshest = 1) when it doesn't have a human name.
  const { data: siblingSearchesData } = useOsdkObjects(Search, {
    where: { mandateId: { $eq: pinnedMandateId } },
    orderBy: { runAt: "desc" },
    pageSize: 20,
  });
  const searchIndex = React.useMemo<number | undefined>(() => {
    if (!searchActive) {
      return undefined;
    }
    const list = (siblingSearchesData ?? []) as unknown as Array<{ searchId: string }>;
    const idx = list.findIndex((s) => s.searchId === searchIdParam);
    return idx >= 0 ? idx + 1 : undefined;
  }, [searchActive, siblingSearchesData, searchIdParam]);

  const { data: pinnedMandateData } = useOsdkObjects(Mandate, {
    where: { mandateId: { $eq: pinnedMandateId } },
    pageSize: 1,
  });
  const pinnedMandate = searchActive
    ? (
        (pinnedMandateData ?? []) as unknown as Array<{
          intentStatement?: string | null;
          title?: string | null;
        }>
      )[0]
    : undefined;
  const pinnedIntent =
    (pinnedMandate?.intentStatement ?? "").trim() || (pinnedMandate?.title ?? "").trim() || "—";

  // Members via the Search↔firms M2M link. The API returns full linked
  // objects — we only need firmId + discoveredViaSearchId, but there's
  // no way to $select on useLinks without breaking the pinnedSearch
  // instance shape, so we take the whole payload.
  const membership = useLinks(pinnedSearchInstance as never, "firms", {
    pageSize: 500,
  });
  const memberFirmIds = React.useMemo(() => {
    if (!searchActive) {
      return null;
    }
    const arr = membership.linkedObjectsBySourcePrimaryKey.get(searchIdParam);
    const set = new Set<string>();
    for (const f of arr ?? []) {
      const id = (f as unknown as { firmId?: string }).firmId;
      if (id !== undefined && id !== "") {
        set.add(id);
      }
    }
    return set;
  }, [searchActive, membership.linkedObjectsBySourcePrimaryKey, searchIdParam]);

  // Decisions load-bearing only when the filter is active (to compute
  // per-firm "N prior decisions"). Skipping the fetch when the desk is
  // unfiltered keeps the master view's request budget unchanged.
  const { data: decisionData } = useOsdkObjects(ReviewDecision, {
    pageSize: 500,
    orderBy: { decidedAt: "desc" },
    autoFetchMore: true,
  });
  const priorDecisionCountByFirm = React.useMemo(() => {
    if (!searchActive) {
      return null;
    }
    // "Prior" = decided before this search was run. When runAt is
    // missing we fall back to counting every decision (best-effort — a
    // partially-populated search shouldn't render zero counts across
    // the board and mislead the analyst).
    const runAtRaw = pinnedSearch?.runAt ?? null;
    const runAtMs = ((): number => {
      if (runAtRaw === null || runAtRaw === undefined) {
        return Number.POSITIVE_INFINITY;
      }
      const t =
        runAtRaw instanceof Date
          ? runAtRaw.getTime()
          : new Date(runAtRaw as string | number).getTime();
      return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
    })();
    const m = new Map<string, number>();
    for (const d of (decisionData ?? []) as unknown as Array<{
      firmId?: string;
      decidedAt?: unknown;
    }>) {
      const fid = d.firmId ?? "";
      if (fid === "") {
        continue;
      }
      const raw = d.decidedAt;
      const t =
        raw instanceof Date
          ? raw.getTime()
          : raw !== undefined && raw !== null
            ? new Date(raw as string | number).getTime()
            : NaN;
      if (Number.isNaN(t) || t >= runAtMs) {
        continue;
      }
      m.set(fid, (m.get(fid) ?? 0) + 1);
    }
    return m;
  }, [searchActive, decisionData, pinnedSearch?.runAt]);

  const filteredData = React.useMemo(() => {
    if (!searchActive || memberFirmIds === null) {
      return (data ?? []) as typeof data;
    }
    return (data ?? []).filter((f) => memberFirmIds.has(f.firmId ?? ""));
  }, [searchActive, memberFirmIds, data]);

  const rediscoveryByFirmId = React.useMemo<Map<string, RediscoveryInfo> | undefined>(() => {
    if (!searchActive || memberFirmIds === null) {
      return undefined;
    }
    const m = new Map<string, RediscoveryInfo>();
    for (const f of filteredData ?? []) {
      const fid = f.firmId ?? "";
      if (fid === "") {
        continue;
      }
      const discoveredVia =
        (f as unknown as { discoveredViaSearchId?: string | null }).discoveredViaSearchId ?? null;
      const isNew = discoveredVia === searchIdParam;
      m.set(fid, {
        kind: isNew ? "new" : "rediscovered",
        priorDecisions: isNew ? 0 : (priorDecisionCountByFirm?.get(fid) ?? 0),
      });
    }
    return m;
  }, [searchActive, memberFirmIds, filteredData, searchIdParam, priorDecisionCountByFirm]);

  const onClearSearchFilter = React.useCallback(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("search");
        return next;
      },
      { replace: true },
    );
  }, [setSearchParams]);

  const queue = React.useMemo(() => {
    const firms = (filteredData ?? []).map((f) => ({
      firmId: f.firmId,
      firmName: f.firmName,
      // lifecycle/currentStage are consumed by the queue ranker to push
      // terminal (Qualified / Rejected) firms to the bottom — the desk is a
      // to-do list, not a leaderboard.
      lifecycleState: f.lifecycleState,
      currentStage: f.currentStage,
      // Disposition tells the ranker about server-side hard screens the
      // client mirror can't reconstruct — those firms sink even further,
      // below terminal, so the first queue firm is always genuinely
      // workable.
      disposition: (f as FirmView).disposition ?? null,
      // Carried so the sidebar's live-queue partition can screen on the
      // same object it ranks — screening reads axis-named properties off
      // the firm directly.
      ...toScoreInput(f),
    }));
    return orderEnrichmentQueue(firms as unknown as QueueFirm[], rankingRules);
  }, [filteredData, rankingRules]);

  const selected = filteredData?.find((f) => f.firmId === selectedId);

  return (
    <div
      className="dsn"
      style={{
        position: "fixed",
        inset: 0,
        background: VOID_BG,
        display: "flex",
      }}
    >
      <QueueSidebar
        queue={queue}
        isLoading={isLoading}
        selectedId={selectedId}
        onSelect={setSelectedId}
        screeningRules={screeningRules}
        scopeLabel={searchActive ? "in search" : "in database"}
        membershipPinned={searchActive}
        rediscoveryByFirmId={rediscoveryByFirmId}
      />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {searchActive && (
          <SearchFilterBar
            intentText={pinnedIntent}
            searchName={pinnedSearch?.name ?? null}
            searchIndex={searchIndex}
            memberCount={filteredData?.length ?? 0}
            loading={memberFirmIds === null}
            onClear={onClearSearchFilter}
          />
        )}
        {error && (
          <div
            style={{
              padding: "8px 24px",
              background: "rgba(207,112,112,.12)",
              color: "#e79191",
              fontSize: 12,
            }}
          >
            {String(error)}
          </div>
        )}
        {searchActive && !isLoading && (filteredData?.length ?? 0) === 0 && (
          <div
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 32,
              textAlign: "center",
              color: "color-mix(in srgb, var(--color-text) 60%, transparent)",
              fontSize: 13,
              lineHeight: 1.55,
            }}
          >
            {memberFirmIds === null
              ? "Loading search membership…"
              : "This search returned no firms yet. If it just launched, give the backend a moment to attach dedupes and create discoveries. The queue populates as membership lands."}
          </div>
        )}
        {selected ? (
          <EnrichmentPanel
            firm={selected}
            actionFirm={selected}
            allFirms={(filteredData ?? []) as unknown as FirmView[]}
            firmsLoading={isLoading}
            // Same rule list the queue ranks and partitions on, so the firm
            // header's hard-screen chip can't call a firm workable while the
            // sidebar shows it screened.
            activeConfigs={rankingRules}
            configsLoading={configLoading}
          />
        ) : (
          !(searchActive && !isLoading && (filteredData?.length ?? 0) === 0) && <EmptyState />
        )}
      </div>
    </div>
  );
}

export default Desk;
