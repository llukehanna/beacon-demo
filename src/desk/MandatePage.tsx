import React from "react";
import { Link } from "react-router-dom";
import { useLinks, useOsdkAction, useOsdkObjects } from "@/data/hooks";
import {
  Firm,
  Mandate,
  Search,
  SearchList,
  SearchMembership,
  runMandateSearchAction,
} from "@/data/ontology";
import { Segmented } from "./Segmented";
// Shared with Home so both pages print one number, from one union. The
// per-search rows below still show their own list's count; the mandate-level
// line is the figure Home shows.
import {
  EMPTY_COUNTS,
  type FirmLike,
  type MandateFirmCounts,
  type MembershipLike,
  type SearchLike,
  formatMandateFirmCounts,
  mandateFirmCounts,
  searchListFirmIds,
} from "./mandateFirms";
import { BrandMark, WorkspaceNavLinks } from "./nav";
import "./nocturne.css";
import { VOID_BG } from "./tokens";

// ─── Small primitives (match the other Nocturne screens) ────────────────

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

const ARCHETYPES = ["CF", "CS"] as const;
const PRIORITIES = ["High", "Medium", "Low"] as const;

// ─── Firm-count row for a single SearchList ─────────────────────────────
// Membership is queried via the many-to-many searchLists↔firms link — the
// SearchList.resultCount property is a stale snapshot from creation time.
// We fetch just `firmId` for each linked firm to keep the payload minimal.
const FIRM_COUNT_PAGE_SIZE = 500;

function SearchListRow({
  searchInstance,
  searchId,
  displayName,
}: {
  // The actual WireObject from useOsdkObjects(SearchList) — useLinks needs
  // this (not a POJO clone) to traverse the many-to-many searchLists↔firms
  // link and populate linkedObjectsBySourcePrimaryKey by primary key.
  searchInstance: unknown;
  searchId: string;
  displayName: string;
}): React.ReactElement {
  const { linkedObjectsBySourcePrimaryKey, hasMore, isLoading, error } = useLinks(
    searchInstance as never,
    "firms",
    { pageSize: FIRM_COUNT_PAGE_SIZE, $select: ["firmId"] as never },
  );
  const firms = linkedObjectsBySourcePrimaryKey.get(searchId);
  const count = firms?.length ?? 0;
  const countLabel =
    error !== undefined
      ? "?"
      : isLoading && firms === undefined
        ? "…"
        : hasMore
          ? `${count}+`
          : `${count}`;

  return (
    <div
      className="card"
      style={{
        border: "1px solid var(--color-divider)",
        boxShadow: "none",
        gap: 6,
      }}
    >
      <div style={{ fontSize: 14, fontWeight: 600 }}>{displayName}</div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          fontSize: 12,
          color: "color-mix(in srgb, var(--color-text) 55%, transparent)",
        }}
      >
        {/* Per-list count, distinct from the mandate-level "N scoped" line on
            the card above — naming the level stops the two being read as a
            contradiction. */}
        <span
          style={{ fontVariantNumeric: "tabular-nums" }}
          title="Firms linked to this search list. The mandate's scoped total also counts firms its searches attached or created."
        >
          {countLabel} in this list
        </span>
        <Link
          to="/desk"
          style={{
            marginLeft: "auto",
            fontSize: 12,
            color: "var(--color-accent)",
            textDecoration: "none",
          }}
        >
          Work in desk →
        </Link>
      </div>
    </div>
  );
}

// ─── Mandate card grouping ──────────────────────────────────────────────

interface MandateLike {
  mandateId: string;
  title?: string | null;
  archetype?: string | null;
  priority?: string | null;
  // Primary field per the new contract; may be null on legacy mandates
  // where only `title` was set — MandateCard falls back to title in that
  // case so pre-migration mandates still headline correctly.
  intentStatement?: string | null;
  // Deprecated on the mandate — kept on the type so legacy rows don't
  // trip the widened cast, but no longer rendered or written from here.
  geographies?: readonly string[] | null;
  sizeMaxUsdM?: number | null;
}

interface SearchListLike {
  searchId: string;
  name?: string | null;
  mandateId?: string | null;
}

function MandateCard({
  mandate,
  searches,
  counts,
  countsLoading,
}: {
  mandate: MandateLike;
  searches: SearchListLike[];
  // The mandate-level union, identical to Home's. The per-search rows below
  // count one list each; this counts the mandate.
  counts: MandateFirmCounts;
  countsLoading: boolean;
}): React.ReactElement {
  // Intent statement is the new primary headline; legacy mandates fall
  // back to their title. mandateId is the last resort so a malformed row
  // still renders a stable anchor rather than "undefined".
  const headline =
    (mandate.intentStatement ?? "").trim() || (mandate.title ?? "").trim() || mandate.mandateId;
  return (
    <div
      className="card"
      style={{
        background: "var(--color-surface)",
        boxShadow: "var(--shadow-sm)",
        gap: 12,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div
          style={{
            fontSize: 16,
            fontWeight: 600,
            flex: "1 1 260px",
            minWidth: 0,
            lineHeight: 1.35,
            overflowWrap: "anywhere",
          }}
        >
          {headline}
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {mandate.archetype && <span className="tag tag-outline">{mandate.archetype}</span>}
          {mandate.priority && <span className="tag tag-neutral">{mandate.priority}</span>}
        </div>
      </div>

      {/* Same union, same wording as Home's mandate row. */}
      <div
        style={{
          fontSize: 12,
          fontVariantNumeric: "tabular-nums",
          color: "color-mix(in srgb, var(--color-text) 55%, transparent)",
        }}
        title="Scoped = every firm in this mandate's lists and searches. From searches = the subset a Search run attached."
      >
        {countsLoading ? "…" : formatMandateFirmCounts(counts)}
      </div>

      <div>
        <Link
          to={`/search/${encodeURIComponent(mandate.mandateId)}`}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: 13,
            color: "var(--color-accent)",
            textDecoration: "none",
            padding: "4px 0",
          }}
          title="Turn this intent sentence into a Search: pick geographies / seeds / breadth on the next screen"
        >
          Interpret &amp; run search →
        </Link>
      </div>

      {searches.length === 0 ? (
        <div
          style={{
            fontSize: 12,
            color: "color-mix(in srgb, var(--color-text) 50%, transparent)",
            padding: "6px 0",
          }}
        >
          No searches yet for this mandate.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {searches.map((s) => (
            <SearchListRow
              key={s.searchId}
              searchInstance={s}
              searchId={s.searchId}
              displayName={s.name ?? s.searchId}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── The form (left column) ─────────────────────────────────────────────

function NewMandateForm(): React.ReactElement {
  const run = useOsdkAction(runMandateSearchAction);
  const [intent, setIntent] = React.useState("");
  const [archetype, setArchetype] = React.useState<(typeof ARCHETYPES)[number]>("CF");
  const [priority, setPriority] = React.useState<(typeof PRIORITIES)[number]>("High");

  const canSubmit = intent.trim() !== "" && !run.isPending;

  const onRun = (): void => {
    // runMandateSearchAction doesn't yet accept intentStatement — we pass the
    // sentence as `title` (the only free-text create param) so the mandate
    // records something meaningful. MandateCard reads `intentStatement ??
    // title`, so once the backend action grows the param, swapping this
    // one call over is a two-line change. Geography and max-size are
    // deprecated on the mandate and intentionally not written.
    void run
      .applyAction({
        title: intent.trim(),
        archetype,
        priority,
      } as never)
      .then(() => setIntent(""));
  };

  return (
    <div
      className="card"
      style={{
        background: "var(--color-surface)",
        boxShadow: "var(--shadow-sm)",
        gap: 12,
        padding: 16,
      }}
    >
      <Kicker>New mandate</Kicker>

      <div>
        <label
          htmlFor="mandate-intent"
          style={{
            display: "block",
            fontSize: 12,
            color: "color-mix(in srgb, var(--color-text) 70%, transparent)",
            marginBottom: 4,
          }}
        >
          Intent statement
        </label>
        <textarea
          id="mandate-intent"
          className="input"
          value={intent}
          onChange={(e) => setIntent(e.target.value)}
          placeholder="e.g. European firms with a specialty in capital solutions"
          rows={3}
          style={{ lineHeight: 1.4, resize: "vertical", minHeight: 72 }}
        />
        <div
          style={{
            fontSize: 11,
            color: "color-mix(in srgb, var(--color-text) 48%, transparent)",
            marginTop: 4,
            lineHeight: 1.4,
          }}
        >
          Geography, size, and other filters live on the Search. Set them via Interpret &amp; run
          search after creating the mandate.
        </div>
      </div>

      <div>
        <div
          id="mandate-archetype-label"
          style={{
            fontSize: 12,
            color: "color-mix(in srgb, var(--color-text) 70%, transparent)",
            marginBottom: 4,
          }}
        >
          Archetype
        </div>
        <Segmented<(typeof ARCHETYPES)[number]>
          block
          ariaLabelledBy="mandate-archetype-label"
          options={ARCHETYPES.map((a) => ({ label: a, value: a }))}
          value={archetype}
          onChange={setArchetype}
        />
      </div>

      <div>
        <div
          id="mandate-priority-label"
          style={{
            fontSize: 12,
            color: "color-mix(in srgb, var(--color-text) 70%, transparent)",
            marginBottom: 4,
          }}
        >
          Priority
        </div>
        <Segmented<(typeof PRIORITIES)[number]>
          block
          ariaLabelledBy="mandate-priority-label"
          options={PRIORITIES.map((p) => ({ label: p, value: p }))}
          value={priority}
          onChange={setPriority}
        />
      </div>

      {run.error !== undefined && (
        <div
          style={{
            padding: "8px 12px",
            borderRadius: "var(--radius-md)",
            background: "rgba(207,112,112,.12)",
            color: "#e79191",
            fontSize: 12,
          }}
        >
          {String(run.error)}
        </div>
      )}

      <button
        className="btn btn-primary"
        style={{ marginTop: 4 }}
        disabled={!canSubmit}
        onClick={onRun}
      >
        {run.isPending ? "Creating mandate…" : "Create mandate"}
      </button>
    </div>
  );
}

// ─── Root ───────────────────────────────────────────────────────────────

function MandatePage(): React.ReactElement {
  const {
    data: mandateData,
    isLoading: mandatesLoading,
    error: mandatesError,
  } = useOsdkObjects(Mandate, {
    pageSize: 100,
    orderBy: { createdAt: "desc" },
    autoFetchMore: true,
  });
  const { data: searchData, error: searchError } = useOsdkObjects(SearchList, {
    pageSize: 200,
    orderBy: { createdAt: "desc" },
    autoFetchMore: true,
  });

  // The other two legs of the scoped union. /mandate previously counted only
  // the SearchList↔firms link, which is why it read "285 firms" against
  // Home's "317 scoped" for the same mandate.
  const { data: searchObjData } = useOsdkObjects(Search, {
    pageSize: 200,
    autoFetchMore: true,
  });
  const { data: membershipData } = useOsdkObjects(SearchMembership, {
    pageSize: 1000,
    autoFetchMore: true,
  });
  const { data: firmData } = useOsdkObjects(Firm, {
    pageSize: 300,
    autoFetchMore: true,
  });

  const mandates = React.useMemo(
    () => (mandateData ?? []) as unknown as MandateLike[],
    [mandateData],
  );
  const searchLists = React.useMemo(
    () => (searchData ?? []) as unknown as SearchListLike[],
    [searchData],
  );

  // One batched traversal of SearchList↔firms for the mandate-level union,
  // alongside the per-row useLinks that renders each list's own count.
  const searchListInstances = React.useMemo(() => (searchData ?? []) as never[], [searchData]);
  const searchListLinks = useLinks(searchListInstances, "firms", {
    pageSize: FIRM_COUNT_PAGE_SIZE,
    $select: ["firmId"] as never,
  });

  const countsByMandate = React.useMemo(
    () =>
      mandateFirmCounts({
        searches: (searchObjData ?? []) as unknown as SearchLike[],
        memberships: (membershipData ?? []) as unknown as MembershipLike[],
        firms: (firmData ?? []) as unknown as FirmLike[],
        searchLists: (searchData ?? []) as unknown as SearchListLike[],
        searchListFirmIds: searchListFirmIds(searchListLinks.linkedObjectsBySourcePrimaryKey),
      }),
    [
      searchObjData,
      membershipData,
      firmData,
      searchData,
      searchListLinks.linkedObjectsBySourcePrimaryKey,
    ],
  );

  const searchesByMandate = React.useMemo(() => {
    const m = new Map<string, SearchListLike[]>();
    for (const s of searchLists) {
      const mid = s.mandateId ?? "";
      if (mid === "") {
        continue;
      }
      const arr = m.get(mid) ?? [];
      arr.push(s);
      m.set(mid, arr);
    }
    return m;
  }, [searchLists]);

  const orphans = React.useMemo(
    () =>
      searchLists.filter((s) => {
        const mid = s.mandateId ?? "";
        return mid === "" || !mandates.some((m) => m.mandateId === mid);
      }),
    [searchLists, mandates],
  );

  const anyError = mandatesError ?? searchError;

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
        <BrandMark section="Mandates" />
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
            <span style={{ fontWeight: 500, fontSize: 16 }}>Mandates</span>
            <span
              style={{
                fontSize: 11,
                color: "color-mix(in srgb, var(--color-text) 48%, transparent)",
              }}
            >
              Leadership sets a mandate as a free-text intent; each mandate spawns one or more
              Searches that assemble the candidate universe.
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
            padding: "24px 24px 32px",
            display: "grid",
            gridTemplateColumns: "minmax(320px, 360px) 1fr",
            gap: 24,
            alignItems: "start",
          }}
        >
          <NewMandateForm />

          <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
            {mandatesLoading && mandates.length === 0 && (
              <div
                style={{
                  padding: 16,
                  border: "1px dashed var(--color-divider)",
                  borderRadius: "var(--radius-md)",
                  fontSize: 13,
                  color: "color-mix(in srgb, var(--color-text) 55%, transparent)",
                }}
              >
                Loading mandates…
              </div>
            )}

            {!mandatesLoading && mandates.length === 0 && (
              <div
                style={{
                  padding: "24px 20px",
                  border: "1px dashed var(--color-divider)",
                  borderRadius: "var(--radius-md)",
                  fontSize: 13,
                  color: "color-mix(in srgb, var(--color-text) 60%, transparent)",
                  textAlign: "center",
                }}
              >
                No mandates yet. Use the form on the left to scope one.
              </div>
            )}

            {mandates.map((m) => (
              <MandateCard
                key={m.mandateId}
                mandate={m}
                searches={searchesByMandate.get(m.mandateId) ?? []}
                counts={countsByMandate.get(m.mandateId) ?? EMPTY_COUNTS}
                countsLoading={searchListLinks.isLoading && countsByMandate.size === 0}
              />
            ))}

            {orphans.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <Kicker>Unattached searches</Kicker>
                {orphans.map((s) => (
                  <SearchListRow
                    key={s.searchId}
                    searchInstance={s}
                    searchId={s.searchId}
                    displayName={s.name ?? s.searchId}
                  />
                ))}
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

export default MandatePage;
