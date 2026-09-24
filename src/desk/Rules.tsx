import React from "react";
import { useOsdkAction, useOsdkObjects } from "@/data/hooks";
import {
  Firm,
  HardScreenConfig,
  ProposedRule,
  ReviewDecision,
  amendRuleThresholdAction,
  approveRuleAction,
  dismissRuleAction,
  unapproveRuleAction,
} from "@/data/ontology";
import { ProposeRulesButton } from "./ProposeRulesButton";
// Shared with the desk so a rule's screen count on this card and the desk's
// "N screened by approved rules" are the same arithmetic over the same firms.
import {
  type ScreenableFirm,
  countScreened,
  isEvaluable,
  toScreeningRules,
} from "./activeScreening";
import { BrandMark, WorkspaceNavLinks } from "./nav";
import "./nocturne.css";
// Shared with Home's pending-rules card so both surfaces print the same
// predicate string.
import { summarizePredicate } from "./rulePredicate";
import { repairTruncatedText } from "./ruleText";
import { VOID_BG } from "./tokens";

// ─── Status chip ────────────────────────────────────────────────────────

const RULE_STATUS_CHIP: Record<string, { label: string; fg: string; bg: string }> = {
  pending: { label: "Pending", fg: "#8ec1ee", bg: "rgba(74,144,217,.16)" },
  approved: { label: "Approved", fg: "#8fe3c0", bg: "rgba(87,185,138,.16)" },
  dismissed: { label: "Dismissed", fg: "#e79191", bg: "rgba(207,112,112,.18)" },
};

function statusChip(raw: string | undefined): { label: string; fg: string; bg: string } {
  const key = (raw ?? "pending").toLowerCase();
  return (
    RULE_STATUS_CHIP[key] ?? {
      label: raw ?? "unknown",
      fg: "color-mix(in srgb, var(--color-text) 62%, transparent)",
      bg: "var(--color-neutral-800)",
    }
  );
}

// ─── Decider display ────────────────────────────────────────────────────
// ruleDecidedBy was backfilled with raw user UUIDs (e.g. e7496a93-…). A
// UUID rendered in prose reads as garbage — same anti-pattern we already
// fixed on the decision-memory strip. Since Beacon is a single-analyst
// tool right now, any decider we can't resolve to a display name is
// "you" from the analyst's perspective; we treat UUID-shaped strings
// (and empty strings) as unresolvable and collapse them to "you".
const UUID_LIKE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function displayDecider(raw: string | null | undefined): string {
  const s = (raw ?? "").trim();
  if (s === "" || UUID_LIKE.test(s)) {
    return "you";
  }
  return s;
}

// ─── Predicate rendering ────────────────────────────────────────────────
// Build a human-readable, code-styled predicate from axis + operator +
// threshold. Returns null when the rule is missing any predicate component
// entirely — the card then renders a "malformed proposal" placeholder
// instead of "? ? \"?\"" so the FDE can still spot and delete the row.

// Word-boundary truncation for predicate strings. Rewinds a hard char cap
// to the last space or separator inside a snake_case token so the tail
// reads cleanly ("geographic_footprint ==…" instead of "geographic
// footpri"). The full text stays available via the title tooltip on the
// <code> element.
function truncatePredicateAtWord(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) {
    return trimmed;
  }
  const clipped = trimmed.slice(0, max);
  // Prefer a real space (between axis / operator / threshold), fall back
  // to an underscore or hyphen inside a snake_case token when no space
  // is close enough to the cut.
  const lastSep = Math.max(
    clipped.lastIndexOf(" "),
    clipped.lastIndexOf("_"),
    clipped.lastIndexOf("-"),
  );
  const cut = lastSep > max * 0.5 ? clipped.slice(0, lastSep) : clipped;
  return cut.trimEnd() + "…";
}

function renderPredicate(rule: RuleLike): string | null {
  const axis = (rule.predicateAxis ?? "").trim();
  const op = (rule.ruleOperator ?? "").trim();
  const threshold = (rule.ruleThreshold ?? "").trim();
  if (axis === "" || op === "" || threshold === "") {
    return null;
  }
  const thresholdStr = /^-?\d+(\.\d+)?$/.test(threshold) ? threshold : `"${threshold}"`;
  return `${axis} ${op} ${thresholdStr}`;
}

// ─── Supporting-decision → firm name lookup ─────────────────────────────

function parseSupportingIds(raw: string | null | undefined): string[] {
  if (raw === null || raw === undefined || raw === "") {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.filter((x): x is string => typeof x === "string");
    }
  } catch {
    // fall through
  }
  // Tolerate comma-separated fallback.
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

interface RuleLike {
  proposedRuleId: string;
  mandateScope?: string;
  predicateAxis?: string;
  projectedScreenCount?: number;
  rationaleClusterSummary?: string;
  ruleDecidedAt?: unknown;
  ruleDecidedBy?: string;
  ruleModel?: string;
  ruleOperator?: string;
  ruleStatus?: string;
  ruleThreshold?: string;
  supportingDecisionIds?: string;
  supportingFirmCount?: number;
}

interface DecisionLike {
  decisionId: string;
  firmId?: string;
}

// One HardScreenConfig row is one rule VERSION. Amending a threshold
// deactivates the current row and inserts a new one with configVersion+1;
// unapproving deactivates all rows for that proposedRule. The rule card
// wants: the latest ACTIVE version (source of the effective predicate)
// and the full ordered list (for the one-line history).
interface ConfigLike {
  configRuleId: string;
  sourceProposedRuleId?: string;
  configVersion?: number;
  configActive?: boolean;
  configAxis?: string;
  configOperator?: string;
  configThreshold?: string;
  configAuthor?: string;
  configCreatedAt?: unknown;
}

interface RuleVersions {
  // Sorted ascending by configVersion so history reads v1 → v2 → v3.
  all: ConfigLike[];
  // Highest configVersion with configActive === true, or null if all
  // versions are inactive (which happens after an unapprove).
  activeLatest: ConfigLike | null;
}

// ─── Rule card ──────────────────────────────────────────────────────────

function RuleCard({
  rule,
  basisFirmNames,
  versions,
  firms,
}: {
  rule: RuleLike;
  basisFirmNames: string[];
  // Empty array while HardScreenConfig loads, or when the rule was never
  // approved. Approved rules always have at least one entry.
  versions: RuleVersions;
  // The same Firm set the desk queues. The screen count below is
  // computed from it rather than read off the server's static
  // projectedScreenCount, so this card and the desk header cannot report
  // different numbers for the same rule.
  firms: readonly ScreenableFirm[];
}): React.ReactElement {
  const approve = useOsdkAction(approveRuleAction);
  const dismiss = useOsdkAction(dismissRuleAction);
  const amend = useOsdkAction(amendRuleThresholdAction);
  const unapprove = useOsdkAction(unapproveRuleAction);
  const [expanded, setExpanded] = React.useState(false);
  const [dismissOpen, setDismissOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [amendOpen, setAmendOpen] = React.useState(false);
  const [newThreshold, setNewThreshold] = React.useState("");
  const [unapproveOpen, setUnapproveOpen] = React.useState(false);
  // Move focus into the amend input when the analyst opens it, without
  // using the autoFocus prop (jsx-a11y bans it — it can hijack focus in
  // ways screen readers don't expect).
  const amendInputRef = React.useRef<HTMLInputElement | null>(null);
  React.useEffect(() => {
    if (amendOpen) {
      amendInputRef.current?.focus();
    }
  }, [amendOpen]);

  const status = (rule.ruleStatus ?? "pending").toLowerCase();
  const chip = statusChip(status);
  const pending = status === "pending";
  const approved = status === "approved";
  const dismissed = status === "dismissed";

  const supporting = parseSupportingIds(rule.supportingDecisionIds);
  const basisCount = rule.supportingFirmCount ?? supporting.length;

  // For approved rules, the analyst-facing predicate is whatever the
  // latest ACTIVE HardScreenConfig row says — that's what the engine is
  // actually screening on. Fall back to the ProposedRule fields when we
  // don't have any config rows yet (approve just landed, HSC query still
  // loading, etc.) so the card doesn't briefly render blank.
  const effective = versions.activeLatest;
  const effectivePredicate =
    (effective &&
      summarizePredicate(
        effective.configAxis,
        effective.configOperator,
        effective.configThreshold,
      )) ??
    summarizePredicate(rule.predicateAxis, rule.ruleOperator, rule.ruleThreshold);

  // How many firms this rule takes off the desk — computed live from the
  // same firm set and the same evaluator the desk partitions on, at the
  // rule's EFFECTIVE predicate. The server's projectedScreenCount is a
  // snapshot from when the rule was drafted; trusting it is what let this
  // card claim "would screen 160 firms" while the desk read "711 of 711".
  const screenRules = React.useMemo(
    () =>
      toScreeningRules(
        [
          {
            proposedRuleId: rule.proposedRuleId,
            // Force-approved: we want the count for what this predicate
            // WOULD do, whether the analyst has approved it yet or not.
            ruleStatus: "approved",
            predicateAxis: effective?.configAxis ?? rule.predicateAxis,
            ruleOperator: effective?.configOperator ?? rule.ruleOperator,
            ruleThreshold: effective?.configThreshold ?? rule.ruleThreshold,
            ruleModel: rule.ruleModel,
          },
        ],
        // Effective predicate already resolved above — no overlay needed.
        [],
      ),
    [rule, effective],
  );
  // null means "we can't count this here", never "zero firms" — a string
  // predicate like `services_fit contains "..."` is screened server-side and
  // printing 0 for it would understate a live rule.
  const projected =
    screenRules.length === 0 || !isEvaluable(screenRules[0])
      ? null
      : countScreened(firms, screenRules);
  const projectionUnavailable = screenRules.length > 0 && !isEvaluable(screenRules[0]);

  const currentVersion =
    effective?.configVersion ??
    (versions.all.length > 0 ? versions.all[versions.all.length - 1].configVersion : undefined);
  const hasHistory = versions.all.length > 1;

  const onApprove = (): void => {
    void approve.applyAction({ proposedRule: rule } as never);
  };
  const onDismiss = (): void => {
    // Reason preserved on error — cleared only on success.
    void dismiss.applyAction({ proposedRule: rule, reason: reason.trim() } as never).then(() => {
      setReason("");
      setDismissOpen(false);
    });
  };

  const canDismiss = reason.trim().length > 0 && !dismiss.isPending;

  const onAmend = (): void => {
    // newThreshold is the only required field on amendRuleThresholdAction.
    // We deliberately pass it through as-is (string) — the action accepts
    // any comparable and the ontology round-trips the raw value onto the
    // new HardScreenConfig row.
    void amend
      .applyAction({
        proposedRule: rule,
        newThreshold: newThreshold.trim(),
      } as never)
      .then(() => {
        setNewThreshold("");
        setAmendOpen(false);
      });
  };
  const canAmend = newThreshold.trim() !== "" && !amend.isPending;

  const onUnapprove = (): void => {
    void unapprove.applyAction({ proposedRule: rule } as never).then(() => {
      setUnapproveOpen(false);
    });
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        padding: 16,
        border: "1px solid var(--color-divider)",
        borderRadius: "var(--radius-md)",
        background: "var(--color-surface)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        {(() => {
          // Approved rules: use the latest active HSC row (that's what the
          // engine screens on). Pending / dismissed: use the ProposedRule
          // fields — no config exists yet.
          const predicate =
            approved && effectivePredicate !== null ? effectivePredicate : renderPredicate(rule);
          if (predicate === null) {
            return (
              <span
                style={{
                  fontSize: 12,
                  fontStyle: "italic",
                  color: "color-mix(in srgb, var(--color-text) 55%, transparent)",
                  minWidth: 0,
                  flex: 1,
                }}
                title="Predicate axis, operator, or threshold missing on this proposal. The FDE will remove it."
              >
                (malformed proposal: no predicate)
              </span>
            );
          }
          // JS-side truncation at a word boundary — CSS text-overflow
          // truncates at pixel width and produces mid-word cuts like
          // "geographic footpri". Rewind to the last space (or last
          // separator inside a snake_case token) before appending "…".
          // Full text stays in the title tooltip.
          const shown = truncatePredicateAtWord(predicate, 48);
          return (
            <code
              style={{
                fontSize: 13,
                fontFamily: "ui-monospace, Menlo, monospace",
                padding: "5px 9px",
                borderRadius: "var(--radius-chip)",
                background: "var(--color-neutral-900)",
                color: "var(--color-accent-200)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                maxWidth: "100%",
                minWidth: 0,
                flex: 1,
              }}
              title={predicate}
            >
              {shown}
            </code>
          );
        })()}
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            padding: "2px 8px",
            borderRadius: "var(--radius-chip)",
            color: chip.fg,
            background: chip.bg,
          }}
        >
          {chip.label}
        </span>
      </div>

      <div
        style={{
          fontSize: 11,
          color: "color-mix(in srgb, var(--color-text) 45%, transparent)",
          display: "flex",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        {rule.ruleModel && <span>Model: {rule.ruleModel}</span>}
        {rule.mandateScope && <span>Scope: {rule.mandateScope}</span>}
      </div>

      {rule.rationaleClusterSummary && (
        <p
          style={{
            fontSize: 13,
            margin: 0,
            color: "color-mix(in srgb, var(--color-text) 82%, transparent)",
          }}
          title={rule.rationaleClusterSummary}
        >
          {repairTruncatedText(rule.rationaleClusterSummary)}
        </p>
      )}

      {basisCount > 0 && (
        <>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            style={{
              background: "none",
              border: 0,
              cursor: "pointer",
              color: "var(--color-accent)",
              font: "inherit",
              fontSize: 12,
              padding: 0,
              textAlign: "left",
            }}
          >
            {expanded
              ? "Hide rejections"
              : `Based on ${basisCount} rejection${basisCount === 1 ? "" : "s"}`}
          </button>
          {expanded && basisFirmNames.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {basisFirmNames.map((n, i) => (
                <span key={`${n}-${i}`} className="tag tag-neutral">
                  {n}
                </span>
              ))}
              {supporting.length > basisFirmNames.length && (
                <span
                  style={{
                    fontSize: 11,
                    color: "color-mix(in srgb, var(--color-text) 45%, transparent)",
                    alignSelf: "center",
                  }}
                >
                  +{supporting.length - basisFirmNames.length} more (firm not on file)
                </span>
              )}
            </div>
          )}
          {expanded && basisFirmNames.length === 0 && (
            <div
              style={{
                fontSize: 12,
                color: "color-mix(in srgb, var(--color-text) 50%, transparent)",
              }}
            >
              Supporting decisions reference firms not currently loaded.
            </div>
          )}
        </>
      )}

      {projected !== null && (
        <div
          style={{
            fontSize: 12,
            padding: 12,
            borderRadius: "var(--radius-chip)",
            background: "color-mix(in srgb, var(--color-accent) 9%, transparent)",
            border: "1px solid color-mix(in srgb, var(--color-accent) 20%, transparent)",
            color: "color-mix(in srgb, var(--color-text) 82%, transparent)",
          }}
        >
          {approved ? "This rule is screening" : "If approved, this rule would screen"}{" "}
          <strong style={{ color: "var(--color-accent-200)", fontWeight: 600 }}>{projected}</strong>{" "}
          firm{projected === 1 ? "" : "s"}
          {approved ? " off the desk queue." : " from your current queue."}
        </div>
      )}

      {projectionUnavailable && (
        <div
          style={{
            fontSize: 12,
            padding: 12,
            borderRadius: "var(--radius-chip)",
            background: "color-mix(in srgb, var(--color-text) 5%, transparent)",
            border: "1px solid color-mix(in srgb, var(--color-text) 12%, transparent)",
            color: "color-mix(in srgb, var(--color-text) 62%, transparent)",
          }}
        >
          Screen count not shown: the desk evaluates numeric predicates client-side, and this rule
          compares text. It is screened server-side.
        </div>
      )}

      {(approve.error !== undefined ||
        dismiss.error !== undefined ||
        amend.error !== undefined ||
        unapprove.error !== undefined) && (
        <div
          style={{
            padding: "8px 12px",
            borderRadius: "var(--radius-md)",
            background: "rgba(207,112,112,.12)",
            color: "#e79191",
            fontSize: 12,
          }}
        >
          {approve.error !== undefined && <div>Approve failed: {String(approve.error)}</div>}
          {dismiss.error !== undefined && (
            <div>Dismiss failed: {String(dismiss.error)}. Your reason is preserved.</div>
          )}
          {amend.error !== undefined && (
            <div>Amend failed: {String(amend.error)}. Your value is preserved.</div>
          )}
          {unapprove.error !== undefined && <div>Unapprove failed: {String(unapprove.error)}</div>}
        </div>
      )}

      {pending && !dismissOpen && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 2 }}>
          <button
            className="btn btn-primary btn-block"
            style={{
              flexDirection: "column",
              alignItems: "stretch",
              gap: 2,
              padding: 12,
              background: "color-mix(in srgb, var(--color-accent) 15%, transparent)",
            }}
            disabled={approve.isPending}
            onClick={onApprove}
          >
            <span>{approve.isPending ? "Approving…" : "Approve"}</span>
            <span style={{ fontSize: 11, fontWeight: 400, opacity: 0.7, textAlign: "left" }}>
              Adds a versioned hard-screen rule authored by you
            </span>
          </button>
          <button
            className="btn btn-secondary btn-block"
            style={{ marginTop: 0 }}
            onClick={() => setDismissOpen(true)}
          >
            Dismiss…
          </button>
        </div>
      )}

      {pending && dismissOpen && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 2 }}>
          <div
            style={{
              fontSize: 11,
              color: "color-mix(in srgb, var(--color-text) 62%, transparent)",
            }}
          >
            A reason is required to dismiss.
          </div>
          <textarea
            className="input"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why dismiss this proposal?"
            aria-label="Reason to dismiss this proposal"
            style={{ minHeight: 72, lineHeight: 1.45 }}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-primary" disabled={!canDismiss} onClick={onDismiss}>
              {dismiss.isPending ? "Dismissing…" : "Dismiss"}
            </button>
            <button
              className="btn btn-ghost"
              onClick={() => setDismissOpen(false)}
              disabled={dismiss.isPending}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {approved && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            borderTop: "1px solid var(--color-divider)",
            paddingTop: 9,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              flexWrap: "wrap",
              fontSize: 12,
              color: "#8fe3c0",
            }}
          >
            {/* Version tag lives on the same line as authorship so the
                analyst reads "v2 · <predicate> · amended by you" as a
                single unit. When there's no active config (backfill lag /
                loading) we degrade to the original approval line. */}
            {effective ? (
              <>
                <span
                  style={{
                    padding: "1px 6px",
                    borderRadius: "var(--radius-sm)",
                    background: "color-mix(in srgb, #57b98a 18%, transparent)",
                    color: "#9be9ca",
                    fontWeight: 600,
                    fontSize: 11,
                    fontVariantNumeric: "tabular-nums",
                  }}
                  title={`Version ${currentVersion ?? "?"} · active config`}
                >
                  v{currentVersion ?? "?"}
                </span>
                <code
                  style={{
                    fontFamily: "ui-monospace, Menlo, monospace",
                    fontSize: 11,
                    color: "color-mix(in srgb, var(--color-text) 78%, transparent)",
                    overflowWrap: "anywhere",
                    minWidth: 0,
                  }}
                  title={effectivePredicate ?? undefined}
                >
                  {effectivePredicate ?? "—"}
                </code>
                <span
                  style={{
                    color: "color-mix(in srgb, var(--color-text) 55%, transparent)",
                  }}
                >
                  ·
                </span>
                <span>
                  {hasHistory ? "amended" : "approved"} by{" "}
                  {displayDecider(effective.configAuthor ?? rule.ruleDecidedBy)}
                </span>
              </>
            ) : (
              <span>Active rule · approved by {displayDecider(rule.ruleDecidedBy)}</span>
            )}
          </div>

          {hasHistory && (
            <div
              style={{
                fontSize: 11,
                color: "color-mix(in srgb, var(--color-text) 55%, transparent)",
                lineHeight: 1.5,
                overflowWrap: "anywhere",
              }}
              title="Version history: v1 is the original approved predicate"
            >
              {versions.all
                .map((c) => {
                  const pred =
                    summarizePredicate(c.configAxis, c.configOperator, c.configThreshold) ?? "—";
                  return `v${c.configVersion ?? "?"}: ${pred}`;
                })
                .join(" → ")}
            </div>
          )}

          {!amendOpen && !unapproveOpen && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <button
                className="btn btn-secondary"
                style={{ fontSize: 12, padding: "3px 10px" }}
                onClick={() => {
                  setAmendOpen(true);
                  setNewThreshold(effective?.configThreshold ?? rule.ruleThreshold ?? "");
                }}
              >
                Amend threshold…
              </button>
              <button
                className="btn btn-ghost"
                style={{ fontSize: 12, padding: "3px 10px" }}
                onClick={() => setUnapproveOpen(true)}
              >
                Unapprove
              </button>
            </div>
          )}

          {amendOpen && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label
                style={{
                  fontSize: 11,
                  color: "color-mix(in srgb, var(--color-text) 62%, transparent)",
                }}
              >
                New threshold for{" "}
                <code style={{ fontFamily: "ui-monospace, Menlo, monospace" }}>
                  {effective?.configAxis ?? rule.predicateAxis ?? ""}{" "}
                  {effective?.configOperator ?? rule.ruleOperator ?? ""}
                </code>
              </label>
              <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                <input
                  ref={amendInputRef}
                  className="input"
                  type="number"
                  inputMode="decimal"
                  value={newThreshold}
                  onChange={(e) => setNewThreshold(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && canAmend) {
                      onAmend();
                    }
                  }}
                  style={{ flex: "1 1 120px", minWidth: 100, height: 32 }}
                  aria-label="New threshold value"
                />
                <button
                  className="btn btn-primary"
                  style={{ fontSize: 12, padding: "3px 10px" }}
                  disabled={!canAmend}
                  onClick={onAmend}
                >
                  {amend.isPending ? "Amending…" : "Save"}
                </button>
                <button
                  className="btn btn-ghost"
                  style={{ fontSize: 12, padding: "3px 10px" }}
                  disabled={amend.isPending}
                  onClick={() => {
                    setAmendOpen(false);
                    setNewThreshold("");
                  }}
                >
                  Cancel
                </button>
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: "color-mix(in srgb, var(--color-text) 50%, transparent)",
                }}
              >
                Creates a new version. Firms the old threshold caught but this one doesn&rsquo;t
                re-enter the queue.
              </div>
            </div>
          )}

          {unapproveOpen && (
            <div
              role="alertdialog"
              aria-label="Unapprove this rule?"
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                padding: 10,
                borderRadius: "var(--radius-md)",
                border: "1px solid color-mix(in srgb, #cf7070 32%, transparent)",
                background: "rgba(207,112,112,.08)",
              }}
            >
              <div style={{ fontSize: 12, color: "#f4abab", fontWeight: 500 }}>
                Unapprove this rule?
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: "color-mix(in srgb, var(--color-text) 72%, transparent)",
                  lineHeight: 1.5,
                }}
              >
                The screen stops firing immediately and the rule returns to Pending. Firms caught
                only by this predicate re-enter the queue.
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  className="btn btn-secondary"
                  style={{ fontSize: 12, padding: "3px 10px" }}
                  disabled={unapprove.isPending}
                  onClick={onUnapprove}
                >
                  {unapprove.isPending ? "Unapproving…" : "Yes, unapprove"}
                </button>
                <button
                  className="btn btn-ghost"
                  style={{ fontSize: 12, padding: "3px 10px" }}
                  disabled={unapprove.isPending}
                  onClick={() => setUnapproveOpen(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {dismissed && (
        <div
          style={{
            fontSize: 12,
            color: "color-mix(in srgb, var(--color-text) 55%, transparent)",
            borderTop: "1px solid var(--color-divider)",
            paddingTop: 9,
          }}
        >
          <span style={{ color: "#e79191", fontWeight: 500 }}>Dismissed</span> · by{" "}
          {displayDecider(rule.ruleDecidedBy)}
        </div>
      )}
    </div>
  );
}

// ─── Root ───────────────────────────────────────────────────────────────

function Rules(): React.ReactElement {
  const {
    data: rulesData,
    isLoading,
    error,
  } = useOsdkObjects(ProposedRule, {
    pageSize: 200,
    autoFetchMore: true,
  });
  const { data: decisionsData } = useOsdkObjects(ReviewDecision, {
    pageSize: 500,
    autoFetchMore: true,
  });
  const { data: firmsData } = useOsdkObjects(Firm, {
    pageSize: 300,
    orderBy: { firmName: "asc" },
    autoFetchMore: true,
  });
  // Load every HardScreenConfig row so approved cards can show their
  // current version, effective predicate, and one-line history. Amend
  // creates a new row (version+1) and deactivates the previous; unapprove
  // deactivates all rows for the rule — both mutations invalidate this
  // query so the cards refresh on next tick.
  const { data: configsData } = useOsdkObjects(HardScreenConfig, {
    pageSize: 500,
    autoFetchMore: true,
  });

  const rules = React.useMemo(() => (rulesData ?? []) as unknown as RuleLike[], [rulesData]);

  // Same Firm query the desk runs, handed to each card so its screen
  // count is computed over the identical population.
  const screenableFirms = React.useMemo(
    () => (firmsData ?? []) as unknown as ScreenableFirm[],
    [firmsData],
  );

  // decisionId → firmId, firmId → firmName. Chain them so a rule's
  // supportingDecisionIds list resolves to firm names on expand.
  const firmIdByDecisionId = React.useMemo(() => {
    const m = new Map<string, string>();
    for (const d of (decisionsData ?? []) as unknown as DecisionLike[]) {
      if (d.firmId !== undefined && d.firmId !== "") {
        m.set(d.decisionId, d.firmId);
      }
    }
    return m;
  }, [decisionsData]);

  const firmNameById = React.useMemo(() => {
    const m = new Map<string, string>();
    for (const f of firmsData ?? []) {
      if (f.firmId) {
        m.set(f.firmId, f.firmName ?? f.firmId);
      }
    }
    return m;
  }, [firmsData]);

  // Group config rows by sourceProposedRuleId → ascending by version.
  // The version-history line reads left-to-right (v1 → v2 → …); the
  // latest active row is the one the engine is currently screening on.
  const versionsByRuleId = React.useMemo(() => {
    const m = new Map<string, RuleVersions>();
    const configs = (configsData ?? []) as unknown as ConfigLike[];
    const byRule = new Map<string, ConfigLike[]>();
    for (const c of configs) {
      const rid = c.sourceProposedRuleId ?? "";
      if (rid === "") {
        continue;
      }
      const arr = byRule.get(rid) ?? [];
      arr.push(c);
      byRule.set(rid, arr);
    }
    for (const [rid, arr] of byRule) {
      const sorted = [...arr].sort((a, b) => (a.configVersion ?? 0) - (b.configVersion ?? 0));
      const activeSorted = sorted.filter((c) => c.configActive === true);
      const activeLatest = activeSorted[activeSorted.length - 1] ?? null;
      m.set(rid, { all: sorted, activeLatest });
    }
    return m;
  }, [configsData]);

  const basisFirmNamesByRule = React.useMemo(() => {
    const m = new Map<string, string[]>();
    for (const r of rules) {
      const ids = parseSupportingIds(r.supportingDecisionIds);
      const names: string[] = [];
      const seen = new Set<string>();
      for (const decId of ids) {
        const fid = firmIdByDecisionId.get(decId);
        if (fid === undefined || seen.has(fid)) {
          continue;
        }
        seen.add(fid);
        const name = firmNameById.get(fid);
        if (name !== undefined) {
          names.push(name);
        }
      }
      m.set(r.proposedRuleId, names);
    }
    return m;
  }, [rules, firmIdByDecisionId, firmNameById]);

  // Order: pending first (freshest actionable work), then approved, then dismissed.
  const ordered = React.useMemo(() => {
    const rank = (status: string): number => {
      const s = status.toLowerCase();
      if (s === "pending") {
        return 0;
      }
      if (s === "approved") {
        return 1;
      }
      return 2;
    };
    return [...rules].sort((a, b) => rank(a.ruleStatus ?? "") - rank(b.ruleStatus ?? ""));
  }, [rules]);

  const pendingCount = rules.filter(
    (r) => (r.ruleStatus ?? "pending").toLowerCase() === "pending",
  ).length;

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
        <BrandMark section="Rules" />
        <ProposeRulesButton />
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
            <span style={{ fontWeight: 500, fontSize: 16 }}>Proposed hard-screen rules</span>
            <span
              style={{
                fontSize: 11,
                color: "color-mix(in srgb, var(--color-text) 48%, transparent)",
              }}
            >
              {isLoading && rules.length === 0
                ? "Loading proposals…"
                : `${pendingCount} pending · clustered from your rejections. Approve to auto-screen future firms`}
            </span>
          </div>
        </header>

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

        <main
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "24px 24px 32px",
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))",
            gap: 12,
            alignContent: "start",
          }}
        >
          {!isLoading && rules.length === 0 && (
            <div
              style={{
                gridColumn: "1 / -1",
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
                  <path d="M4 7h16M4 12h16M4 17h10" />
                </svg>
              </span>
              <div style={{ fontSize: 19, fontWeight: 600 }}>Not enough rejection history yet</div>
              <p
                style={{
                  margin: 0,
                  fontSize: 14,
                  color: "color-mix(in srgb, var(--color-text) 60%, transparent)",
                  maxWidth: "44ch",
                }}
              >
                Proposed hard-screen rules appear once you&rsquo;ve rejected roughly five similar
                firms. Beacon clusters the reasons and drafts a predicate for you to approve.
              </p>
            </div>
          )}
          {ordered.map((r) => (
            <RuleCard
              key={r.proposedRuleId}
              rule={r}
              basisFirmNames={basisFirmNamesByRule.get(r.proposedRuleId) ?? []}
              versions={versionsByRuleId.get(r.proposedRuleId) ?? { all: [], activeLatest: null }}
              firms={screenableFirms}
            />
          ))}
        </main>
      </div>
    </div>
  );
}

export default Rules;
