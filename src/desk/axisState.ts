/**
 * Axis-level finding classification.
 *
 * One card per axis on the desk; if multiple visible findings exist for an
 * axis, authoritative = human-verified first, else latest retrievedAt. The
 * others collapse into a "history (N)" disclosure inside the card.
 *
 * Extracted from Desk.tsx so Home can count "awaiting judgment" firms with
 * the SAME rule the desk renders. If Home used a looser definition (e.g.
 * "has any abstained finding" rather than "has an axis whose authoritative
 * finding abstained") the home count would promise work the desk doesn't
 * show — an abstained finding that a later verified one supersedes is not
 * work.
 */

export interface FindingLike {
  findingId: string;
  axis?: string;
  value?: string;
  confidence?: number;
  confidenceTier?: string;
  provider?: string;
  sourceType?: string;
  sourceUrl?: string;
  sourceExcerpt?: string;
  conflictGroupId?: string;
  findingStatus?: string;
  verifiedByHuman?: boolean;
  normalizedScore?: number;
  // Server timestamp — ISO string over the wire; used to pick the freshest
  // finding for an axis when no verified one exists.
  retrievedAt?: string | number | Date | null;
}

export function isVerifiedFinding(f: FindingLike): boolean {
  return f.verifiedByHuman === true || (f.findingStatus ?? "").toLowerCase() === "verified";
}

export function isAbstainedFinding(f: FindingLike): boolean {
  return (
    (f.confidenceTier ?? "").toLowerCase() === "abstain" ||
    (f.findingStatus ?? "").toLowerCase() === "abstained"
  );
}

export function retrievedMs(f: FindingLike): number {
  const raw = f.retrievedAt;
  if (raw === null || raw === undefined) {
    return 0;
  }
  const t = raw instanceof Date ? raw.getTime() : new Date(raw).getTime();
  return Number.isNaN(t) ? 0 : t;
}

export function pickAuthoritative(findings: FindingLike[]): FindingLike {
  const verified = findings.filter(isVerifiedFinding);
  const pool = verified.length > 0 ? verified : findings;
  return [...pool].sort((a, b) => retrievedMs(b) - retrievedMs(a))[0];
}

export type AxisState = "verified" | "abstained" | "proposed";

export interface AxisGroup {
  axis: string;
  authoritative: FindingLike;
  history: FindingLike[];
  state: AxisState;
}

export function classifyAxis(auth: FindingLike): AxisState {
  if (isVerifiedFinding(auth)) {
    return "verified";
  }
  if (isAbstainedFinding(auth)) {
    return "abstained";
  }
  return "proposed";
}

// ─── Cross-firm rollup (Home) ───────────────────────────────────────────

interface FirmScopedFinding extends FindingLike {
  firmId?: string;
}

/**
 * How many axes per firm are sitting in the "no source had this — needs
 * you" state. Mirrors FindingsSection's grouping exactly:
 *   • superseded findings are invisible
 *   • conflict-grouped findings are their own bucket, not an axis card
 *   • one authoritative finding per remaining axis decides the state
 *
 * Firms with zero needs-you axes are absent from the map rather than
 * present with 0 — callers count `map.size` against a queue, so an entry
 * always means real work.
 */
export function needsYouAxisCountByFirm(
  findings: readonly FirmScopedFinding[],
): Map<string, number> {
  // firmId → axis → findings
  const byFirm = new Map<string, Map<string, FindingLike[]>>();
  for (const f of findings) {
    const firmId = f.firmId ?? "";
    if (firmId === "") {
      continue;
    }
    if ((f.findingStatus ?? "").toLowerCase() === "superseded") {
      continue;
    }
    // A finding inside a conflict group is rendered as a conflict card, not
    // as an axis card — conflicts are "two sources disagree", not "no
    // source had it".
    const gid = f.conflictGroupId;
    if (gid !== null && gid !== undefined && gid !== "") {
      continue;
    }
    const axis = f.axis ?? "";
    const axes = byFirm.get(firmId) ?? new Map<string, FindingLike[]>();
    const arr = axes.get(axis) ?? [];
    arr.push(f);
    axes.set(axis, arr);
    byFirm.set(firmId, axes);
  }

  const out = new Map<string, number>();
  for (const [firmId, axes] of byFirm) {
    let n = 0;
    for (const [, arr] of axes) {
      if (arr.length === 0) {
        continue;
      }
      if (classifyAxis(pickAuthoritative(arr)) === "abstained") {
        n++;
      }
    }
    if (n > 0) {
      out.set(firmId, n);
    }
  }
  return out;
}
