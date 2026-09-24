/**
 * Pipeline lifecycle vocabulary — the six-stage funnel.
 *
 * Extracted from Pipeline.tsx so the Home funnel strip and the Pipeline
 * page compute stage membership from ONE function. If these diverged the
 * home tile and the page it links to would disagree about the same firm,
 * which is exactly the failure the "every number links" rule exists to
 * prevent.
 */
import type { MirrorResult } from "./scoreMirror";

export const LIFECYCLE_BUCKETS = [
  "Discovered",
  "In Review",
  "Outreach",
  "In Talks",
  "Qualified",
  "Rejected",
] as const;

export type Lifecycle = (typeof LIFECYCLE_BUCKETS)[number];

// Status chip palette — mirrors support.js:statusChipStyle().
export interface StatusStyle {
  bg: string;
  fg: string;
  dot: string;
}

export const STATUS_CHIP: Record<Lifecycle, StatusStyle> = {
  Discovered: {
    bg: "var(--color-neutral-800)",
    fg: "var(--color-neutral-200)",
    dot: "var(--color-neutral-500)",
  },
  "In Review": {
    bg: "var(--color-accent-2-800)",
    fg: "var(--color-accent-2-100)",
    dot: "var(--color-accent-400)",
  },
  Outreach: {
    bg: "color-mix(in srgb, var(--color-accent) 14%, transparent)",
    fg: "var(--color-accent-200)",
    dot: "var(--color-accent-500)",
  },
  "In Talks": {
    bg: "var(--color-accent-800)",
    fg: "var(--color-accent-100)",
    dot: "var(--color-accent)",
  },
  Qualified: {
    bg: "rgba(87,185,138,.18)",
    fg: "#8fe3c0",
    dot: "#57b98a",
  },
  Rejected: {
    bg: "var(--color-neutral-800)",
    fg: "color-mix(in srgb, var(--color-text) 55%, transparent)",
    dot: "var(--color-neutral-600)",
  },
};

// Minimal firm shape the bucket derivation reads. Both Pipeline's FirmView
// and Home's firm rows structurally satisfy it.
export interface BucketFirm {
  lifecycleState?: string | null;
  currentStage?: string | null;
  disposition?: string | null;
}

// Fold any separator (underscore, hyphen, spaces) down to a single space so
// backend variants ("in_review", "in-review", "In  Review") all match the
// canonical "In Review". The prior comparison required an exact lowercase
// match, so any firm with a snake_case lifecycleState silently bucketed
// under Discovered — that's why the In Review / Outreach / In Talks /
// Qualified tiles were dropping counts.
export function foldSeparators(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, " ");
}

export function normalizeLifecycle(raw: string | null | undefined): Lifecycle | null {
  if (raw === null || raw === undefined || raw === "") {
    return null;
  }
  const n = foldSeparators(raw);
  for (const s of LIFECYCLE_BUCKETS) {
    if (foldSeparators(s) === n) {
      return s;
    }
  }
  return null;
}

/**
 * A firm's canonical bucket for the pipeline:
 * - mirror.hardRejected → "Rejected"
 * - currentStage / lifecycleState matches a tracked name → that
 * - disposition says rejected → "Rejected"
 * - else → "Discovered"
 */
export function bucketOf(firm: BucketFirm, mirror: MirrorResult): Lifecycle {
  return bucketOfHardRejected(firm, mirror.hardRejected);
}

/**
 * `bucketOf` for callers that already know the hard-reject verdict and don't
 * want to re-run mirrorScore. The desk's ranker computes it per firm during
 * ordering, so re-deriving a MirrorResult for all 700-odd rows just to read
 * one boolean back off it would be wasted work.
 */
export function bucketOfHardRejected(firm: BucketFirm, hardRejected: boolean): Lifecycle {
  if (hardRejected) {
    return "Rejected";
  }
  const norm = normalizeLifecycle(firm.currentStage) ?? normalizeLifecycle(firm.lifecycleState);
  if (norm !== null) {
    return norm;
  }
  if ((firm.disposition ?? "").toLowerCase().includes("reject")) {
    return "Rejected";
  }
  return "Discovered";
}

/**
 * "Open" — the funnel stages that still represent undecided work.
 *
 * This is THE definition of open across the product. The desk header used to
 * carry its own (`lifecycleState ∈ {Discovered, In Review}`), which counted
 * 674 firms against the funnel's 441 for the same database: a firm that a
 * base rule hard-rejected still reads "Discovered" in its lifecycleState, so
 * the desk called it open while the funnel had already placed it in
 * Rejected. Deriving from bucketOf is what keeps the two honest — anything
 * the funnel considers decided is decided everywhere.
 */
export const OPEN_BUCKETS = ["Discovered", "In Review"] as const;

export function isOpenBucket(bucket: Lifecycle): boolean {
  return (OPEN_BUCKETS as readonly Lifecycle[]).includes(bucket);
}

/** Open per the funnel, for a caller holding the hard-reject verdict. */
export function isOpenFirm(firm: BucketFirm, hardRejected: boolean): boolean {
  return isOpenBucket(bucketOfHardRejected(firm, hardRejected));
}

export function emptyBucketCounts(): Record<Lifecycle, number> {
  return {
    Discovered: 0,
    "In Review": 0,
    Outreach: 0,
    "In Talks": 0,
    Qualified: 0,
    Rejected: 0,
  };
}
