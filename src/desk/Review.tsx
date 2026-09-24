import React from "react";
import { useOsdkAction, useOsdkObjects } from "@/data/hooks";
import {
  DriftEvent,
  Firm,
  ReviewDecision,
  keepPassedAction,
  reEngageFirmAction,
} from "@/data/ontology";
import { BrandMark, WorkspaceNavLinks } from "./nav";
import "./nocturne.css";
import {
  DIVERGENCE_FG,
  type DriftReasonStyle,
  TIER_COLOR,
  VOID_BG,
  driftReasonPresentation,
  isOutcomeDivergence,
  outcomeLabel,
} from "./tokens";

// ─── Lookalike heuristics ───────────────────────────────────────────────
// A drift's axis is matched against the rejection rationales of firms who
// already "passed" (rejected / hard-rejected / manually passed) — we surface
// them as "N passed firms share this now-stale reason". The match is fuzzy
// substring (case-insensitive) across a few common axis-name shapes: raw,
// snake→space, camel→space. False positives happen when rationale text uses
// an axis word incidentally; false negatives when analysts paraphrase.

function axisSearchTerms(axis: string | undefined): string[] {
  if (axis === undefined || axis === null) {
    return [];
  }
  const trimmed = axis.trim();
  if (trimmed === "") {
    return [];
  }
  const terms = new Set<string>();
  const lower = trimmed.toLowerCase();
  terms.add(lower);
  terms.add(lower.replace(/_/g, " "));
  terms.add(lower.replace(/-/g, " "));
  terms.add(
    trimmed
      .replace(/([A-Z])/g, " $1")
      .trim()
      .toLowerCase(),
  );
  // Drop terms shorter than 4 chars — too collision-prone against rationale text.
  return [...terms].filter((t) => t.length >= 4);
}

function rationaleMatchesAxis(rationale: string, axis: string): boolean {
  const haystack = rationale.toLowerCase();
  for (const t of axisSearchTerms(axis)) {
    if (haystack.includes(t)) {
      return true;
    }
  }
  return false;
}

function isPassedDisposition(firm: FirmLike): boolean {
  const life = (firm.lifecycleState ?? "").trim().toLowerCase();
  if (life === "rejected" || life === "passed") {
    return true;
  }
  const disp = (firm.disposition ?? "").trim().toLowerCase();
  if (disp.includes("reject") || disp.includes("passed") || disp.includes("pass")) {
    return true;
  }
  return false;
}

interface FirmLike {
  firmId?: string;
  firmName?: string | null;
  lifecycleState?: string | null;
  disposition?: string | null;
  // FDE backfills these on decided firms; not yet in the SDK PropertyKeys
  // for Firm — same widened-cast pattern the desk uses.
  outcome?: string | null;
  outcomeObservedAt?: string | number | Date | null;
}

interface DecisionLike {
  decisionId: string;
  firmId?: string;
  decidedAt?: unknown;
  decisionType?: string;
  rejectionRationale?: string;
  analystCategorization?: string;
}

interface Lookalike {
  firmId: string;
  firmName: string;
}

// ─── Reason vocabulary ──────────────────────────────────────────────────
// Matches support.js:reasonMap in the design. The palette itself lives in
// ./tokens (DRIFT_REASON_STYLE) so /review and Home render the same violet.

const reasonPresentation = (raw: string | undefined): DriftReasonStyle =>
  driftReasonPresentation(raw);

// ─── Primitives ─────────────────────────────────────────────────────────

function Kicker({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <div
      style={{
        fontSize: 10,
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        color: "color-mix(in srgb, var(--color-text) 45%, transparent)",
      }}
    >
      {children}
    </div>
  );
}

function TierBadge({
  tier,
  score,
}: {
  tier: string;
  score: number | null | undefined;
}): React.ReactElement {
  const c = TIER_COLOR[tier] ?? TIER_COLOR.Rejected;
  const label = score !== null && score !== undefined ? `${tier} ${score}` : tier;
  return (
    <span
      style={{
        fontSize: 12,
        fontWeight: 600,
        padding: "2px 8px",
        borderRadius: "var(--radius-chip)",
        color: c,
        background: `color-mix(in srgb, ${c} 15%, transparent)`,
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
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

// ─── Changed-axes parser ────────────────────────────────────────────────
// DriftEvent.changedAxes is a JSON string. The SDK description says
// [{axis, old, new, causing_finding_id, source, dated}] but the backend
// actually emits {oldValue, newValue} (or old_value / new_value) — read
// all three shapes so the card renders real values regardless.

interface ChangedAxis {
  axis?: string;
  old?: unknown;
  new?: unknown;
  source?: string;
  dated?: string;
}

function normalizeChangedAxis(entry: Record<string, unknown>): ChangedAxis {
  return {
    axis: typeof entry.axis === "string" ? entry.axis : undefined,
    old: entry.old ?? entry.oldValue ?? entry.old_value,
    new: entry.new ?? entry.newValue ?? entry.new_value,
    source: typeof entry.source === "string" ? entry.source : undefined,
    dated:
      typeof entry.dated === "string"
        ? entry.dated
        : typeof entry.date === "string"
          ? entry.date
          : undefined,
  };
}

function parseChangedAxes(raw: string | null | undefined): ChangedAxis[] {
  if (raw === null || raw === undefined || raw === "") {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    const objects = parsed.filter(
      (x): x is Record<string, unknown> => typeof x === "object" && x !== null,
    );
    return objects.map(normalizeChangedAxis);
  } catch {
    return [];
  }
}

// ─── Drift card ─────────────────────────────────────────────────────────

interface DriftLike {
  driftEventId: string;
  firmId?: string;
  changedAxes?: string;
  detectedAt?: unknown;
  driftReason?: string;
  driftStatus?: string;
  newScore?: number;
  newTier?: string;
  priorScore?: number;
  priorTier?: string;
  resolution?: string;
  resolvedAt?: unknown;
  resolvedBy?: string;
}

function DriftCard({
  drift,
  firmName,
  firmObj,
  lookalikes,
  rejectionReason,
  observedOutcome,
}: {
  drift: DriftLike;
  firmName: string;
  firmObj: unknown;
  lookalikes: Lookalike[];
  // Only populated when the drift is outcome_diverged — the parent looks
  // both up (most-recent ReviewDecision + Firm.outcome). Passing null when
  // unknown so the card can degrade to a generic body if either is missing.
  rejectionReason?: string | null;
  observedOutcome?: string | null;
}): React.ReactElement {
  const reEngage = useOsdkAction(reEngageFirmAction);
  const keepPassed = useOsdkAction(keepPassedAction);
  const [keepOpen, setKeepOpen] = React.useState(false);
  const [lookalikesOpen, setLookalikesOpen] = React.useState(false);
  const [rationale, setRationale] = React.useState("");

  const resolved = (drift.driftStatus ?? "").toLowerCase() === "resolved";
  const reason = reasonPresentation(drift.driftReason);
  const divergence = isOutcomeDivergence(drift.driftReason);
  const changed = React.useMemo(() => parseChangedAxes(drift.changedAxes), [drift.changedAxes]);
  const firstChange = changed[0];

  const onReEngage = (): void => {
    void reEngage.applyAction({ firm: firmObj, driftEvent: drift } as never);
  };
  const onKeep = (): void => {
    void keepPassed
      .applyAction({ driftEvent: drift, rationale: rationale.trim() } as never)
      .then(() => {
        setRationale("");
        setKeepOpen(false);
      });
  };

  const canKeep = rationale.trim().length > 0 && !keepPassed.isPending;

  const priorTierName = drift.priorTier ?? "?";
  const newTierName = drift.newTier ?? "?";

  return (
    <div
      style={{
        padding: "15px 16px",
        border: "1px solid var(--color-divider)",
        // Left rail picks up the reason color so the analyst can scan the
        // queue by trigger without reading each chip. Muted so it doesn't
        // fight the tier badges in the header row.
        borderLeft: `3px solid ${reason.border}`,
        borderRadius: "var(--radius-md)",
        background: "var(--color-surface)",
        opacity: resolved ? 0.6 : 1,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <span
          style={{
            fontWeight: 500,
            fontSize: 16,
            overflowWrap: "anywhere",
            color: resolved ? "color-mix(in srgb, var(--color-text) 55%, transparent)" : "inherit",
          }}
        >
          {firmName}
        </span>
        <div
          style={{ display: "flex", alignItems: "center", gap: 6 }}
          title="tier · score at decision time → tier · score now"
        >
          <TierBadge tier={priorTierName} score={drift.priorScore ?? null} />
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="color-mix(in srgb, var(--color-text) 45%, transparent)"
            strokeWidth={2}
          >
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
          <TierBadge tier={newTierName} score={drift.newScore ?? null} />
        </div>
        <span
          style={{
            fontSize: 10,
            fontWeight: 500,
            padding: "2px 8px",
            borderRadius: "var(--radius-chip)",
            color: reason.fg,
            background: reason.bg,
          }}
        >
          {reason.label}
        </span>
        <span
          style={{
            fontSize: 11,
            color: "color-mix(in srgb, var(--color-text) 45%, transparent)",
            marginLeft: "auto",
          }}
        >
          {relativeTime(drift.detectedAt)}
        </span>
        {resolved && (
          <span
            style={{
              fontSize: 11,
              padding: "3px 9px",
              borderRadius: "var(--radius-chip)",
              background: "rgba(87,185,138,.14)",
              color: "#8fe3c0",
            }}
          >
            {drift.resolution ?? "resolved"}
          </span>
        )}
      </div>

      {!resolved && divergence && (
        <div
          style={{
            borderLeft: `2px solid ${reason.border}`,
            padding: "2px 0 2px 12px",
            marginTop: 12,
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <div style={{ flex: "1 1 220px", minWidth: 0 }}>
              <div
                style={{
                  fontSize: 10,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: "color-mix(in srgb, var(--color-text) 45%, transparent)",
                  marginBottom: 2,
                }}
              >
                We passed because
              </div>
              <div
                style={{
                  fontSize: 13,
                  color: "color-mix(in srgb, var(--color-text) 82%, transparent)",
                  fontStyle: "italic",
                  overflowWrap: "anywhere",
                }}
              >
                {rejectionReason && rejectionReason.trim() !== ""
                  ? `“${rejectionReason.trim()}”`
                  : "no rationale on file"}
              </div>
            </div>
            <div
              aria-hidden="true"
              style={{
                alignSelf: "center",
                color: "color-mix(in srgb, var(--color-text) 45%, transparent)",
                fontSize: 14,
                lineHeight: 1,
              }}
            >
              →
            </div>
            <div style={{ flex: "1 1 180px", minWidth: 0 }}>
              <div
                style={{
                  fontSize: 10,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: "color-mix(in srgb, var(--color-text) 45%, transparent)",
                  marginBottom: 2,
                }}
              >
                Market observed
              </div>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 500,
                  color: DIVERGENCE_FG,
                  overflowWrap: "anywhere",
                }}
              >
                {outcomeLabel(observedOutcome ?? null)}
              </div>
            </div>
          </div>
        </div>
      )}

      {!resolved && !divergence && firstChange && (
        <div
          style={{
            borderLeft: "2px solid var(--color-divider)",
            padding: "2px 0 2px 12px",
            marginTop: 12,
          }}
        >
          <div
            style={{
              fontSize: 13,
              color: "color-mix(in srgb, var(--color-text) 82%, transparent)",
              fontStyle: "italic",
              overflowWrap: "anywhere",
            }}
          >
            {firstChange.axis ?? "unknown axis"}: {formatChangeValue(firstChange.old)} →{" "}
            {formatChangeValue(firstChange.new)}
          </div>
          {(firstChange.source || firstChange.dated) && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginTop: 4,
                fontSize: 10,
                color: "color-mix(in srgb, var(--color-text) 42%, transparent)",
              }}
            >
              {firstChange.source && <span>{firstChange.source}</span>}
              {firstChange.dated && (
                <span>· {relativeTime(firstChange.dated) || firstChange.dated}</span>
              )}
            </div>
          )}
          {changed.length > 1 && (
            <div
              style={{
                fontSize: 11,
                color: "color-mix(in srgb, var(--color-text) 45%, transparent)",
                marginTop: 4,
              }}
            >
              +{changed.length - 1} more axis change{changed.length > 2 ? "s" : ""}
            </div>
          )}
        </div>
      )}

      {!resolved && lookalikes.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setLookalikesOpen((v) => !v)}
            aria-expanded={lookalikesOpen}
            style={{
              marginTop: 12,
              background: "none",
              border: 0,
              cursor: "pointer",
              color: "var(--color-accent)",
              font: "inherit",
              fontSize: 12,
              padding: 0,
              textAlign: "left",
            }}
            title="Firms already passed whose rejection rationale mentions this axis"
          >
            {lookalikesOpen
              ? "Hide"
              : `+${lookalikes.length} passed firm${lookalikes.length === 1 ? "" : "s"} share this now-stale reason`}
          </button>
          {lookalikesOpen && (
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 6,
                marginTop: 8,
              }}
            >
              {lookalikes.map((l) => (
                <span key={l.firmId} className="tag tag-neutral" title={l.firmId}>
                  {l.firmName}
                </span>
              ))}
            </div>
          )}
        </>
      )}

      {!resolved && (
        <>
          {(reEngage.error !== undefined || keepPassed.error !== undefined) && (
            <div
              style={{
                marginTop: 12,
                padding: "8px 12px",
                borderRadius: "var(--radius-md)",
                background: "rgba(207,112,112,.12)",
                color: "#e79191",
                fontSize: 12,
              }}
            >
              {reEngage.error !== undefined && (
                <div>Re-engage failed: {String(reEngage.error)}</div>
              )}
              {keepPassed.error !== undefined && (
                <div>
                  Keep passed failed: {String(keepPassed.error)}. Your rationale is preserved.
                </div>
              )}
            </div>
          )}

          {!keepOpen ? (
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button
                className="btn btn-primary"
                disabled={reEngage.isPending}
                onClick={onReEngage}
              >
                {reEngage.isPending ? "Re-engaging…" : "Re-engage"}
              </button>
              <button className="btn btn-secondary" onClick={() => setKeepOpen(true)}>
                Keep passed…
              </button>
            </div>
          ) : (
            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
              <div
                style={{
                  fontSize: 11,
                  color: "color-mix(in srgb, var(--color-text) 62%, transparent)",
                }}
              >
                A rationale is required to keep this firm passed.
              </div>
              <textarea
                className="input"
                value={rationale}
                onChange={(e) => setRationale(e.target.value)}
                placeholder="Why keep this firm passed despite the drift?"
                style={{ minHeight: 72, lineHeight: 1.45 }}
                aria-label="Reason to keep this firm passed"
              />
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn btn-primary" disabled={!canKeep} onClick={onKeep}>
                  {keepPassed.isPending ? "Keeping…" : "Keep passed"}
                </button>
                <button
                  className="btn btn-ghost"
                  onClick={() => setKeepOpen(false)}
                  disabled={keepPassed.isPending}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function formatChangeValue(v: unknown): string {
  if (v === null || v === undefined) {
    return "—";
  }
  if (typeof v === "string") {
    return v;
  }
  if (typeof v === "number" || typeof v === "boolean") {
    return String(v);
  }
  try {
    return JSON.stringify(v);
  } catch {
    return "?";
  }
}

// ─── Root ───────────────────────────────────────────────────────────────

function Review(): React.ReactElement {
  const {
    data: driftData,
    isLoading: driftLoading,
    error: driftError,
  } = useOsdkObjects(DriftEvent, {
    pageSize: 200,
    orderBy: { detectedAt: "desc" },
    autoFetchMore: true,
  });
  const { data: firmsData } = useOsdkObjects(Firm, {
    pageSize: 300,
    orderBy: { firmName: "asc" },
    autoFetchMore: true,
  });
  const { data: decisionsData } = useOsdkObjects(ReviewDecision, {
    pageSize: 500,
    orderBy: { decidedAt: "desc" },
    autoFetchMore: true,
  });

  const firmById = React.useMemo(() => {
    const m = new Map<string, unknown>();
    for (const f of firmsData ?? []) {
      if (f.firmId) {
        m.set(f.firmId, f);
      }
    }
    return m;
  }, [firmsData]);

  const firmNameById = React.useMemo(() => {
    const m = new Map<string, string>();
    for (const f of firmsData ?? []) {
      if (f.firmId) {
        m.set(f.firmId, f.firmName ?? f.firmId);
      }
    }
    return m;
  }, [firmsData]);

  // Observed post-decision outcome per firm. FDE backfills Firm.outcome
  // after a market event (LOI, went cold, acquired by competitor, …);
  // outcome_diverged drift events want the human label rendered next to
  // the analyst's original rejection reason.
  const outcomeByFirm = React.useMemo(() => {
    const m = new Map<string, string>();
    for (const f of (firmsData ?? []) as unknown as FirmLike[]) {
      if (f.firmId === undefined || f.firmId === "") {
        continue;
      }
      const raw = (f.outcome ?? "").trim();
      if (raw !== "") {
        m.set(f.firmId, raw);
      }
    }
    return m;
  }, [firmsData]);

  const drifts = React.useMemo(() => (driftData ?? []) as unknown as DriftLike[], [driftData]);

  // Most-recent decision per firm — the ReviewDecision query is ordered by
  // decidedAt desc, so the first entry for each firmId is the freshest.
  const mostRecentDecisionByFirm = React.useMemo(() => {
    const m = new Map<string, DecisionLike>();
    for (const d of (decisionsData ?? []) as unknown as DecisionLike[]) {
      const fid = d.firmId ?? null;
      if (fid === null || fid === "") {
        continue;
      }
      if (!m.has(fid)) {
        m.set(fid, d);
      }
    }
    return m;
  }, [decisionsData]);

  // Rejection rationale per firm, derived from the freshest decision. Used
  // as the "we passed because …" body on outcome_diverged drift cards.
  // Falls back to analystCategorization when the freeform rationale is
  // empty (matches passedFirms below).
  const rejectionReasonByFirm = React.useMemo(() => {
    const m = new Map<string, string>();
    for (const [fid, d] of mostRecentDecisionByFirm) {
      const text = (d.rejectionRationale ?? "").trim() || (d.analystCategorization ?? "").trim();
      if (text !== "") {
        m.set(fid, text);
      }
    }
    return m;
  }, [mostRecentDecisionByFirm]);

  // Firms in "passed" disposition (rejected or manually passed) that carry
  // a rationale. Reused as the search-space for lookalike matching.
  const passedFirms = React.useMemo(() => {
    const out: { firmId: string; firmName: string; rationale: string }[] = [];
    for (const f of (firmsData ?? []) as unknown as FirmLike[]) {
      if (f.firmId === undefined || f.firmId === "" || !isPassedDisposition(f)) {
        continue;
      }
      const decision = mostRecentDecisionByFirm.get(f.firmId);
      if (decision === undefined) {
        continue;
      }
      const rat =
        (decision.rejectionRationale ?? "").trim() || (decision.analystCategorization ?? "").trim();
      if (rat === "") {
        continue;
      }
      out.push({ firmId: f.firmId, firmName: f.firmName ?? f.firmId, rationale: rat });
    }
    return out;
  }, [firmsData, mostRecentDecisionByFirm]);

  // Precompute lookalikes per drift so cards don't recompute per render.
  // Reliability caveat: axis-in-rationale is a fuzzy substring match on
  // free-form text. Same limitation as the design's cluster: false positives
  // when the axis word appears incidentally, false negatives when analysts
  // paraphrase (e.g. rationale says "Sell-side thin" and axis is
  // "servicesFit"). We surface the count anyway — the analyst reviews the
  // list of firm names when they expand it and can dismiss noise.
  const lookalikesByDrift = React.useMemo(() => {
    const m = new Map<string, Lookalike[]>();
    for (const d of drifts) {
      if ((d.driftStatus ?? "").toLowerCase() === "resolved") {
        m.set(d.driftEventId, []);
        continue;
      }
      const axes = parseChangedAxes(d.changedAxes)
        .map((c) => c.axis)
        .filter((a): a is string => typeof a === "string" && a !== "");
      if (axes.length === 0) {
        m.set(d.driftEventId, []);
        continue;
      }
      const hits: Lookalike[] = [];
      for (const pf of passedFirms) {
        if (pf.firmId === d.firmId) {
          continue; // exclude the drift's own firm
        }
        const matched = axes.some((ax) => rationaleMatchesAxis(pf.rationale, ax));
        if (matched) {
          hits.push({ firmId: pf.firmId, firmName: pf.firmName });
        }
      }
      m.set(d.driftEventId, hits);
    }
    return m;
  }, [drifts, passedFirms]);

  // Open first, resolved after — within each, most-recent detectedAt first
  // (query already returns desc so the input order is fine).
  const ordered = React.useMemo(() => {
    const open: DriftLike[] = [];
    const resolved: DriftLike[] = [];
    for (const d of drifts) {
      if ((d.driftStatus ?? "").toLowerCase() === "resolved") {
        resolved.push(d);
      } else {
        open.push(d);
      }
    }
    return { open, resolved };
  }, [drifts]);

  const total = ordered.open.length;

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
        <BrandMark section="Review" />
        <WorkspaceNavLinks />
      </aside>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <header
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "0 24px",
            borderBottom: "1px solid var(--color-divider)",
            height: 56,
            flex: "0 0 56px",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.15 }}>
            <span style={{ fontWeight: 500, fontSize: 16 }}>Drift queue</span>
            <span
              style={{
                fontSize: 11,
                color: "color-mix(in srgb, var(--color-text) 48%, transparent)",
              }}
            >
              {driftLoading && drifts.length === 0
                ? "Loading drift events…"
                : `${total} firm${total === 1 ? "" : "s"} ha${total === 1 ? "s" : "ve"} moved since qualification${
                    ordered.resolved.length > 0 ? ` · ${ordered.resolved.length} resolved` : ""
                  }`}
            </span>
          </div>
        </header>

        {driftError && (
          <div
            style={{
              padding: "8px 24px",
              background: "rgba(207,112,112,.12)",
              color: "#e79191",
              fontSize: 12,
            }}
          >
            {String(driftError)}
          </div>
        )}

        <main
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "24px 24px 32px",
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          {!driftLoading && drifts.length === 0 && (
            <div
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 12,
                textAlign: "center",
                minHeight: 400,
              }}
            >
              <span
                style={{
                  width: 46,
                  height: 46,
                  borderRadius: "var(--radius-lg)",
                  background: "color-mix(in srgb, var(--color-accent) 12%, transparent)",
                  display: "grid",
                  placeItems: "center",
                  color: "var(--color-accent)",
                }}
              >
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              </span>
              <div style={{ fontSize: 19, fontWeight: 600 }}>
                No firms have moved since qualification
              </div>
              <p
                style={{
                  margin: 0,
                  fontSize: 14,
                  color: "color-mix(in srgb, var(--color-text) 60%, transparent)",
                  maxWidth: "44ch",
                }}
              >
                Beacon watches the ontology for score-changing updates on firms you&rsquo;ve already
                passed. When a stale reason is invalidated, it surfaces here.
              </p>
            </div>
          )}

          {ordered.open.map((d) => (
            <DriftCard
              key={d.driftEventId}
              drift={d}
              firmName={firmNameById.get(d.firmId ?? "") ?? d.firmId ?? "Unknown firm"}
              firmObj={firmById.get(d.firmId ?? "")}
              lookalikes={lookalikesByDrift.get(d.driftEventId) ?? []}
              rejectionReason={rejectionReasonByFirm.get(d.firmId ?? "") ?? null}
              observedOutcome={outcomeByFirm.get(d.firmId ?? "") ?? null}
            />
          ))}

          {ordered.resolved.length > 0 && (
            <>
              <div style={{ marginTop: 16 }}>
                <Kicker>Resolved</Kicker>
              </div>
              {ordered.resolved.map((d) => (
                <DriftCard
                  key={d.driftEventId}
                  drift={d}
                  firmName={firmNameById.get(d.firmId ?? "") ?? d.firmId ?? "Unknown firm"}
                  firmObj={firmById.get(d.firmId ?? "")}
                  lookalikes={lookalikesByDrift.get(d.driftEventId) ?? []}
                />
              ))}
            </>
          )}
        </main>
      </div>
    </div>
  );
}

export default Review;
