import React from "react";
import { Link, useLocation } from "react-router-dom";

// Canonical workspace nav — one definition, imported by every screen shell.
interface WorkspaceNavItem {
  to: string;
  label: string;
}

const WORKSPACE_NAV: WorkspaceNavItem[] = [
  { to: "/", label: "Home" },
  { to: "/desk", label: "Enrichment desk" },
  { to: "/pipeline", label: "Pipeline" },
  { to: "/review", label: "Review" },
  { to: "/rules", label: "Rules" },
  { to: "/accuracy", label: "Accuracy" },
  { to: "/mandate", label: "Mandates" },
];

/**
 * Sidebar identity block.
 *
 * The sidebar reads as three distinct levels, largest to smallest:
 *
 *   1. Beacon        19px / 600 / tight tracking — the brand, unmistakably
 *                    the biggest thing in the rail
 *   2. WORKSPACE     10px uppercase, wide tracking, heavily muted — a
 *                    section label (rendered by WorkspaceNavLinks)
 *   3. Enrichment    13px nav items
 *
 * Previously the wordmark was 15px/600 against 13px/400 nav items — barely
 * a step — and the page-name subline sat close enough in weight to the
 * wordmark that the two competed instead of one annotating the other. The
 * subline is now the smallest, faintest thing in the block, and the "B"
 * mark is scaled to the taller wordmark so it reads as a lockup rather
 * than two unrelated elements.
 */
export function BrandMark({ section }: { section: string }): React.ReactElement {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "0 4px" }}>
      <span
        aria-hidden="true"
        style={{
          width: 34,
          height: 34,
          flex: "none",
          borderRadius: "var(--radius-md)",
          // Filled rather than outlined — at this size a hairline border
          // alone left the mark lighter than the wordmark beside it.
          background: "color-mix(in srgb, var(--color-accent) 16%, transparent)",
          border: "1px solid color-mix(in srgb, var(--color-accent) 45%, transparent)",
          display: "grid",
          placeItems: "center",
          color: "var(--color-accent-200)",
          fontSize: 16,
          fontWeight: 600,
          letterSpacing: "-0.02em",
          lineHeight: 1,
        }}
      >
        B
      </span>
      <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
        <span
          style={{
            fontWeight: 600,
            fontSize: 19,
            letterSpacing: "-0.02em",
            lineHeight: 1.05,
            color: "var(--color-text)",
          }}
        >
          Beacon
        </span>
        <span
          style={{
            fontSize: 10,
            fontWeight: 500,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            lineHeight: 1.2,
            marginTop: 4,
            color: "color-mix(in srgb, var(--color-text) 38%, transparent)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {section}
        </span>
      </span>
    </div>
  );
}

/**
 * Nav link list, including its own "Workspace" section label.
 *
 * The label used to be a separate <Kicker> repeated in all eight shells,
 * which meant the gap between brand and section was whatever each shell's
 * flex gap happened to be. Owning it here lets the whole block set its own
 * rhythm: generous space above the divider, tight space between the label
 * and the items it introduces.
 *
 * Current path is prefix-matched, with "/" matching exactly so Home stays
 * distinct from every other route.
 */
export function WorkspaceNavLinks(): React.ReactElement {
  const location = useLocation();
  const pathname = location.pathname;
  return (
    <nav
      style={{
        display: "flex",
        flexDirection: "column",
        marginTop: 8,
        paddingTop: 16,
        borderTop: "1px solid var(--color-divider)",
      }}
    >
      <div
        style={{
          fontSize: 10,
          fontWeight: 500,
          letterSpacing: "0.15em",
          textTransform: "uppercase",
          color: "color-mix(in srgb, var(--color-text) 38%, transparent)",
          padding: "0 12px",
          marginBottom: 8,
        }}
      >
        Workspace
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {WORKSPACE_NAV.map((n) => {
          const current = n.to === "/" ? pathname === "/" : pathname.startsWith(n.to);
          return (
            <Link
              key={n.to}
              to={n.to}
              className="nav-item"
              aria-current={current ? "page" : undefined}
              style={{
                position: "relative",
                display: "block",
                padding: "9px 10px 9px 12px",
                borderRadius: "var(--radius-md)",
                fontSize: 13,
                lineHeight: 1.3,
                fontWeight: current ? 500 : 400,
                color: current
                  ? "var(--color-accent-100)"
                  : "color-mix(in srgb, var(--color-text) 62%, transparent)",
                textDecoration: "none",
                background: current
                  ? "color-mix(in srgb, var(--color-accent) 16%, transparent)"
                  : "transparent",
              }}
            >
              {/* Left rail — carries the active state at a glance even when
                  the filled background is subtle on a dark surface. */}
              {current && (
                <span
                  aria-hidden="true"
                  style={{
                    position: "absolute",
                    left: 0,
                    top: 6,
                    bottom: 6,
                    width: 3,
                    borderRadius: "0 2px 2px 0",
                    background: "var(--color-accent)",
                  }}
                />
              )}
              {n.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
