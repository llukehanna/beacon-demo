import React from "react";
import { Link } from "react-router-dom";
import { useLinks, useOsdkObjects } from "@/data/hooks";
import {
  DriftEvent,
  Firm,
  HardScreenConfig,
  Mandate,
  ProposedRule,
  ResearchFinding,
  Search,
  SearchList,
  SearchMembership,
} from "@/data/ontology";
import {
  type ScreenableFirm,
  countScreened,
  isEvaluable,
  toScreeningRules,
} from "./activeScreening";
import { needsYouAxisCountByFirm } from "./axisState";
import {
  type FirmLike,
  type MembershipLike,
  type SearchLike,
  type SearchListLike,
  formatMandateFirmCounts,
  mandateFirmCounts,
  searchListFirmIds,
} from "./mandateFirms";
import { BrandMark, WorkspaceNavLinks } from "./nav";
import "./nocturne.css";
import { LIFECYCLE_BUCKETS, type Lifecycle, bucketOf, emptyBucketCounts } from "./pipelineBuckets";
import { type ActiveConfigRule, orderEnrichmentQueue } from "./queue";
import { summarizePredicate } from "./rulePredicate";
import { type ScoreInput, mirrorScore } from "./scoreMirror";
import {
  DIVERGENCE_BG,
  DIVERGENCE_BORDER,
  DIVERGENCE_FG,
  DIVERGENCE_PHRASE,
  OUTCOME_ACQUIRED,
  VOID_BG,
  driftReasonPresentation,
  isOutcomeDivergence,
  outcomeLabel,
} from "./tokens";
import {
  type FirmOutcomeLike,
  INSUFFICIENT_THRESHOLD,
  OUTCOME_SLOTS,
  type RatedFinding,
  rates,
  tallyOutcomes,
} from "./trustMetrics";

/**
 * Home — the start-of-day operations page.
 *
 * Two columns: an operational spine on the left (triage inbox → mandates →
 * funnel) and a trust rail on the right. Every row and every number links
 * to the surface where that work happens; nothing here is render-only, and
 * the funnel strip is the only visualization.
 *
 * Each figure comes from the SAME shared module the destination page uses
 * — queue.ts for the workable band, pipelineBuckets.ts for the funnel,
 * trustMetrics.ts for abstention/agreement, axisState.ts for needs-you
 * axes. Home must never promise work the page it links to doesn't show.
 */

// ─── Shapes ─────────────────────────────────────────────────────────────

interface FirmRow extends ScoreInput {
  firmId?: string;
  firmName?: string | null;
  lifecycleState?: string | null;
  currentStage?: string | null;
  disposition?: string | null;
  outcome?: string | null;
  discoveredViaSearchId?: string | null;
}

interface DriftLike {
  driftEventId: string;
  firmId?: string;
  driftReason?: string;
  driftStatus?: string;
  detectedAt?: unknown;
  priorTier?: string;
  priorScore?: number;
  newTier?: string;
  newScore?: number;
}

interface RuleLike {
  proposedRuleId: string;
  predicateAxis?: string;
  ruleOperator?: string;
  ruleThreshold?: string;
  ruleStatus?: string;
  // Scopes the rule to one model; screening honours it so a CF-only rule
  // isn't counted against CS firms.
  ruleModel?: string;
  projectedScreenCount?: number;
}

interface MandateLike {
  mandateId: string;
  title?: string | null;
  intentStatement?: string | null;
  archetype?: string | null;
  priority?: string | null;
  active?: boolean | null;
}

function toScoreInput(f: FirmRow): ScoreInput {
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

function SectionHead({
  title,
  href,
  linkLabel,
}: {
  title: React.ReactNode;
  href: string;
  linkLabel: string;
}): React.ReactElement {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        gap: 12,
        marginBottom: 8,
      }}
    >
      <Kicker>{title}</Kicker>
      <Link className="home-quiet-link" to={href} style={{ fontSize: 12 }}>
        {linkLabel} →
      </Link>
    </div>
  );
}

// Numbers must never read "0" while their query is in flight — a premature
// zero on this page says "nothing needs you", which is the one lie a
// start-of-day screen can't tell. Same shimmer Pipeline's tiles use.
function Shimmer({ w, h }: { w: number; h: number }): React.ReactElement {
  return (
    <span
      aria-hidden
      style={{
        display: "inline-block",
        height: h,
        width: w,
        borderRadius: "var(--radius-sm)",
        verticalAlign: "middle",
        background:
          "linear-gradient(90deg, color-mix(in srgb, var(--color-text) 6%, transparent) 0%, color-mix(in srgb, var(--color-text) 16%, transparent) 50%, color-mix(in srgb, var(--color-text) 6%, transparent) 100%)",
        backgroundSize: "200% 100%",
        animation: "beacon-shimmer 1.6s linear infinite",
      }}
    />
  );
}

// ─── Triage inbox ───────────────────────────────────────────────────────

// One destination per item type — also decides where "+N more" points.
type Destination = "review" | "desk" | "rules";

const DESTINATION_PATH: Record<Destination, string> = {
  review: "/review",
  desk: "/desk",
  rules: "/rules",
};

// Rail colours. Drift rows reuse /review's per-reason vocabulary verbatim
// (violet divergence, amber invalidated pass reason, red tier move) so a
// row here and the card it opens wear the same colour. Judgment rows take
// the desk's teal; rule rows take the blue of /rules' own Pending chip.
const JUDGMENT_RAIL = "color-mix(in srgb, var(--color-accent) 55%, transparent)";
const JUDGMENT_FG = "var(--color-accent-300)";
const RULE_RAIL = "color-mix(in srgb, #4a90d9 55%, transparent)";
const RULE_FG = "#8ec1ee";

interface InboxItem {
  key: string;
  // Urgency rank: 0 divergence · 1 pass reason invalidated · 2 other drift
  // · 3 needs-you firm · 4 pending rule. Ties break on the per-type order
  // the destination page already uses.
  rank: number;
  to: string;
  destination: Destination;
  rail: string;
  name: string;
  story: React.ReactNode;
  storyColor: string;
  typeLabel: string;
}

const VISIBLE_ROWS = 7;

function InboxRow({ item, last }: { item: InboxItem; last: boolean }): React.ReactElement {
  return (
    <Link
      to={item.to}
      className="home-row"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "9px 13px 9px 12px",
        textDecoration: "none",
        color: "inherit",
        borderLeftStyle: "solid",
        borderLeftWidth: 3,
        borderLeftColor: item.rail,
        borderBottomStyle: "solid",
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: "var(--color-divider)",
        minWidth: 0,
      }}
    >
      <span
        style={{
          fontSize: 13,
          fontWeight: 600,
          flex: "0 1 auto",
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        title={item.name}
      >
        {item.name}
      </span>
      <span
        style={{
          fontSize: 13,
          color: item.storyColor,
          flex: "1 1 auto",
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {item.story}
      </span>
      <span
        style={{
          fontSize: 10,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: "color-mix(in srgb, var(--color-text) 40%, transparent)",
          flex: "none",
        }}
      >
        {item.typeLabel}
      </span>
    </Link>
  );
}

// Zero-states are a quiet line at the foot of the stack, never a card —
// an empty type still says what it would say, without taking up the room
// of work that exists.
function QuietLine({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <div
      style={{
        fontSize: 12,
        lineHeight: 1.5,
        color: "color-mix(in srgb, var(--color-text) 42%, transparent)",
        padding: "7px 13px",
        borderTop: "1px solid var(--color-divider)",
      }}
    >
      {children}
    </div>
  );
}

// ─── Mandate row ────────────────────────────────────────────────────────

function MandateRow({
  mandate,
  scoped,
  fromSearches,
  loading,
}: {
  mandate: MandateLike;
  scoped: number;
  fromSearches: number;
  loading: boolean;
}): React.ReactElement {
  const headline =
    (mandate.intentStatement ?? "").trim() || (mandate.title ?? "").trim() || mandate.mandateId;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: 12,
        borderBottom: "1px solid var(--color-divider)",
        minWidth: 0,
      }}
    >
      {/* One line per mandate: the sentence ellipsizes rather than wrapping
          the row to two lines, with the full text on the title. */}
      <span
        style={{
          fontSize: 13,
          fontWeight: 500,
          flex: "1 1 auto",
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        title={headline}
      >
        {headline}
      </span>
      <Link
        className="home-quiet-link"
        to="/desk"
        style={{
          fontSize: 12,
          fontVariantNumeric: "tabular-nums",
          flex: "none",
          whiteSpace: "nowrap",
        }}
        title="Scoped = every firm in this mandate's lists and searches. From searches = the subset a Search run attached."
      >
        {loading ? <Shimmer w={86} h={11} /> : formatMandateFirmCounts({ scoped, fromSearches })}
      </Link>
      <Link
        to={`/search/${encodeURIComponent(mandate.mandateId)}`}
        style={{
          fontSize: 12,
          color: "var(--color-accent)",
          textDecoration: "none",
          flex: "none",
          whiteSpace: "nowrap",
        }}
        title="Turn this intent sentence into a Search"
      >
        Interpret &amp; run search →
      </Link>
      <Link
        to="/desk"
        style={{
          fontSize: 12,
          color: "var(--color-accent)",
          textDecoration: "none",
          flex: "none",
          whiteSpace: "nowrap",
        }}
      >
        Work in desk →
      </Link>
    </div>
  );
}

// ─── Funnel strip ───────────────────────────────────────────────────────

function FunnelStrip({
  counts,
  loading,
}: {
  counts: Record<Lifecycle, number>;
  loading: boolean;
}): React.ReactElement {
  return (
    <Link
      to="/pipeline"
      className="home-row"
      style={{
        display: "flex",
        alignItems: "baseline",
        gap: 0,
        flexWrap: "wrap",
        padding: 12,
        borderRadius: "var(--radius-md)",
        border: "1px solid var(--color-divider)",
        textDecoration: "none",
        color: "inherit",
      }}
    >
      {LIFECYCLE_BUCKETS.map((b, i) => {
        const n = counts[b];
        // A zero stage still holds its place in the funnel — dimmed, not
        // dropped, so the shape of the pipeline stays readable.
        const dim = !loading && n === 0;
        return (
          <React.Fragment key={b}>
            {i > 0 && (
              <span
                aria-hidden
                style={{
                  padding: "0 9px",
                  fontSize: 11,
                  color: "color-mix(in srgb, var(--color-text) 24%, transparent)",
                }}
              >
                →
              </span>
            )}
            <span
              style={{
                display: "inline-flex",
                alignItems: "baseline",
                gap: 4,
                opacity: dim ? 0.4 : 1,
              }}
            >
              {loading ? (
                <Shimmer w={26} h={14} />
              ) : (
                <span
                  style={{
                    fontSize: 16,
                    fontWeight: 600,
                    fontVariantNumeric: "tabular-nums",
                    lineHeight: 1,
                  }}
                >
                  {n}
                </span>
              )}
              <span
                style={{
                  fontSize: 11,
                  color: "color-mix(in srgb, var(--color-text) 52%, transparent)",
                  whiteSpace: "nowrap",
                }}
              >
                {b}
              </span>
            </span>
          </React.Fragment>
        );
      })}
    </Link>
  );
}

// ─── Trust rail ─────────────────────────────────────────────────────────

function OutcomeCell({
  slot,
  count,
  loading,
}: {
  slot: string;
  count: number;
  loading: boolean;
}): React.ReactElement {
  // acquired_by_competitor is the divergence story in aggregate — the firms
  // we passed on that the market bought. Violet, matching the review
  // entries it generates. Red is reserved for rejection.
  const diverged = slot === OUTCOME_ACQUIRED;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 2,
        padding: 12,
        borderRadius: "var(--radius-sm)",
        background: diverged ? DIVERGENCE_BG : "var(--color-neutral-900)",
        border: `1px solid ${diverged ? DIVERGENCE_BORDER : "var(--color-divider)"}`,
        minWidth: 0,
      }}
    >
      {loading ? (
        <Shimmer w={22} h={16} />
      ) : (
        <span
          style={{
            fontSize: 19,
            fontWeight: 600,
            lineHeight: 1,
            fontVariantNumeric: "tabular-nums",
            color: diverged ? DIVERGENCE_FG : "inherit",
          }}
        >
          {count}
        </span>
      )}
      <span
        style={{
          fontSize: 11,
          lineHeight: 1.3,
          color: "color-mix(in srgb, var(--color-text) 58%, transparent)",
        }}
      >
        {outcomeLabel(slot)}
      </span>
    </div>
  );
}

// ─── Root ───────────────────────────────────────────────────────────────

function Home(): React.ReactElement {
  // Query shapes deliberately mirror the destination pages so the query
  // cache is warm on navigation and both surfaces see identical rows.
  const {
    data: firmData,
    isLoading: firmsLoading,
    error: firmsError,
  } = useOsdkObjects(Firm, {
    pageSize: 300,
    orderBy: { firmName: "asc" },
    autoFetchMore: true,
  });
  const { data: configData, isLoading: configsLoading } = useOsdkObjects(HardScreenConfig, {
    pageSize: 200,
    autoFetchMore: true,
  });
  const {
    data: driftData,
    isLoading: driftsLoading,
    error: driftsError,
  } = useOsdkObjects(DriftEvent, {
    pageSize: 200,
    orderBy: { detectedAt: "desc" },
    autoFetchMore: true,
  });
  const {
    data: ruleData,
    isLoading: rulesLoading,
    error: rulesError,
  } = useOsdkObjects(ProposedRule, { pageSize: 200, autoFetchMore: true });
  const {
    data: findingData,
    isLoading: findingsLoading,
    error: findingsError,
  } = useOsdkObjects(ResearchFinding, { pageSize: 1000, autoFetchMore: true });
  const {
    data: mandateData,
    isLoading: mandatesLoading,
    error: mandatesError,
  } = useOsdkObjects(Mandate, {
    pageSize: 100,
    orderBy: { createdAt: "desc" },
    autoFetchMore: true,
  });
  const { data: searchData, isLoading: searchesLoading } = useOsdkObjects(Search, {
    pageSize: 200,
    orderBy: { runAt: "desc" },
    autoFetchMore: true,
  });
  // Flat join table behind the Search↔firms link — three string columns, so
  // a wide page is cheap.
  const { data: membershipData, isLoading: membershipsLoading } = useOsdkObjects(SearchMembership, {
    pageSize: 1000,
    autoFetchMore: true,
  });
  // SearchList is the assembled candidate universe for a mandate and has no
  // flat join table, so its membership comes through the M2M link. useLinks
  // takes the whole array of lists in ONE traversal and keys the result by
  // each list's primary key — this is the source /mandate counts from, and
  // including it is what makes Home's number agree with that page.
  const { data: searchListData, isLoading: searchListsLoading } = useOsdkObjects(SearchList, {
    pageSize: 200,
    orderBy: { createdAt: "desc" },
    autoFetchMore: true,
  });
  const searchListInstances = React.useMemo(
    () => (searchListData ?? []) as never[],
    [searchListData],
  );
  const searchListLinks = useLinks(searchListInstances, "firms", {
    pageSize: 500,
    $select: ["firmId"] as never,
  });

  const firms = React.useMemo(() => (firmData ?? []) as unknown as FirmRow[], [firmData]);
  const drifts = React.useMemo(() => (driftData ?? []) as unknown as DriftLike[], [driftData]);
  const rules = React.useMemo(() => (ruleData ?? []) as unknown as RuleLike[], [ruleData]);
  const findings = React.useMemo(
    () => (findingData ?? []) as unknown as RatedFinding[],
    [findingData],
  );
  const mandates = React.useMemo(
    () => (mandateData ?? []) as unknown as MandateLike[],
    [mandateData],
  );

  const activeConfigs = React.useMemo<ActiveConfigRule[]>(() => {
    return (
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
      .filter((r) => r.axis !== "" && r.operator !== "" && r.threshold !== "");
  }, [configData]);

  const firmNameById = React.useMemo(() => {
    const m = new Map<string, string>();
    for (const f of firms) {
      if (f.firmId !== undefined && f.firmId !== "") {
        m.set(f.firmId, f.firmName ?? f.firmId);
      }
    }
    return m;
  }, [firms]);

  // ── Inbox sources ──────────────────────────────────────────────────
  const openDrifts = React.useMemo(
    () => drifts.filter((d) => (d.driftStatus ?? "").toLowerCase() !== "resolved"),
    [drifts],
  );
  const pendingRules = React.useMemo(
    () => rules.filter((r) => (r.ruleStatus ?? "pending").toLowerCase() === "pending"),
    [rules],
  );

  // The queue's workable band: not hard-screened, not terminal — the same
  // ranking the desk sidebar renders, so "first" here is first there too.
  const workable = React.useMemo(() => {
    const ranked = orderEnrichmentQueue(
      firms.map((f) => ({
        firmId: f.firmId ?? "",
        firmName: f.firmName,
        lifecycleState: f.lifecycleState,
        currentStage: f.currentStage,
        disposition: f.disposition ?? null,
        ...toScoreInput(f),
      })),
      activeConfigs,
    );
    return ranked.filter((r) => !r.hardScreened && !r.terminal);
  }, [firms, activeConfigs]);

  const needsYouByFirm = React.useMemo(
    () =>
      needsYouAxisCountByFirm(
        (findingData ?? []) as unknown as Array<{ findingId: string; firmId?: string }>,
      ),
    [findingData],
  );

  const judgmentFirms = React.useMemo(
    () =>
      workable
        .map((r) => ({
          firmId: r.firm.firmId,
          firmName: r.firm.firmName ?? r.firm.firmId,
          axes: needsYouByFirm.get(r.firm.firmId) ?? 0,
        }))
        .filter((r) => r.axes > 0),
    [workable, needsYouByFirm],
  );

  // ── Merged, urgency-sorted inbox ───────────────────────────────────
  const inbox = React.useMemo<InboxItem[]>(() => {
    const items: InboxItem[] = [];

    for (const d of openDrifts) {
      const reason = driftReasonPresentation(d.driftReason);
      const diverged = isOutcomeDivergence(d.driftReason);
      const invalidated = (d.driftReason ?? "").toLowerCase() === "pass_reason_invalidated";
      const tierMove =
        d.priorTier && d.newTier
          ? `${d.priorTier} ${d.priorScore ?? ""} → ${d.newTier} ${d.newScore ?? ""}`.replace(
              /\s+/g,
              " ",
            )
          : null;
      items.push({
        key: `drift:${d.driftEventId}`,
        rank: diverged ? 0 : invalidated ? 1 : 2,
        to: "/review",
        destination: "review",
        rail: reason.border,
        name: firmNameById.get(d.firmId ?? "") ?? d.firmId ?? "Unknown firm",
        story: diverged
          ? DIVERGENCE_PHRASE
          : invalidated
            ? "pass reason invalidated"
            : tierMove !== null
              ? `tier moved · ${tierMove}`
              : reason.label.toLowerCase(),
        storyColor: reason.fg,
        typeLabel: diverged ? "Divergence" : invalidated ? "Pass reason" : "Tier moved",
      });
    }

    for (const f of judgmentFirms) {
      items.push({
        key: `firm:${f.firmId}`,
        rank: 3,
        // /desk reads ?firmId and opens that firm's panel, so the click
        // lands on the work rather than near it.
        to: f.firmId ? `/desk?firmId=${encodeURIComponent(f.firmId)}` : "/desk",
        destination: "desk",
        rail: JUDGMENT_RAIL,
        name: f.firmName ?? "Unknown firm",
        story: `${f.axes} ${f.axes === 1 ? "axis" : "axes"} with no source`,
        storyColor: JUDGMENT_FG,
        typeLabel: "Judgment",
      });
    }

    for (const r of pendingRules) {
      const predicate = summarizePredicate(r.predicateAxis, r.ruleOperator, r.ruleThreshold);
      // Computed against the loaded firms with the same evaluator /rules and
      // the desk use — the server's projectedScreenCount is a draft-time
      // snapshot, and quoting it here would put a third number on a third
      // screen for the same rule.
      const screenRules = toScreeningRules(
        [
          {
            proposedRuleId: r.proposedRuleId,
            ruleStatus: "approved", // count what it WOULD screen
            predicateAxis: r.predicateAxis,
            ruleOperator: r.ruleOperator,
            ruleThreshold: r.ruleThreshold,
            ruleModel: r.ruleModel,
          },
        ],
        [],
      );
      // null = not computable here (text predicate), not "screens nobody".
      const projected =
        screenRules.length === 0 || !isEvaluable(screenRules[0])
          ? null
          : countScreened(firms as unknown as ScreenableFirm[], screenRules);
      items.push({
        key: `rule:${r.proposedRuleId}`,
        rank: 4,
        to: "/rules",
        destination: "rules",
        rail: RULE_RAIL,
        name: predicate ?? "malformed proposal",
        story:
          projected === null
            ? "projection not computed yet"
            : `would screen ${projected} firm${projected === 1 ? "" : "s"}`,
        storyColor: RULE_FG,
        typeLabel: "Rule",
      });
    }

    // Stable sort — within a rank the per-type order is already the one the
    // destination page uses (drifts detectedAt desc, firms by queue rank,
    // rules in query order).
    return items.sort((a, b) => a.rank - b.rank);
  }, [openDrifts, judgmentFirms, pendingRules, firmNameById, firms]);

  const visibleInbox = inbox.slice(0, VISIBLE_ROWS);
  // "+N more" points at whichever destination owns the most hidden rows.
  const overflowDestination = React.useMemo<Destination>(() => {
    const tally: Record<Destination, number> = { review: 0, desk: 0, rules: 0 };
    for (const item of inbox.slice(VISIBLE_ROWS)) {
      tally[item.destination] += 1;
    }
    return (Object.keys(tally) as Destination[]).reduce((best, k) =>
      tally[k] > tally[best] ? k : best,
    );
  }, [inbox]);

  const inboxLoading =
    (driftsLoading || rulesLoading || findingsLoading || firmsLoading || configsLoading) &&
    inbox.length === 0;

  // ── Mandate firm counts ────────────────────────────────────────────
  // Shared with /mandate — see mandateFirms.ts for why the union has three
  // legs. Both pages call this one function and print one string.
  const mandateCounts = React.useMemo(
    () =>
      mandateFirmCounts({
        searches: (searchData ?? []) as unknown as SearchLike[],
        memberships: (membershipData ?? []) as unknown as MembershipLike[],
        firms: firms as unknown as FirmLike[],
        searchLists: (searchListData ?? []) as unknown as SearchListLike[],
        searchListFirmIds: searchListFirmIds(searchListLinks.linkedObjectsBySourcePrimaryKey),
      }),
    [
      searchData,
      membershipData,
      firms,
      searchListData,
      searchListLinks.linkedObjectsBySourcePrimaryKey,
    ],
  );

  // A mandate with active === false is explicitly retired; null/undefined
  // predates the flag and still counts as active.
  const activeMandates = React.useMemo(
    () => mandates.filter((m) => m.active !== false),
    [mandates],
  );
  const countsLoading =
    searchesLoading ||
    membershipsLoading ||
    firmsLoading ||
    searchListsLoading ||
    searchListLinks.isLoading;

  // ── Funnel ─────────────────────────────────────────────────────────
  const bucketCounts = React.useMemo(() => {
    const c = emptyBucketCounts();
    for (const f of firms) {
      c[bucketOf(f, mirrorScore(toScoreInput(f)))] += 1;
    }
    return c;
  }, [firms]);

  // ── Trust ──────────────────────────────────────────────────────────
  const overall = React.useMemo(() => rates(findings), [findings]);
  const outcomes = React.useMemo(
    () => tallyOutcomes(firms as unknown as FirmOutcomeLike[]),
    [firms],
  );
  const trustReady = !findingsLoading && overall.decided >= INSUFFICIENT_THRESHOLD;

  const headline = inboxLoading
    ? "Reading the ontology…"
    : inbox.length === 0
      ? "Nothing needs you. Queue is clear."
      : `${inbox.length} thing${inbox.length === 1 ? "" : "s"} need${
          inbox.length === 1 ? "s" : ""
        } you · every number below opens where the work happens`;

  const anyError = firmsError ?? driftsError ?? rulesError ?? findingsError ?? mandatesError;

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
        <BrandMark section="Home" />
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
          <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.15, minWidth: 0 }}>
            <span style={{ fontWeight: 500, fontSize: 16 }}>Home</span>
            <span
              style={{
                fontSize: 11,
                color: "color-mix(in srgb, var(--color-text) 48%, transparent)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {headline}
            </span>
          </div>
        </header>

        {anyError && (
          <div
            style={{
              padding: "8px 24px",
              background: "rgba(207,112,112,.12)",
              color: "#e79191",
              fontSize: 12,
            }}
          >
            {String(anyError)}
          </div>
        )}

        <main
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "20px 26px 26px",
            display: "grid",
            // Operational spine ~62% · trust rail ~38%.
            gridTemplateColumns: "minmax(0, 1.63fr) minmax(0, 1fr)",
            gap: 24,
            // Sections keep their natural height — stretching them to fill
            // the viewport opens voids inside the panels, which reads far
            // worse than a page that simply ends. The rail is the one
            // exception: `stretch` makes it match the spine's height so the
            // two columns bottom-align and the causal line lands on the
            // page's floor.
            alignItems: "stretch",
            alignContent: "start",
            minWidth: 0,
          }}
        >
          {/* ── Left: operational spine ──────────────────────────── */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 24,
              minWidth: 0,
              minHeight: 0,
            }}
          >
            {/* Needs you — unified triage inbox */}
            <section style={{ minWidth: 0 }}>
              <SectionHead
                title={
                  <>
                    Needs you{" "}
                    <span
                      style={{ color: "color-mix(in srgb, var(--color-text) 70%, transparent)" }}
                    >
                      ({inboxLoading ? "…" : inbox.length})
                    </span>
                  </>
                }
                href="/review"
                linkLabel="Open review"
              />
              <div
                style={{
                  borderRadius: "var(--radius-md)",
                  border: "1px solid var(--color-divider)",
                  background: "var(--color-surface)",
                  overflow: "hidden",
                }}
              >
                {inboxLoading && (
                  <div
                    style={{
                      padding: 12,
                      fontSize: 12,
                      color: "color-mix(in srgb, var(--color-text) 48%, transparent)",
                    }}
                  >
                    Loading open work…
                  </div>
                )}

                {visibleInbox.map((item, i) => (
                  <InboxRow
                    key={item.key}
                    item={item}
                    last={i === visibleInbox.length - 1 && inbox.length <= VISIBLE_ROWS}
                  />
                ))}

                {inbox.length > VISIBLE_ROWS && (
                  <Link
                    to={DESTINATION_PATH[overflowDestination]}
                    className="home-row"
                    style={{
                      display: "block",
                      padding: "8px 13px",
                      fontSize: 12,
                      color: "var(--color-accent)",
                      textDecoration: "none",
                      borderTop: "1px solid var(--color-divider)",
                    }}
                  >
                    +{inbox.length - VISIBLE_ROWS} more →
                  </Link>
                )}

                {/* Zero-states: one quiet line per empty type, pinned to the
                    stack's foot so they read as a footnote to the work
                    above rather than competing with it. */}
                {!inboxLoading && (
                  <div>
                    {openDrifts.length === 0 && (
                      <QuietLine>No open review entries. No passed firm has moved.</QuietLine>
                    )}
                    {judgmentFirms.length === 0 && (
                      <QuietLine>No abstentions in the queue. Every axis has a source.</QuietLine>
                    )}
                    {pendingRules.length === 0 && (
                      <QuietLine>
                        No pending rules. A rule drafts itself after ~5 similar rejections.
                      </QuietLine>
                    )}
                  </div>
                )}
              </div>
            </section>

            {/* Active mandates */}
            <section style={{ minWidth: 0 }}>
              <SectionHead title="Active mandates" href="/mandate" linkLabel="All mandates" />
              <div
                style={{
                  borderRadius: "var(--radius-md)",
                  border: "1px solid var(--color-divider)",
                  background: "var(--color-surface)",
                  overflow: "hidden",
                }}
              >
                {mandatesLoading && activeMandates.length === 0 && (
                  <div
                    style={{
                      padding: 12,
                      fontSize: 12,
                      color: "color-mix(in srgb, var(--color-text) 48%, transparent)",
                      borderBottom: "1px solid var(--color-divider)",
                    }}
                  >
                    Loading mandates…
                  </div>
                )}
                {!mandatesLoading && activeMandates.length === 0 && (
                  <div
                    style={{
                      padding: 12,
                      fontSize: 12,
                      color: "color-mix(in srgb, var(--color-text) 52%, transparent)",
                      borderBottom: "1px solid var(--color-divider)",
                    }}
                  >
                    No active mandates. Nothing is feeding the queue.
                  </div>
                )}
                {activeMandates.map((m) => {
                  const c = mandateCounts.get(m.mandateId);
                  return (
                    <MandateRow
                      key={m.mandateId}
                      mandate={m}
                      scoped={c?.scoped ?? 0}
                      fromSearches={c?.fromSearches ?? 0}
                      loading={countsLoading && c === undefined}
                    />
                  );
                })}
                {/* Ghost row — the way a new mandate starts. */}
                <Link
                  to="/mandate"
                  className="home-row"
                  style={{
                    display: "block",
                    padding: 12,
                    fontSize: 12,
                    color: "color-mix(in srgb, var(--color-text) 50%, transparent)",
                    textDecoration: "none",
                  }}
                >
                  + New mandate →
                </Link>
              </div>
            </section>

            {/* Funnel */}
            <section style={{ minWidth: 0 }}>
              <SectionHead title="Pipeline" href="/pipeline" linkLabel="Open pipeline" />
              <FunnelStrip counts={bucketCounts} loading={firmsLoading && firms.length === 0} />
            </section>
          </div>

          {/* ── Right: trust rail ────────────────────────────────── */}
          <section style={{ minWidth: 0, display: "flex", flexDirection: "column" }}>
            <SectionHead title="Trust" href="/accuracy" linkLabel="Open accuracy" />
            <div
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                gap: 12,
                padding: 16,
                borderRadius: "var(--radius-md)",
                background: "var(--color-surface)",
                border: "1px solid var(--color-divider)",
                minHeight: 0,
              }}
            >
              {trustReady ? (
                <>
                  <Link
                    to="/accuracy"
                    style={{ textDecoration: "none", color: "inherit", display: "block" }}
                  >
                    <div style={{ fontSize: 21, fontWeight: 600, lineHeight: 1.2 }}>
                      Honest abstention rate:{" "}
                      <span style={{ color: "var(--color-accent)" }}>{overall.abstention}%</span>
                    </div>
                    <div
                      style={{
                        fontSize: 13,
                        lineHeight: 1.5,
                        color: "color-mix(in srgb, var(--color-text) 62%, transparent)",
                        marginTop: 4,
                      }}
                    >
                      When no source had it, Beacon said so instead of guessing.
                    </div>
                  </Link>

                  <Link
                    className="home-quiet-link"
                    to="/accuracy"
                    style={{
                      fontSize: 13,
                      display: "flex",
                      alignItems: "baseline",
                      gap: 8,
                      borderTop: "1px solid var(--color-divider)",
                      paddingTop: 12,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 16,
                        fontWeight: 600,
                        fontVariantNumeric: "tabular-nums",
                        color: "var(--color-text)",
                      }}
                    >
                      {overall.agreement ?? "—"}
                      {overall.agreement !== null && "%"}
                    </span>
                    <span>
                      agreement across {overall.decided} decided finding
                      {overall.decided === 1 ? "" : "s"}
                    </span>
                  </Link>
                </>
              ) : (
                <Link
                  to="/accuracy"
                  style={{ textDecoration: "none", color: "inherit", display: "block" }}
                >
                  <div style={{ fontSize: 16, fontWeight: 500, lineHeight: 1.3 }}>
                    Trust metrics appear after {INSUFFICIENT_THRESHOLD} decided findings
                  </div>
                  <div
                    style={{
                      fontSize: 13,
                      lineHeight: 1.5,
                      color: "color-mix(in srgb, var(--color-text) 62%, transparent)",
                      marginTop: 4,
                    }}
                  >
                    {findingsLoading
                      ? "Counting decided findings…"
                      : `${overall.decided} decided so far. Keep reviewing.`}
                  </div>
                </Link>
              )}

              <div style={{ borderTop: "1px solid var(--color-divider)", paddingTop: 12 }}>
                <Kicker style={{ marginBottom: 8 }}>Observed outcomes</Kicker>
                <Link
                  to="/accuracy"
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                    gap: 8,
                    textDecoration: "none",
                    color: "inherit",
                  }}
                >
                  {OUTCOME_SLOTS.filter((s): s is string => s !== null).map((slot) => (
                    <OutcomeCell
                      key={slot}
                      slot={slot}
                      count={outcomes.counts[slot] ?? 0}
                      loading={firmsLoading && firms.length === 0}
                    />
                  ))}
                </Link>
              </div>

              {/* The causal line — why any of the above matters. Pinned to
                  the rail's foot so the trust column reads top-down as
                  measurement → observation → consequence. */}
              {!firmsLoading && outcomes.passed > 0 && (
                <div
                  style={{
                    marginTop: "auto",
                    paddingTop: 12,
                    borderTop: "1px solid var(--color-divider)",
                    fontSize: 12,
                    lineHeight: 1.55,
                    color: "color-mix(in srgb, var(--color-text) 62%, transparent)",
                  }}
                >
                  Of firms we passed,{" "}
                  <strong style={{ color: DIVERGENCE_FG, fontWeight: 600 }}>
                    {outcomes.passedAndAcquired}
                  </strong>{" "}
                  {outcomes.passedAndAcquired === 1 ? "was" : "were"} later acquired.{" "}
                  <Link to="/review" style={{ color: "var(--color-accent)" }}>
                    The review loop exists to catch these →
                  </Link>
                </div>
              )}
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}

export default Home;
