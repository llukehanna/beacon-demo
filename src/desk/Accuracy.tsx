import React from "react";
import { useOsdkObjects } from "@/data/hooks";
import { Firm, ResearchFinding } from "@/data/ontology";
import { BrandMark, WorkspaceNavLinks } from "./nav";
import "./nocturne.css";
import {
  DIVERGENCE_BG,
  DIVERGENCE_BORDER,
  DIVERGENCE_FG,
  VOID_BG,
  outcomeChipStyle,
  outcomeLabel,
  providerLabel,
} from "./tokens";
// Aggregation semantics live in ./trustMetrics so the Home trust panel and
// this page quote identical rates.
import {
  type RatedFinding as FindingLike,
  type FirmOutcomeLike,
  INSUFFICIENT_THRESHOLD,
  NULL_OUTCOME_KEY,
  OUTCOME_SLOTS,
  type Rates,
  rates,
  tallyOutcomes,
} from "./trustMetrics";

// ─── Axis label mapping ─────────────────────────────────────────────────
// Findings arrive with raw axis keys (either camelCase or snake_case).
// Render human labels matching the design's dataProvider.AXES vocabulary.

// Axis labels — the backend now canonicalizes to the agent vocabulary
// (deal_size_usd_m, firm_age_years, deals_per_md_l3y, …) so the map is mostly
// a no-op. We keep the older camelCase / short-form variants so any residual
// legacy row still folds into the same axis bucket instead of splitting the
// table.
const AXIS_LABEL: Record<string, string> = {
  coverage_model: "Sector coverage",
  coveragemodel: "Sector coverage",
  services_fit: "Services fit",
  servicesfit: "Services fit",
  md_pedigree: "MD pedigree",
  mdpedigree: "MD pedigree",
  balance_sheet_principal: "Balance sheet / principal",
  balancesheetprincipal: "Balance sheet / principal",
  deal_size: "Avg deal size",
  dealsize: "Avg deal size",
  dealsizemusd: "Avg deal size",
  dealsizeusdm: "Avg deal size",
  deals_per_md: "Deals / MD (L3Y)",
  dealspermd: "Deals / MD (L3Y)",
  dealspermdl3y: "Deals / MD (L3Y)",
  firm_age: "Firm age",
  firmage: "Firm age",
  firmageyears: "Firm age",
  employees: "Employees",
  fee_generating_count: "Fee-earning heads",
  feegeneratingcount: "Fee-earning heads",
  geographic_footprint: "Geographic fit",
  geographicfootprint: "Geographic fit",
};

function canonicalAxisKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[_\s-]+/g, "");
}

// Provider strings we discard from the BY PROVIDER breakdown — these are not
// real data sources, so quoting a rate against them is misleading. Findings
// with these providers still count in overall and BY AXIS metrics; they just
// don't earn a row of their own.
const NON_PROVIDER_VALUES = new Set(["", "none", "unknown"]);

// Hard-gate axes are yes/no facts (has ST or balance sheet, advisory
// conflict, web activity, solvent) — they're captured through Beacon's gate
// UI, not the rubric. Aggregating agreement / override on binary gates with
// tiny sample sizes carries no signal, so we drop them from BY AXIS. If a
// hard-gate breakdown is ever wanted it belongs in its own table with its
// own labels.
const HARD_GATE_AXIS_KEYS = new Set([
  "hasstorbalancesheet",
  "advisoryconflict",
  "webactivity",
  "solvent",
]);

function axisLabel(raw: string | undefined): string {
  if (raw === undefined || raw === "") {
    return "unknown axis";
  }
  return AXIS_LABEL[canonicalAxisKey(raw)] ?? titleize(raw);
}

function titleize(raw: string): string {
  return raw
    .trim()
    .split(/[_\s-]+/)
    .map((w) => (w.length > 0 ? w[0].toUpperCase() + w.slice(1).toLowerCase() : ""))
    .join(" ");
}

function providerRowLabel(raw: string | undefined): string {
  if (raw === undefined || raw === "") {
    return "unknown";
  }
  return providerLabel(raw);
}

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

function ProviderChip({ label }: { label: string }): React.ReactElement {
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
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}

// Cells with fewer than this many samples render "n=X" muted instead of a
// percentage — one override on a two-finding provider shouldn't read as
// "Deal DB 100% wrong".
const MIN_SAMPLE = 5;

// Bar + percentage cell. Below the sample floor the cell falls back to a
// muted "n=X" so the reader can't mistake sparse data for a strong signal.
function RateCell({
  pct,
  sample,
  showBar,
  color,
}: {
  pct: number | null;
  sample: number;
  showBar: boolean;
  color: string;
}): React.ReactElement {
  const insufficientSample = sample < MIN_SAMPLE;
  const displayColor = insufficientSample
    ? "color-mix(in srgb, var(--color-text) 42%, transparent)"
    : color;
  return (
    <span
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        fontVariantNumeric: "tabular-nums",
        fontSize: 12,
        color: displayColor,
      }}
    >
      {showBar && !insufficientSample && (
        <span
          style={{
            width: 34,
            height: 4,
            borderRadius: "var(--radius-xs)",
            background: "var(--color-neutral-800)",
            position: "relative",
            overflow: "hidden",
            flex: "none",
          }}
        >
          <span
            style={{
              position: "absolute",
              inset: "0 auto 0 0",
              width: `${pct ?? 0}%`,
              background: "var(--color-accent)",
              borderRadius: "var(--radius-xs)",
            }}
          />
        </span>
      )}
      {insufficientSample ? `n=${sample}` : pct === null ? "—" : `${pct}%`}
    </span>
  );
}

// ─── Root ───────────────────────────────────────────────────────────────

function Accuracy(): React.ReactElement {
  const { data, isLoading, error } = useOsdkObjects(ResearchFinding, {
    pageSize: 1000,
    autoFetchMore: true,
  });
  const {
    data: firmsData,
    isLoading: firmsLoading,
    error: firmsError,
  } = useOsdkObjects(Firm, {
    pageSize: 500,
    autoFetchMore: true,
  });
  const findings = React.useMemo(() => (data ?? []) as unknown as FindingLike[], [data]);
  const firms = React.useMemo(() => (firmsData ?? []) as unknown as FirmOutcomeLike[], [firmsData]);

  // Counts by outcome across all firms + headline: how many firms we
  // passed on ended up acquired by a competitor. The panel is a fixed
  // grid of the five outcome slots (four backend enums + not-yet-observed);
  // slots always render, even when a bucket is empty.
  const outcomeCounts = React.useMemo(() => tallyOutcomes(firms), [firms]);

  const overall = React.useMemo(() => rates(findings), [findings]);

  const byProvider = React.useMemo(() => {
    const map = new Map<string, FindingLike[]>();
    for (const f of findings) {
      const raw = (f.provider ?? "").trim().toLowerCase();
      // "unknown" / "none" / empty aren't providers — they'd otherwise appear
      // as a row that carries the abstained/analyst-entered findings and
      // publish a misleading rate against a non-source. Skip them here; they
      // still count toward the overall abstention headline and BY AXIS.
      if (NON_PROVIDER_VALUES.has(raw)) {
        continue;
      }
      const key = f.provider!;
      const arr = map.get(key) ?? [];
      arr.push(f);
      map.set(key, arr);
    }
    const out = [...map.entries()]
      .map(([provider, group]) => ({
        key: provider,
        label: providerRowLabel(provider),
        r: rates(group),
      }))
      .filter((row) => {
        // Drop rows with no findings at all — nothing to display.
        if (row.r.total === 0) {
          return false;
        }
        // Corroboration tags (multi-provider strings like "dealdb+filings")
        // are only meaningful once an analyst has decided on them. With zero
        // decided findings the row publishes 0% / 0% / abstention-pct — a
        // stat about a tag, not about a data source. Drop it. Single
        // providers can still show a legit 100% abstention row.
        const isCorroboration = row.key.includes("+");
        if (isCorroboration && row.r.decided === 0) {
          return false;
        }
        return true;
      });
    // Alphabetical by label so the display order is stable across renders.
    out.sort((a, b) => a.label.localeCompare(b.label));
    return out;
  }, [findings]);

  const byAxis = React.useMemo(() => {
    // Bucket by the canonical (stripped-lowercase) axis key so residual
    // snake_case/camelCase variants land in the same row. Since the backend
    // canonicalizes now this is mostly a safety net, but a mixed backlog will
    // still fold cleanly here.
    const map = new Map<string, FindingLike[]>();
    const labelBySlot = new Map<string, string>();
    const rawBySlot = new Map<string, string>();
    for (const f of findings) {
      const raw = (f.axis ?? "").trim();
      const slot = raw === "" ? "__unknown__" : canonicalAxisKey(raw);
      // Hard gates are yes/no facts captured through the gates UI, not part
      // of the rubric — showing them here would clutter the axis table with
      // low-n rows that read as "Advisory Conflict n=1".
      if (HARD_GATE_AXIS_KEYS.has(slot)) {
        continue;
      }
      const arr = map.get(slot) ?? [];
      arr.push(f);
      map.set(slot, arr);
      if (!labelBySlot.has(slot)) {
        labelBySlot.set(slot, raw === "" ? "unknown axis" : axisLabel(raw));
        rawBySlot.set(slot, raw === "" ? slot : raw);
      }
    }
    const out = [...map.entries()]
      .map(([slot, group]) => ({
        key: rawBySlot.get(slot) ?? slot,
        label: labelBySlot.get(slot) ?? slot,
        r: rates(group),
      }))
      // An axis with zero findings has nothing to say — leave it off.
      .filter((row) => row.r.total > 0);
    // Most-signalled axes first — matches the design's ordering intent.
    out.sort((a, b) => b.r.total - a.r.total);
    return out;
  }, [findings]);

  const insufficient = !isLoading && overall.decided < INSUFFICIENT_THRESHOLD;

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
        <BrandMark section="Accuracy" />
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
            <span style={{ fontWeight: 500, fontSize: 16 }}>Trust metrics</span>
            <span
              style={{
                fontSize: 11,
                color: "color-mix(in srgb, var(--color-text) 48%, transparent)",
              }}
            >
              {isLoading && findings.length === 0
                ? "Loading findings…"
                : "How often Beacon agreed with you, was overridden, or honestly abstained"}
            </span>
          </div>
        </header>

        {(error || firmsError) && (
          <div
            style={{
              padding: "8px 24px",
              background: "rgba(207,112,112,.12)",
              color: "#e79191",
              fontSize: 12,
            }}
          >
            {error && <div>{String(error)}</div>}
            {firmsError && <div>Firms: {String(firmsError)}</div>}
          </div>
        )}

        <main
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "24px 24px 32px",
            display: "flex",
            flexDirection: "column",
            gap: 24,
            maxWidth: 1000,
          }}
        >
          {insufficient && (
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
                  background: "var(--color-neutral-800)",
                  display: "grid",
                  placeItems: "center",
                  color: "color-mix(in srgb, var(--color-text) 55%, transparent)",
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
                  <path d="M3 3v18h18" />
                  <path d="M7 14l4-4 3 3 5-6" />
                </svg>
              </span>
              <div style={{ fontSize: 19, fontWeight: 600 }}>
                Trust metrics appear after {INSUFFICIENT_THRESHOLD} decided findings
              </div>
              <p
                style={{
                  margin: 0,
                  fontSize: 14,
                  color: "color-mix(in srgb, var(--color-text) 60%, transparent)",
                  maxWidth: "44ch",
                }}
              >
                Beacon needs a baseline of agent-vs-analyst decisions before agreement, override,
                and abstention rates are meaningful. {overall.decided} decided so far. Keep
                reviewing.
              </p>
            </div>
          )}

          {!insufficient && !isLoading && (
            <>
              <div
                style={{
                  padding: 16,
                  borderRadius: "var(--radius-md)",
                  background: "color-mix(in srgb, var(--color-accent) 9%, transparent)",
                  border: "1px solid color-mix(in srgb, var(--color-accent) 22%, transparent)",
                }}
              >
                <span style={{ fontSize: 26, fontWeight: 600 }}>
                  Honest abstention rate:{" "}
                  <span style={{ color: "var(--color-accent)" }}>{overall.abstention}%</span>
                </span>
                <div
                  style={{
                    fontSize: 13,
                    color: "color-mix(in srgb, var(--color-text) 65%, transparent)",
                    marginTop: 4,
                  }}
                >
                  When no source had it, Beacon said so instead of guessing.
                </div>
              </div>

              <OutcomesPanel
                counts={outcomeCounts.counts}
                passed={outcomeCounts.passed}
                passedAndAcquired={outcomeCounts.passedAndAcquired}
                isLoading={firmsLoading}
              />

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 24,
                  alignItems: "start",
                }}
              >
                <MetricsTable
                  title="By provider"
                  rows={byProvider.map((p) => ({
                    key: p.key,
                    label: <ProviderChip label={p.label} />,
                    r: p.r,
                  }))}
                />
                <MetricsTable
                  title="By axis"
                  rows={byAxis.map((a) => ({
                    key: a.key,
                    label: (
                      <span
                        style={{
                          fontSize: 12,
                          color: "color-mix(in srgb, var(--color-text) 72%, transparent)",
                        }}
                      >
                        {a.label}
                      </span>
                    ),
                    r: a.r,
                  }))}
                />
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: "color-mix(in srgb, var(--color-text) 48%, transparent)",
                  lineHeight: 1.55,
                  maxWidth: "72ch",
                }}
              >
                <strong style={{ fontWeight: 600 }}>Of decided</strong> = the agent proposed a value
                and you either accepted (agreement) or rejected it (override); abstains excluded.{" "}
                <strong style={{ fontWeight: 600 }}>Of all findings</strong> = every finding the
                agent produced for this group, abstains included, so the columns don&rsquo;t sum to
                100%.
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}

interface MetricsRow {
  key: string;
  label: React.ReactNode;
  r: Rates;
}

function MetricsTable({ title, rows }: { title: string; rows: MetricsRow[] }): React.ReactElement {
  return (
    // Section header spacing comes from the parent gap, as on every other
    // page — Kicker used to carry its own marginBottom here, which made
    // Accuracy the one screen whose section headers sat at a different
    // offset from its siblings.
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <Kicker>{title}</Kicker>
      {/* Group headers: agreement + override share a denominator (decided
          non-abstain findings), abstention uses a different one (all
          findings). Making that split visible prevents the "100% + 26%?"
          misread — the percentages are of different totals. */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1.4fr 2fr 1fr",
          gap: "4px 12px",
          fontSize: 10,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "color-mix(in srgb, var(--color-text) 38%, transparent)",
        }}
      >
        <span />
        <span
          style={{
            borderBottom: "1px solid color-mix(in srgb, var(--color-text) 18%, transparent)",
            paddingBottom: 3,
            textAlign: "center",
          }}
        >
          Of decided
        </span>
        <span
          style={{
            borderBottom: "1px solid color-mix(in srgb, var(--color-text) 18%, transparent)",
            paddingBottom: 3,
            textAlign: "center",
          }}
        >
          Of all findings
        </span>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1.4fr 1fr 1fr 1fr",
          gap: "9px 12px",
          fontSize: 11,
          color: "color-mix(in srgb, var(--color-text) 42%, transparent)",
          marginTop: 4,
        }}
      >
        <span />
        <span>Agreement</span>
        <span>Override</span>
        <span>Abstention</span>
      </div>
      {rows.length === 0 && (
        <div
          style={{
            marginTop: 8,
            fontSize: 12,
            color: "color-mix(in srgb, var(--color-text) 50%, transparent)",
          }}
        >
          No findings yet.
        </div>
      )}
      {rows.map((row) => (
        <div
          key={row.key}
          style={{
            display: "grid",
            gridTemplateColumns: "1.4fr 1fr 1fr 1fr",
            gap: "9px 12px",
            alignItems: "center",
            padding: "8px 0",
            borderBottom: "1px solid var(--color-divider)",
          }}
          title={
            row.r.decided > 0
              ? `${row.r.decided} decided of ${row.r.total} total`
              : `${row.r.total} findings, none decided yet`
          }
        >
          {row.label}
          <RateCell pct={row.r.agreement} sample={row.r.decided} showBar={true} color="inherit" />
          <RateCell pct={row.r.override} sample={row.r.decided} showBar={false} color="#e6c878" />
          <RateCell pct={row.r.abstention} sample={row.r.total} showBar={false} color="#e79191" />
        </div>
      ))}
    </div>
  );
}

// ─── Outcomes panel ─────────────────────────────────────────────────────
// Counts by outcome across every firm, plus a single headline: "Of firms
// we passed, N were later acquired — the drift loop exists to catch
// these." Counts and chips only, no charts — the panel sits above BY
// PROVIDER because it frames why the trust metrics matter.

function OutcomesPanel({
  counts,
  passed,
  passedAndAcquired,
  isLoading,
}: {
  counts: Record<string, number>;
  passed: number;
  passedAndAcquired: number;
  isLoading: boolean;
}): React.ReactElement {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          fontSize: 10,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "color-mix(in srgb, var(--color-text) 45%, transparent)",
        }}
      >
        Outcomes
        {isLoading && (
          <span
            style={{
              fontSize: 10,
              letterSpacing: 0,
              textTransform: "none",
              color: "color-mix(in srgb, var(--color-text) 42%, transparent)",
            }}
          >
            loading firms…
          </span>
        )}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${OUTCOME_SLOTS.length}, minmax(0, 1fr))`,
          gap: 12,
        }}
      >
        {OUTCOME_SLOTS.map((slot) => {
          const key = slot ?? NULL_OUTCOME_KEY;
          const n = counts[key] ?? 0;
          const style = outcomeChipStyle(slot);
          return (
            <div
              key={key}
              style={{
                padding: 12,
                borderRadius: "var(--radius-md)",
                background: "var(--color-surface)",
                border: `1px solid ${style.border}`,
                display: "flex",
                flexDirection: "column",
                gap: 4,
                minWidth: 0,
              }}
            >
              <span
                style={{
                  fontSize: 21,
                  fontWeight: 600,
                  fontVariantNumeric: "tabular-nums",
                  color: style.fg,
                }}
              >
                {n}
              </span>
              <span
                style={{
                  fontSize: 11,
                  color: "color-mix(in srgb, var(--color-text) 62%, transparent)",
                }}
              >
                {outcomeLabel(slot)}
              </span>
            </div>
          );
        })}
      </div>

      {passed > 0 && (
        <div
          style={{
            padding: "12px 16px",
            borderRadius: "var(--radius-md)",
            // Divergence violet, matching the outcome chips above and the
            // outcome_diverged entries on /review. Red is for rejection.
            background: DIVERGENCE_BG,
            border: `1px solid ${DIVERGENCE_BORDER}`,
            fontSize: 13,
            color: "color-mix(in srgb, var(--color-text) 82%, transparent)",
            lineHeight: 1.5,
          }}
        >
          Of firms we passed,{" "}
          <strong style={{ color: DIVERGENCE_FG, fontWeight: 600 }}>{passedAndAcquired}</strong>{" "}
          {passedAndAcquired === 1 ? "was" : "were"} later acquired. The drift loop exists to catch
          these.
        </div>
      )}
    </div>
  );
}

export default Accuracy;
