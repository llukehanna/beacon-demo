/**
 * Trust metrics — agreement / override / honest abstention.
 *
 * Extracted from Accuracy.tsx so the Home trust panel quotes the same
 * numbers the /accuracy page it links to will show. A finding is:
 *   • abstain  — confidenceTier === "abstain" OR findingStatus === "abstained"
 *   • agree    — non-abstain AND verifiedByHuman === true
 *   • override — non-abstain AND findingStatus === "rejected"
 *   • pending  — non-abstain, undecided (excluded from agreement/override)
 *
 * Rates:
 *   agreement %  = agree / (agree + override)   (denominator = decided
 *                                                 non-abstain)
 *   override  %  = override / (agree + override)
 *   abstention%  = abstain / all-findings        (denominator = everything
 *                                                 in the group)
 */
import { OUTCOME_ACQUIRED } from "./tokens";

export interface RatedFinding {
  findingId: string;
  axis?: string;
  confidenceTier?: string;
  findingStatus?: string;
  provider?: string;
  verifiedByHuman?: boolean;
}

export interface Rates {
  agreement: number | null; // null when undecided
  override: number | null;
  abstention: number; // always defined
  total: number; // all findings in the group
  decided: number; // agree + override
}

export function classify(f: RatedFinding): "abstain" | "agree" | "override" | "pending" {
  const ct = (f.confidenceTier ?? "").toLowerCase();
  const fs = (f.findingStatus ?? "").toLowerCase();
  if (ct === "abstain" || fs === "abstained") {
    return "abstain";
  }
  if (f.verifiedByHuman === true) {
    return "agree";
  }
  if (fs === "rejected") {
    return "override";
  }
  return "pending";
}

export function rates(findings: readonly RatedFinding[]): Rates {
  let agree = 0;
  let override = 0;
  let abstain = 0;
  for (const f of findings) {
    const cls = classify(f);
    if (cls === "agree") {
      agree++;
    } else if (cls === "override") {
      override++;
    } else if (cls === "abstain") {
      abstain++;
    }
  }
  const decided = agree + override;
  const total = findings.length;
  return {
    agreement: decided > 0 ? Math.round((agree / decided) * 100) : null,
    override: decided > 0 ? Math.round((override / decided) * 100) : null,
    abstention: total > 0 ? Math.round((abstain / total) * 100) : 0,
    decided,
    total,
  };
}

// Threshold: don't publish trust metrics until we have enough decided
// findings to draw meaningful rates. The design's copy says "20
// enrichments"; we use "20 decided findings" — same idea in our schema.
export const INSUFFICIENT_THRESHOLD = 20;

// ─── Observed outcomes ──────────────────────────────────────────────────

export interface FirmOutcomeLike {
  firmId?: string;
  lifecycleState?: string | null;
  disposition?: string | null;
  outcome?: string | null;
  outcomeObservedAt?: string | number | Date | null;
}

// A firm counts as "passed" (we decided not to pursue) when either its
// lifecycle landed in Rejected or the disposition string says so — matches
// the definition used elsewhere in the desk for "keep passed" precedent.
export function isPassedFirm(f: FirmOutcomeLike): boolean {
  const life = (f.lifecycleState ?? "").trim().toLowerCase();
  if (life === "rejected") {
    return true;
  }
  const disp = (f.disposition ?? "").trim().toLowerCase();
  if (disp === "") {
    return false;
  }
  return disp.includes("reject") || disp.includes("screen");
}

// Outcome slots rendered in the panels — order matters (converted first,
// then LOI, then went cold, then acquired, then null). The keys map to the
// backend vocabulary; labels come from outcomeLabel().
export const OUTCOME_SLOTS: (string | null)[] = [
  "converted_to_talks",
  "loi",
  "went_cold",
  OUTCOME_ACQUIRED,
  null,
];

export interface OutcomeTally {
  counts: Record<string, number>;
  passed: number;
  passedAndAcquired: number;
}

export const NULL_OUTCOME_KEY = "__null__";

export function tallyOutcomes(firms: readonly FirmOutcomeLike[]): OutcomeTally {
  const counts: Record<string, number> = {};
  for (const slot of OUTCOME_SLOTS) {
    counts[slot ?? NULL_OUTCOME_KEY] = 0;
  }
  let passed = 0;
  let passedAndAcquired = 0;
  for (const f of firms) {
    const raw = (f.outcome ?? "").trim().toLowerCase();
    const bucket = raw === "" ? NULL_OUTCOME_KEY : raw;
    if (bucket in counts) {
      counts[bucket] += 1;
    } else {
      // Unknown outcome value — fold into the not-yet-observed bucket so it
      // still shows without breaking the fixed grid layout.
      counts[NULL_OUTCOME_KEY] += 1;
    }
    if (isPassedFirm(f)) {
      passed += 1;
      if (raw === OUTCOME_ACQUIRED) {
        passedAndAcquired += 1;
      }
    }
  }
  return { counts, passed, passedAndAcquired };
}
