import React from "react";
import { Link } from "react-router-dom";
import { useOsdkObjects } from "@/data/hooks";
import { Firm, ReviewDecision } from "@/data/ontology";
import { BrandMark, WorkspaceNavLinks } from "./nav";
import "./nocturne.css";
// Six-stage funnel vocabulary lives in one module so the Home strip and
// this page can't disagree about which stage a firm sits in.
import {
  LIFECYCLE_BUCKETS,
  type Lifecycle,
  STATUS_CHIP,
  bucketOf,
  emptyBucketCounts,
} from "./pipelineBuckets";
import { type RankedFirm, orderEnrichmentQueue } from "./queue";
import { type MirrorResult, type ScoreInput, mirrorScore } from "./scoreMirror";
import { TIER_COLOR, TIER_LABEL, VOID_BG, outcomeChipStyle, outcomeLabel } from "./tokens";

// ─── Types ──────────────────────────────────────────────────────────────

interface FirmView {
  firmId?: string;
  firmName?: string | null;
  firmType?: string | null;
  coverageModel?: string | null;
  sector?: string | null;
  hqCountry?: string | null;
  employees?: number | null;
  lifecycleState?: string | null;
  currentStage?: string | null;
  lastReviewed?: string | number | Date | null;
  disposition?: string | null;
  // Observed post-decision outcome (FDE backfill). SDK types don't declare
  // it yet, so the reader casts at the site — accepted values include
  // converted_to_talks / loi / went_cold / acquired_by_competitor / null.
  outcome?: string | null;
  outcomeObservedAt?: string | number | Date | null;
  // Fields needed by mirrorScore:
  servicesFit?: string | null;
  mdPedigree?: string | null;
  balanceSheetPrincipal?: string | null;
  geoScore?: number | null;
  dealSizeMUsd?: number | null;
  dealsPerMdL3y?: number | null;
  firmAge?: number | null;
  feeGeneratingCount?: number | null;
  geographicFootprint?: string | null;
  advisoryConflict?: boolean | null;
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

// ─── Lifecycle vocabulary ───────────────────────────────────────────────

// Chips inside the detail rail read across only the tracked stages
// (Rejected is a status-page concept, not a lifecycle step).
const RAIL_STAGES: Lifecycle[] = ["Discovered", "In Review", "Outreach", "In Talks", "Qualified"];

// Human-readable label for a ReviewDecision.decisionType. Case- and separator-
// insensitive. Unknown types fall back to a title-cased version of the raw.
const DECISION_TYPE_LABEL: Record<string, string> = {
  accept: "Reviewed",
  enrich: "Enriched",
  reject: "Rejected",
  re_engage: "Re-engaged",
  keep_passed: "Kept passed",
  advance: "Advanced",
  activity: "Logged activity",
  qualify: "Qualified",
};

function labelForDecisionType(raw: string | null | undefined): string {
  if (raw === null || raw === undefined || raw === "") {
    return "Activity";
  }
  const normalized = raw
    .trim()
    .toLowerCase()
    .replace(/[-\s]+/g, "_");
  if (DECISION_TYPE_LABEL[normalized]) {
    return DECISION_TYPE_LABEL[normalized];
  }
  // Title-case the raw as a last resort.
  return raw
    .trim()
    .split(/[_\s-]+/)
    .map((w) => (w.length > 0 ? w[0].toUpperCase() + w.slice(1).toLowerCase() : ""))
    .join(" ");
}

// ─── Primitives ─────────────────────────────────────────────────────────

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

function StatusChip({ stage }: { stage: Lifecycle }): React.ReactElement {
  const s = STATUS_CHIP[stage];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontSize: 11,
        padding: "3px 9px",
        borderRadius: "var(--radius-chip)",
        background: s.bg,
        color: s.fg,
        fontWeight: 400,
        whiteSpace: "nowrap",
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: s.dot,
        }}
      />
      {stage}
    </span>
  );
}

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

function pctScore(m: MirrorResult): number {
  return Math.round(m.pct * 100);
}

function relativeTime(ts: unknown): string {
  if (ts === null || ts === undefined) {
    return "";
  }
  const d = typeof ts === "string" || typeof ts === "number" ? new Date(ts) : (ts as Date);
  const ms = Date.now() - d.getTime();
  if (Number.isNaN(ms)) {
    return "";
  }
  const s = Math.round(ms / 1000);
  if (s < 60) {
    return `${s}s ago`;
  }
  const m = Math.round(s / 60);
  if (m < 60) {
    return `${m}m ago`;
  }
  const h = Math.round(m / 60);
  if (h < 24) {
    return `${h}h ago`;
  }
  return `${Math.round(h / 24)}d ago`;
}

// ─── Nav sidebar (shared with every workspace screen) ───────────────────

function NavSidebar(): React.ReactElement {
  return (
    <aside
      style={{
        width: 240,
        flex: "0 0 240px",
        borderRight: "1px solid var(--color-divider)",
        display: "flex",
        flexDirection: "column",
        padding: 16,
        gap: 12,
        minHeight: 0,
      }}
    >
      <BrandMark section="Pipeline" />
      <WorkspaceNavLinks />
    </aside>
  );
}

// ─── Header ─────────────────────────────────────────────────────────────

function PipelineHeader({
  total,
  query,
  onQuery,
}: {
  total: number;
  query: string;
  onQuery: (v: string) => void;
}): React.ReactElement {
  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "0 22px",
        borderBottom: "1px solid var(--color-divider)",
        height: 56,
        flex: "0 0 56px",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.15 }}>
        <span style={{ fontWeight: 500, fontSize: 16 }}>Working set</span>
        <span
          style={{
            fontSize: 11,
            color: "color-mix(in srgb, var(--color-text) 48%, transparent)",
          }}
        >
          {total} firm{total === 1 ? "" : "s"} · sorted by closest to decision
        </span>
      </div>
      <div style={{ marginLeft: "auto", position: "relative", width: 260 }}>
        <input
          className="input"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Search firms, sectors, HQ…"
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
      <Link to="/mandate" className="btn btn-primary" style={{ textDecoration: "none" }}>
        + New search
      </Link>
    </header>
  );
}

// ─── Bucket counts ──────────────────────────────────────────────────────

function BucketCounts({
  counts,
  isLoading,
}: {
  counts: Record<Lifecycle, number>;
  // True while firms are still fetching. During that window every bucket
  // reads 0 (because the reducer sees no rows), so we must render a
  // skeleton — otherwise the tile falsely reads as "0 firms" for buckets
  // that actually have data on the way.
  isLoading: boolean;
}): React.ReactElement {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
        gap: 12,
      }}
    >
      {LIFECYCLE_BUCKETS.map((b) => {
        const s = STATUS_CHIP[b];
        const muted = b === "Rejected";
        const n = counts[b];
        return (
          <div
            key={b}
            style={{
              background: "var(--color-surface)",
              boxShadow: "var(--shadow-sm)",
              borderRadius: "var(--radius-md)",
              padding: 12,
              display: "flex",
              flexDirection: "column",
              gap: 4,
              opacity: muted ? 0.72 : 1,
            }}
          >
            {isLoading ? (
              <span
                aria-hidden
                style={{
                  display: "block",
                  height: 24,
                  width: 46,
                  borderRadius: "var(--radius-sm)",
                  background:
                    "linear-gradient(90deg, color-mix(in srgb, var(--color-text) 6%, transparent) 0%, color-mix(in srgb, var(--color-text) 16%, transparent) 50%, color-mix(in srgb, var(--color-text) 6%, transparent) 100%)",
                  backgroundSize: "200% 100%",
                  animation: "beacon-shimmer 1.6s linear infinite",
                }}
              />
            ) : (
              <span
                style={{
                  fontSize: 21,
                  fontWeight: 600,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {n}
              </span>
            )}
            <span
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 11,
                color: "color-mix(in srgb, var(--color-text) 55%, transparent)",
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: s.dot,
                }}
              />
              {b}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Table ──────────────────────────────────────────────────────────────

interface LastActivity {
  type: string;
  decidedAt: unknown;
}

interface Row {
  ranked: RankedFirm;
  firm: FirmView;
  mirror: MirrorResult;
  bucket: Lifecycle;
  rejectionRationale: string | null;
  lastActivity: LastActivity | null;
}

function FirmRow({
  row,
  selected,
  onSelect,
}: {
  row: Row;
  selected: boolean;
  onSelect: (id: string) => void;
}): React.ReactElement {
  const { firm, mirror, bucket, rejectionRationale, lastActivity } = row;
  const isRejected = mirror.hardRejected || bucket === "Rejected";
  const tierColor = TIER_COLOR[mirror.tier] ?? TIER_COLOR.Rejected;
  const pct = isRejected ? 0 : pctScore(mirror);

  // Hard-rejects (algorithmic) vs analyst rejections carry different verbs.
  const rejectLabel = mirror.hardRejected
    ? `Hard-rejected · ${mirror.rejectReason}`
    : isRejected
      ? `Rejected · ${rejectionRationale ?? "reason not on file"}`
      : null;

  return (
    <tr
      onClick={() => firm.firmId && onSelect(firm.firmId)}
      style={{
        cursor: firm.firmId ? "pointer" : "default",
        boxShadow: selected ? "inset 2px 0 0 var(--color-accent)" : "none",
        background: selected
          ? "color-mix(in srgb, var(--color-accent) 10%, transparent)"
          : "transparent",
      }}
    >
      <td style={{ padding: "8px var(--space-2)", overflow: "hidden" }}>
        <div
          style={{
            fontWeight: 500,
            textDecoration: isRejected ? "line-through" : "none",
            textDecorationColor: "color-mix(in srgb, var(--color-text) 40%, transparent)",
            color: isRejected
              ? "color-mix(in srgb, var(--color-text) 62%, transparent)"
              : "inherit",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={firm.firmName ?? firm.firmId}
        >
          {firm.firmName ?? firm.firmId}
        </div>
        {firm.coverageModel && (
          <div
            style={{
              fontSize: 11,
              color: "color-mix(in srgb, var(--color-text) 45%, transparent)",
            }}
          >
            {firm.coverageModel}
          </div>
        )}
      </td>
      <td>
        {firm.firmType && (
          <span className="tag tag-neutral" style={{ fontWeight: 600, fontSize: 10 }}>
            {firm.firmType}
          </span>
        )}
      </td>
      <td
        style={{
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          color:
            firm.sector === null || firm.sector === undefined || firm.sector === ""
              ? "color-mix(in srgb, var(--color-text) 32%, transparent)"
              : undefined,
        }}
        title={firm.sector ?? undefined}
      >
        {firm.sector ?? "—"}
      </td>
      <td>
        <StatusChip stage={bucket} />
      </td>
      <td>
        {isRejected ? (
          <span
            style={{
              fontSize: 11,
              color: "color-mix(in srgb, var(--color-text) 62%, transparent)",
            }}
            title={rejectLabel ?? undefined}
          >
            {rejectLabel}
          </span>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={{
                fontVariantNumeric: "tabular-nums",
                fontWeight: 600,
                color: tierColor,
                minWidth: 26,
              }}
            >
              {pct}
            </span>
            <TierTag tier={mirror.tier} />
            <span
              style={{
                width: 34,
                height: 4,
                borderRadius: "var(--radius-xs)",
                background: "var(--color-neutral-800)",
                position: "relative",
                overflow: "hidden",
              }}
            >
              <span
                style={{
                  position: "absolute",
                  inset: "0 auto 0 0",
                  width: `${pct}%`,
                  background: tierColor,
                  borderRadius: "var(--radius-xs)",
                }}
              />
            </span>
          </div>
        )}
      </td>
      <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
        {firm.employees ?? "—"}
      </td>
      <td
        style={{
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          color:
            firm.hqCountry === null || firm.hqCountry === undefined || firm.hqCountry === ""
              ? "color-mix(in srgb, var(--color-text) 32%, transparent)"
              : undefined,
        }}
        title={firm.hqCountry ?? undefined}
      >
        {firm.hqCountry ?? "—"}
      </td>
      <td
        style={{
          color: "color-mix(in srgb, var(--color-text) 55%, transparent)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {lastActivity
          ? `${labelForDecisionType(lastActivity.type)} · ${relativeTime(lastActivity.decidedAt)}`
          : "None logged"}
      </td>
    </tr>
  );
}

function FirmsTable({
  rows,
  selectedId,
  onSelect,
  isLoading,
}: {
  rows: Row[];
  selectedId: string | undefined;
  onSelect: (id: string) => void;
  isLoading: boolean;
}): React.ReactElement {
  if (isLoading && rows.length === 0) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "12px 6px",
          fontSize: 11,
          color: "color-mix(in srgb, var(--color-text) 48%, transparent)",
        }}
      >
        <span
          style={{
            width: 12,
            height: 12,
            borderRadius: "50%",
            border: "2px solid var(--color-neutral-700)",
            borderTopColor: "var(--color-accent)",
            animation: "bcn-spin .7s linear infinite",
          }}
        />
        Loading working set from ontology…
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 12,
          textAlign: "center",
          padding: "60px 20px",
        }}
      >
        <span
          style={{
            width: 44,
            height: 44,
            borderRadius: "var(--radius-lg)",
            background: "var(--color-neutral-800)",
            display: "grid",
            placeItems: "center",
            color: "color-mix(in srgb, var(--color-text) 55%, transparent)",
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
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </span>
        <div style={{ fontSize: 16, fontWeight: 500 }}>No firms match that search</div>
        <p
          style={{
            margin: 0,
            fontSize: 13,
            color: "color-mix(in srgb, var(--color-text) 60%, transparent)",
            maxWidth: "40ch",
          }}
        >
          Try a broader sector or geography, or start a fresh discovery run.
        </p>
      </div>
    );
  }

  return (
    <table className="table" style={{ tableLayout: "fixed", width: "100%" }}>
      {/* Anchor column widths so a sparse Sector cell can't visually pull
          HQ / Emp. / Last-activity out of column. Without this, `<table>`
          auto-sizes each column to its content and a mostly-null Sector
          collapses to a hairline, making downstream cells look like they
          landed under the wrong header. */}
      <colgroup>
        <col style={{ width: "22%" }} />
        <col style={{ width: "6%" }} />
        <col style={{ width: "14%" }} />
        <col style={{ width: "9%" }} />
        <col style={{ width: "15%" }} />
        <col style={{ width: "6%" }} />
        <col style={{ width: "10%" }} />
        <col style={{ width: "18%" }} />
      </colgroup>
      <thead>
        <tr>
          <th>Firm</th>
          <th>Type</th>
          <th>Sector</th>
          <th>Status</th>
          <th>Fit</th>
          <th style={{ textAlign: "right" }}>Emp.</th>
          <th>HQ</th>
          <th>Last activity</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <FirmRow
            key={r.firm.firmId ?? Math.random().toString()}
            row={r}
            selected={r.firm.firmId === selectedId}
            onSelect={onSelect}
          />
        ))}
      </tbody>
    </table>
  );
}

// ─── Detail rail ────────────────────────────────────────────────────────

// Outcome chip for the detail rail — same visual language as the desk
// header chip, `acquired_by_competitor` in muted red.
function DetailOutcomeChip({
  outcome,
  observedAt,
}: {
  outcome: string;
  observedAt: string | number | Date | null | undefined;
}): React.ReactElement {
  const style = outcomeChipStyle(outcome);
  const label = outcomeLabel(outcome);
  const dateStr = formatOutcomeDate(observedAt);
  const tooltip = dateStr === null ? `Outcome: ${label}` : `Outcome: ${label} · ${dateStr}`;
  return (
    <span
      className="tag"
      title={tooltip}
      style={{
        fontSize: 11,
        padding: "3px 9px",
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

function formatOutcomeDate(raw: string | number | Date | null | undefined): string | null {
  if (raw === null || raw === undefined) {
    return null;
  }
  const t = raw instanceof Date ? raw.getTime() : new Date(raw).getTime();
  if (Number.isNaN(t)) {
    return null;
  }
  return new Date(t).toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

function DetailRail({ row }: { row: Row | undefined }): React.ReactElement {
  if (row === undefined) {
    return (
      <aside style={railShellStyle}>
        <div
          style={{
            margin: "auto",
            textAlign: "center",
            padding: 32,
            color: "color-mix(in srgb, var(--color-text) 50%, transparent)",
            fontSize: 13,
          }}
        >
          Select a firm to see its qualification status and facts.
        </div>
      </aside>
    );
  }

  const { firm, mirror, bucket, rejectionRationale } = row;
  const isReject = mirror.hardRejected || bucket === "Rejected";
  const tierColor = TIER_COLOR[mirror.tier] ?? TIER_COLOR.Rejected;
  const pct = pctScore(mirror);

  const facts: { k: string; v: string }[] = [];
  if (firm.coverageModel) {
    facts.push({ k: "Coverage", v: firm.coverageModel });
  }
  if (firm.employees !== null && firm.employees !== undefined) {
    facts.push({ k: "Employees", v: String(firm.employees) });
  }
  if (firm.dealsPerMdL3y !== null && firm.dealsPerMdL3y !== undefined) {
    facts.push({ k: "Deals / MD (L3Y)", v: String(firm.dealsPerMdL3y) });
  }
  if (firm.dealSizeMUsd !== null && firm.dealSizeMUsd !== undefined) {
    facts.push({ k: "Avg deal size", v: `$${firm.dealSizeMUsd}m` });
  }
  if (firm.firmAge !== null && firm.firmAge !== undefined) {
    facts.push({ k: "Firm age", v: `${firm.firmAge} yrs` });
  }
  if (firm.geographicFootprint) {
    facts.push({ k: "Geography", v: firm.geographicFootprint });
  }

  return (
    <aside style={railShellStyle}>
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontWeight: 500, fontSize: 19, lineHeight: 1.15 }}>
            {firm.firmName ?? firm.firmId}
          </span>
          {firm.firmType && (
            <span className="tag tag-neutral" style={{ fontWeight: 600, fontSize: 10 }}>
              {firm.firmType}
            </span>
          )}
        </div>
        <div
          style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4, flexWrap: "wrap" }}
        >
          {firm.sector && <span className="tag tag-outline">{firm.sector}</span>}
          {firm.hqCountry && (
            <span
              style={{
                fontSize: 11,
                color: "color-mix(in srgb, var(--color-text) 48%, transparent)",
              }}
            >
              {firm.hqCountry}
            </span>
          )}
        </div>
        {firm.outcome && firm.outcome.trim() !== "" && (
          <div style={{ marginTop: 8 }}>
            <DetailOutcomeChip outcome={firm.outcome} observedAt={firm.outcomeObservedAt} />
          </div>
        )}
      </div>

      <div>
        <Kicker style={{ marginBottom: 8 }}>
          Qualification status{" "}
          <span
            style={{
              letterSpacing: 0,
              textTransform: "none",
              color: "color-mix(in srgb, var(--color-text) 32%, transparent)",
            }}
          >
            (read-only)
          </span>
        </Kicker>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {RAIL_STAGES.map((s) => {
            const active = bucket === s;
            return (
              <span
                key={s}
                style={{
                  fontSize: 11,
                  padding: "4px 9px",
                  borderRadius: "var(--radius-chip)",
                  fontWeight: active ? 500 : 400,
                  background: active ? "var(--color-accent)" : "var(--color-neutral-800)",
                  color: active
                    ? "var(--color-bg)"
                    : "color-mix(in srgb, var(--color-text) 55%, transparent)",
                }}
              >
                {s}
              </span>
            );
          })}
        </div>
      </div>

      {!isReject && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: 12,
            background: "var(--color-surface)",
            borderRadius: "var(--radius-md)",
            boxShadow: "var(--shadow-sm)",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.05 }}>
            <span
              style={{
                fontSize: 32,
                fontWeight: 600,
                fontVariantNumeric: "tabular-nums",
                color: tierColor,
              }}
            >
              {pct}
            </span>
            <Kicker>Fit score</Kicker>
          </div>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
            <span
              style={{
                height: 6,
                borderRadius: "var(--radius-xs)",
                background: "var(--color-neutral-800)",
                position: "relative",
                overflow: "hidden",
              }}
            >
              <span
                style={{
                  position: "absolute",
                  inset: "0 auto 0 0",
                  width: `${pct}%`,
                  background: tierColor,
                  borderRadius: "var(--radius-xs)",
                }}
              />
            </span>
            <span style={{ fontSize: 11, color: tierColor }}>
              {mirror.tier} · {TIER_LABEL[mirror.tier] ?? ""}
            </span>
          </div>
        </div>
      )}

      {isReject && (
        <div
          style={{
            fontSize: 13,
            padding: 12,
            borderRadius: "var(--radius-md)",
            background: "rgba(207,112,112,.12)",
            color: "#e79191",
            fontWeight: 500,
          }}
        >
          {mirror.hardRejected
            ? `Hard-rejected · ${mirror.rejectReason}`
            : `Rejected · ${rejectionRationale ?? "reason not on file"}`}
        </div>
      )}

      {facts.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Kicker>Firm facts</Kicker>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "116px 1fr",
              gap: "7px 10px",
              fontSize: 13,
            }}
          >
            {facts.map((f) => (
              <React.Fragment key={f.k}>
                <span
                  style={{
                    color: "color-mix(in srgb, var(--color-text) 48%, transparent)",
                  }}
                >
                  {f.k}
                </span>
                <span style={{ overflowWrap: "anywhere" }}>{f.v}</span>
              </React.Fragment>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: "auto" }}>
        {!isReject && (
          <Link
            to={`/desk?firmId=${encodeURIComponent(firm.firmId ?? "")}`}
            className="btn btn-primary btn-block"
            style={{ textDecoration: "none" }}
          >
            Open in enrichment desk
          </Link>
        )}
      </div>
    </aside>
  );
}

const railShellStyle: React.CSSProperties = {
  borderLeft: "1px solid var(--color-divider)",
  overflow: "auto",
  padding: "18px 18px 22px",
  display: "flex",
  flexDirection: "column",
  gap: 16,
  minHeight: 0,
  flex: "0 0 384px",
  width: 384,
};

// ─── Root ───────────────────────────────────────────────────────────────

function Pipeline(): React.ReactElement {
  const { data, isLoading, error } = useOsdkObjects(Firm, {
    pageSize: 300,
    orderBy: { firmName: "asc" },
    autoFetchMore: true,
  });
  const { data: decisionsData } = useOsdkObjects(ReviewDecision, {
    pageSize: 500,
    orderBy: { decidedAt: "desc" },
  });

  const [selectedId, setSelectedId] = React.useState<string | undefined>(undefined);
  const [query, setQuery] = React.useState("");

  const firms = React.useMemo(() => (data ?? []) as unknown as FirmView[], [data]);

  // Most-recent reject rationale per firm (for manually-rejected rows).
  const rejectionByFirm = React.useMemo(() => {
    const m = new Map<string, string>();
    for (const d of decisionsData ?? []) {
      const t = (d.decisionType ?? "").toLowerCase();
      if (!t.includes("reject")) {
        continue;
      }
      const fid = d.firmId ?? null;
      const rat = (d.rejectionRationale ?? "").trim();
      if (fid === null || fid === "" || rat === "") {
        continue;
      }
      if (!m.has(fid)) {
        m.set(fid, rat);
      }
    }
    return m;
  }, [decisionsData]);

  // Most-recent decision per firm — real activity, not the pipeline-builder
  // default lastReviewed date. The query is ordered by decidedAt desc, so
  // the first entry per firmId is the most recent.
  const lastActivityByFirm = React.useMemo(() => {
    const m = new Map<string, LastActivity>();
    for (const d of decisionsData ?? []) {
      const fid = d.firmId ?? null;
      if (fid === null || fid === "") {
        continue;
      }
      if (m.has(fid)) {
        continue;
      }
      m.set(fid, {
        type: (d.decisionType ?? "decision").toString(),
        decidedAt: d.decidedAt,
      });
    }
    return m;
  }, [decisionsData]);

  const rows = React.useMemo<Row[]>(() => {
    const ranked = orderEnrichmentQueue(
      firms.map((f) => ({
        firmId: f.firmId ?? "",
        firmName: f.firmName,
        ...toScoreInput(f),
      })),
    );
    const firmById = new Map(firms.map((f) => [f.firmId ?? "", f] as const));
    return ranked
      .map((r) => {
        const firm = firmById.get(r.firm.firmId ?? "") ?? (r.firm as unknown as FirmView);
        const mirror = mirrorScore(toScoreInput(firm));
        const bucket = bucketOf(firm, mirror);
        const rationale = rejectionByFirm.get(firm.firmId ?? "") ?? null;
        const lastActivity = lastActivityByFirm.get(firm.firmId ?? "") ?? null;
        return { ranked: r, firm, mirror, bucket, rejectionRationale: rationale, lastActivity };
      })
      .filter((row) => {
        if (query.trim() === "") {
          return true;
        }
        const needle = query.trim().toLowerCase();
        return (
          (row.firm.firmName ?? "").toLowerCase().includes(needle) ||
          (row.firm.sector ?? "").toLowerCase().includes(needle) ||
          (row.firm.hqCountry ?? "").toLowerCase().includes(needle) ||
          (row.firm.firmId ?? "").toLowerCase().includes(needle)
        );
      });
  }, [firms, query, rejectionByFirm, lastActivityByFirm]);

  const counts = React.useMemo(() => {
    const c = emptyBucketCounts();
    for (const r of rows) {
      c[r.bucket] += 1;
    }
    return c;
  }, [rows]);

  const selectedRow = React.useMemo(
    () => rows.find((r) => r.firm.firmId === selectedId),
    [rows, selectedId],
  );

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
      <NavSidebar />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <PipelineHeader total={firms.length} query={query} onQuery={setQuery} />
        {error && (
          <div
            style={{
              padding: "8px 22px",
              background: "rgba(207,112,112,.12)",
              color: "#e79191",
              fontSize: 12,
            }}
          >
            {String(error)}
          </div>
        )}
        <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
          <main
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "18px 22px 24px",
              display: "flex",
              flexDirection: "column",
              gap: 16,
              minWidth: 0,
            }}
          >
            <BucketCounts counts={counts} isLoading={isLoading && firms.length === 0} />
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <span
                style={{
                  fontSize: 11,
                  color: "color-mix(in srgb, var(--color-text) 48%, transparent)",
                }}
              >
                Working set{" "}
                <span
                  style={{
                    color: "color-mix(in srgb, var(--color-text) 78%, transparent)",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {rows.length}
                </span>{" "}
                of {firms.length} <span style={{ opacity: 0.6 }}>· 679 in master database</span>
              </span>
              <span
                style={{
                  fontSize: 11,
                  color: "color-mix(in srgb, var(--color-text) 42%, transparent)",
                }}
              >
                sorted by closest to decision
              </span>
            </div>
            <FirmsTable
              rows={rows}
              selectedId={selectedId}
              onSelect={setSelectedId}
              isLoading={isLoading}
            />
          </main>
          <DetailRail row={selectedRow} />
        </div>
      </div>
    </div>
  );
}

export default Pipeline;
