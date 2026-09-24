import React from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useOsdkAction, useOsdkObjects } from "@/data/hooks";
import { Mandate, Search, runSearchAction } from "@/data/ontology";
import { type FacetGroup, INDUSTRY_GROUPS, PRODUCT_GROUPS, REGIONS } from "../../shared/taxonomy";
import { BrandMark, WorkspaceNavLinks } from "./nav";
import "./nocturne.css";
import { VOID_BG } from "./tokens";

// /search/:mandateId — where a mandate's intent sentence becomes a Search.
// The analyst's picks on this page ARE the interpretation of the mandate;
// no free-text at the top, no breadth knob at the bottom. Every Search
// runs exhaustively — the point of this page is to say "here's what the
// intent actually means in operational terms" and hand that to the agent.
//
// Structure mirrors the dashboard mock's facet-grid pattern:
//   • Category tiles (broad service line / sector group / region)
//   • Expand to sub-chips (specific service / sub-sector / country) when
//     the category is selected or any of its subs are
//   • Custom entry per grid for anything not in the preset taxonomy
//
// Cut vs. the mock: presets save/load, output-column config, artifacts,
// firm cap, model picker, breadth control, seed firms, exclusions.

// ─── Taxonomy ────────────────────────────────────────────────────────────
// Shared with the server's search matcher so a chip the analyst can pick is
// always a value the backend understands.

const GEO: readonly FacetGroup[] = REGIONS;
const PRODUCTS: readonly FacetGroup[] = PRODUCT_GROUPS;
const INDUSTRIES: readonly FacetGroup[] = INDUSTRY_GROUPS;

// ─── Small primitives ────────────────────────────────────────────────────

interface MandateShape {
  mandateId: string;
  title?: string | null;
  intentStatement?: string | null;
  archetype?: string | null;
  priority?: string | null;
}

interface SearchShape {
  searchId: string;
  mandateId?: string | null;
  runAt?: string | number | Date | null;
  resultCount?: number | null;
}

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

// Case-insensitive lookup used everywhere in the facet toggle logic.
function findIdx(values: readonly string[], label: string): number {
  const target = label.toLowerCase();
  for (let i = 0; i < values.length; i++) {
    if (values[i].toLowerCase() === target) {
      return i;
    }
  }
  return -1;
}

// ─── Facet picker (category tile → sub-chip expansion + custom) ──────────
// Mirrors search_dashboard.html's facetGroup(): clicking a category tile
// toggles the category AND cascades its subs (so children read as
// selected too — the dashboard's post-Phase-10 EXP-02 behavior). Subs
// stay independently toggleable. Custom entries are anything typed in
// that doesn't match a preset category or sub — they render as removable
// chips alongside the preset subs and never dedupe against them.

function FacetPicker({
  label,
  helper,
  groups,
  values,
  onChange,
  customPlaceholder,
  gridId,
}: {
  label: string;
  helper: string;
  groups: readonly FacetGroup[];
  values: readonly string[];
  onChange: (next: string[]) => void;
  customPlaceholder: string;
  gridId: string;
}): React.ReactElement {
  const has = (l: string): boolean => findIdx(values, l) !== -1;

  const toggleOne = (l: string): void => {
    const i = findIdx(values, l);
    if (i === -1) {
      onChange([...values, l]);
    } else {
      const next = values.slice();
      next.splice(i, 1);
      onChange(next);
    }
  };

  const toggleCategory = (g: FacetGroup): void => {
    if (has(g.label)) {
      // Deselect: drop the category AND any of its subs that no other
      // still-selected category also owns. "Oil and Gas" appears under
      // both Energy and Infrastructure — deselecting Energy shouldn't
      // clear it if Infrastructure is still selected.
      const next = values.filter((v) => {
        const vl = v.toLowerCase();
        if (vl === g.label.toLowerCase()) {
          return false;
        }
        const isOurSub = g.subs.some((s) => s.toLowerCase() === vl);
        if (!isOurSub) {
          return true;
        }
        const claimedByOther = groups.some(
          (og) =>
            og.label !== g.label && has(og.label) && og.subs.some((s) => s.toLowerCase() === vl),
        );
        return claimedByOther;
      });
      onChange(next);
    } else {
      const additions = [g.label, ...g.subs].filter((l) => !has(l));
      onChange([...values, ...additions]);
    }
  };

  // Custom entries = anything in `values` that isn't a known category
  // or sub. Rendered separately so the analyst can see what they added
  // beyond the preset taxonomy at a glance.
  const presetLabels = React.useMemo(() => {
    const s = new Set<string>();
    for (const g of groups) {
      s.add(g.label.toLowerCase());
      for (const sub of g.subs) {
        s.add(sub.toLowerCase());
      }
    }
    return s;
  }, [groups]);
  const customs = values.filter((v) => !presetLabels.has(v.toLowerCase()));

  const [draft, setDraft] = React.useState("");
  const submitCustom = (): void => {
    const t = draft.trim();
    if (t === "") {
      return;
    }
    if (has(t)) {
      setDraft("");
      return;
    }
    onChange([...values, t]);
    setDraft("");
  };

  const inputId = `${gridId}-custom-input`;

  return (
    <div>
      <div
        style={{
          fontSize: 13,
          fontWeight: 600,
          letterSpacing: "-0.005em",
          color: "color-mix(in srgb, var(--color-text) 92%, transparent)",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 12,
          color: "color-mix(in srgb, var(--color-text) 58%, transparent)",
          marginTop: 4,
          lineHeight: 1.45,
        }}
      >
        {helper}
      </div>

      <div
        role="group"
        aria-label={label}
        style={{
          marginTop: 12,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        {groups.map((g) => {
          const catSelected = has(g.label);
          const anySubSelected = g.subs.some((s) => has(s));
          const expanded = catSelected || anySubSelected;
          return (
            <div key={g.label} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <button
                type="button"
                aria-pressed={catSelected}
                onClick={() => toggleCategory(g)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 12px",
                  borderRadius: "var(--radius-md)",
                  border: `1px solid ${
                    catSelected ? "var(--color-accent)" : "var(--color-divider)"
                  }`,
                  background: catSelected
                    ? "color-mix(in srgb, var(--color-accent) 12%, transparent)"
                    : "var(--color-surface)",
                  color: catSelected ? "var(--color-accent)" : "inherit",
                  fontSize: 13,
                  fontWeight: 500,
                  font: "inherit",
                  cursor: "pointer",
                  textAlign: "left",
                  width: "100%",
                }}
              >
                <span style={{ flex: 1 }}>{g.label}</span>
                {g.subs.length > 0 && (
                  <span
                    style={{
                      fontSize: 11,
                      fontVariantNumeric: "tabular-nums",
                      color: "color-mix(in srgb, var(--color-text) 50%, transparent)",
                      fontWeight: 400,
                    }}
                    title={`${g.subs.length} sub-option${g.subs.length === 1 ? "" : "s"}`}
                  >
                    {g.subs.length}
                    <span aria-hidden="true" style={{ marginLeft: 4 }}>
                      {expanded ? "▾" : "▸"}
                    </span>
                  </span>
                )}
              </button>

              {expanded && g.subs.length > 0 && (
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 4,
                    paddingLeft: 12,
                    borderLeft: "1px solid var(--color-divider)",
                    marginLeft: 4,
                  }}
                >
                  {g.subs.map((s) => {
                    const on = has(s);
                    return (
                      <button
                        key={s}
                        type="button"
                        aria-pressed={on}
                        onClick={() => toggleOne(s)}
                        style={{
                          padding: "3px 9px",
                          fontSize: 12,
                          borderRadius: "var(--radius-pill)",
                          border: `1px solid ${
                            on ? "var(--color-accent)" : "var(--color-divider)"
                          }`,
                          background: on
                            ? "color-mix(in srgb, var(--color-accent) 15%, transparent)"
                            : "transparent",
                          color: on ? "var(--color-accent)" : "inherit",
                          cursor: "pointer",
                          font: "inherit",
                        }}
                      >
                        {s}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {customs.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div
            style={{
              fontSize: 11,
              color: "color-mix(in srgb, var(--color-text) 48%, transparent)",
              marginBottom: 4,
            }}
          >
            Custom
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {customs.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => toggleOne(c)}
                aria-label={`Remove ${c}`}
                title={`Remove ${c}`}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "3px 6px 3px 9px",
                  fontSize: 12,
                  borderRadius: "var(--radius-pill)",
                  border: "1px solid var(--color-accent)",
                  background: "color-mix(in srgb, var(--color-accent) 15%, transparent)",
                  color: "var(--color-accent)",
                  cursor: "pointer",
                  font: "inherit",
                }}
              >
                {c}
                <span
                  aria-hidden="true"
                  style={{
                    color: "color-mix(in srgb, var(--color-accent) 70%, transparent)",
                  }}
                >
                  ×
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 6, marginTop: 12 }}>
        <label htmlFor={inputId} className="sr-only" style={{ position: "absolute", left: -9999 }}>
          Add custom {label.toLowerCase()}
        </label>
        <input
          id={inputId}
          className="input"
          value={draft}
          placeholder={customPlaceholder}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submitCustom();
            }
          }}
          style={{ flex: 1, height: 32 }}
        />
        <button
          type="button"
          className="btn btn-secondary"
          style={{ fontSize: 12, padding: "3px 12px" }}
          onClick={submitCustom}
          disabled={draft.trim() === ""}
        >
          Add
        </button>
      </div>
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────

// Fixed breadth: every search runs exhaustively. Kept out of the UI on
// purpose — this page is the interpretation surface, not a knob farm.
const FIXED_BREADTH = "exhaustive";

function SearchPage(): React.ReactElement {
  const { mandateId } = useParams<{ mandateId: string }>();
  const navigate = useNavigate();
  const run = useOsdkAction(runSearchAction);

  const mandateQuery = useOsdkObjects(Mandate, {
    where: { mandateId: { $eq: mandateId ?? "" } },
    pageSize: 1,
  });
  const mandateData = (mandateQuery.data ?? []) as unknown as MandateShape[];
  const mandate = mandateData[0];
  const mandateInstance = (mandateQuery.data ?? [])[0];
  const headline =
    (mandate?.intentStatement ?? "").trim() ||
    (mandate?.title ?? "").trim() ||
    mandateId ||
    "Unknown mandate";

  // Post-submit: watch searches under this mandate; when one appears with
  // runAt >= the moment we submitted, route to the desk filtered on it.
  const { data: searchesData } = useOsdkObjects(Search, {
    where: { mandateId: { $eq: mandateId ?? "" } },
    orderBy: { runAt: "desc" },
    pageSize: 10,
  });
  const searches = React.useMemo(
    () => (searchesData ?? []) as unknown as SearchShape[],
    [searchesData],
  );
  const [runStartedAt, setRunStartedAt] = React.useState<number | null>(null);

  React.useEffect(() => {
    if (runStartedAt === null) {
      return;
    }
    const fresh = searches.find((s) => {
      const raw = s.runAt;
      if (raw === null || raw === undefined) {
        return false;
      }
      const ts = raw instanceof Date ? raw.getTime() : new Date(raw as string | number).getTime();
      return !Number.isNaN(ts) && ts >= runStartedAt;
    });
    if (fresh) {
      setRunStartedAt(null);
      navigate(`/desk?search=${encodeURIComponent(fresh.searchId)}`);
    }
  }, [runStartedAt, searches, navigate]);

  const [geographies, setGeographies] = React.useState<string[]>([]);
  const [products, setProducts] = React.useState<string[]>([]);
  const [industries, setIndustries] = React.useState<string[]>([]);

  const awaiting = runStartedAt !== null && run.error === undefined;
  const canRun = mandateInstance !== undefined && !run.isPending && !awaiting;

  // Products + Industries feed the SDK's single `industries` param. The
  // UI keeps them separate (they're distinct taxonomies — service
  // lines vs sector groups); the backend gets one merged list.
  const mergedIndustries = React.useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const v of [...products, ...industries]) {
      const k = v.trim().toLowerCase();
      if (k === "" || seen.has(k)) {
        continue;
      }
      seen.add(k);
      out.push(v);
    }
    return out;
  }, [products, industries]);

  const totalPicked = geographies.length + products.length + industries.length;

  const onRun = (): void => {
    if (mandateInstance === undefined) {
      return;
    }
    const startedAt = Date.now();
    setRunStartedAt(startedAt);
    void run
      .applyAction({
        mandate: mandateInstance,
        geographies: geographies.length > 0 ? geographies : undefined,
        industries: mergedIndustries.length > 0 ? mergedIndustries : undefined,
        // Seed firms and exclusions are no longer part of the analyst
        // surface — the interpretation is captured entirely by the
        // facet picks. Passing undefined so runSearchAction defaults them.
        seedFirms: undefined,
        exclusions: undefined,
        breadth: FIXED_BREADTH,
      } as never)
      .catch(() => {
        setRunStartedAt(null);
      });
  };

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
          <Link
            to="/mandate"
            style={{
              fontSize: 12,
              color: "var(--color-accent)",
              textDecoration: "none",
            }}
          >
            ← Mandates
          </Link>
          <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.15, minWidth: 0 }}>
            <span style={{ fontWeight: 500, fontSize: 16 }}>Interpret &amp; run search</span>
            <span
              style={{
                fontSize: 11,
                color: "color-mix(in srgb, var(--color-text) 48%, transparent)",
              }}
            >
              What the mandate&rsquo;s intent means, operationally: pick the regions and service /
              sector categories that qualify a firm.
            </span>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
            {mandate?.archetype && <span className="tag tag-outline">{mandate.archetype}</span>}
            {mandate?.priority && <span className="tag tag-neutral">{mandate.priority}</span>}
          </div>
        </header>

        <main
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "24px 26px 32px",
            display: "flex",
            flexDirection: "column",
            gap: 16,
            maxWidth: 880,
          }}
        >
          <div
            style={{
              padding: 16,
              border: "1px solid var(--color-divider)",
              borderRadius: "var(--radius-md)",
              background: "var(--color-surface)",
            }}
          >
            <Kicker>Mandate</Kicker>
            <div
              style={{
                fontSize: 16,
                fontWeight: 600,
                lineHeight: 1.35,
                marginTop: 4,
                overflowWrap: "anywhere",
                color: mandateQuery.isLoading
                  ? "color-mix(in srgb, var(--color-text) 45%, transparent)"
                  : "inherit",
              }}
            >
              {mandateQuery.isLoading ? "Loading mandate…" : headline}
            </div>
            <div
              style={{
                fontSize: 12,
                color: "color-mix(in srgb, var(--color-text) 58%, transparent)",
                marginTop: 8,
                lineHeight: 1.5,
              }}
            >
              The tiles below are how you translate that sentence into an operational filter: pick
              the geographies, service lines, and sector groups that qualify a firm. Broad
              categories cascade to their sub-options; deselect any you don&rsquo;t want.
            </div>
          </div>

          <section
            style={{
              padding: 16,
              border: "1px solid var(--color-divider)",
              borderRadius: "var(--radius-md)",
              background: "var(--color-surface)",
            }}
          >
            <FacetPicker
              gridId="search-geography"
              label="Geography"
              helper="Regions or specific countries / cities the mandate targets. Blank = no geographic filter."
              groups={GEO}
              values={geographies}
              onChange={setGeographies}
              customPlaceholder="Add another country or region, then press Enter"
            />
          </section>

          <section
            style={{
              padding: 16,
              border: "1px solid var(--color-divider)",
              borderRadius: "var(--radius-md)",
              background: "var(--color-surface)",
            }}
          >
            <FacetPicker
              gridId="search-products"
              label="Products / service lines"
              helper="Which service lines the target firm should offer."
              groups={PRODUCTS}
              values={products}
              onChange={setProducts}
              customPlaceholder="Add another product / service, then press Enter"
            />
          </section>

          <section
            style={{
              padding: 16,
              border: "1px solid var(--color-divider)",
              borderRadius: "var(--radius-md)",
              background: "var(--color-surface)",
            }}
          >
            <FacetPicker
              gridId="search-industries"
              label="Industries / sectors"
              helper="Which sector groups the target firm should cover. Adds are always allowed."
              groups={INDUSTRIES}
              values={industries}
              onChange={setIndustries}
              customPlaceholder="Add another industry, then press Enter"
            />
          </section>

          {run.error !== undefined && (
            <div
              role="alert"
              style={{
                padding: "10px 14px",
                borderRadius: "var(--radius-md)",
                background: "rgba(207,112,112,.12)",
                color: "#e79191",
                fontSize: 12,
              }}
            >
              Search failed: {String(run.error)}. Your selections are preserved.
            </div>
          )}

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <button
              className="btn btn-primary"
              disabled={!canRun}
              onClick={onRun}
              style={{ fontSize: 14, padding: "8px 16px" }}
            >
              {run.isPending ? "Running search…" : awaiting ? "Assembling universe…" : "Run search"}
            </button>
            <span
              style={{
                fontSize: 12,
                color: "color-mix(in srgb, var(--color-text) 60%, transparent)",
              }}
            >
              {awaiting
                ? "Attaching existing firms and creating new ones with discovery provenance. Routing to the desk when the search lands."
                : totalPicked === 0
                  ? "No filters picked. The search will cast the widest possible net."
                  : `${totalPicked} filter${totalPicked === 1 ? "" : "s"} across geography, products, and industries.`}
            </span>
          </div>
        </main>
      </div>
    </div>
  );
}

export default SearchPage;
