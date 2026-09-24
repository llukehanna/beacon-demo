/**
 * How many firms a mandate has scoped — one computation, two pages.
 *
 * /mandate used to count only the SearchList↔firms link (one number per
 * search list, "285 firms") while Home counted the union across three
 * sources ("317 scoped · 32 from searches"). Same mandate, two numbers, and
 * nothing on either page explaining the gap.
 *
 * The union has three legs because a firm can enter a mandate's scope by
 * three different routes, and no single one of them is complete:
 *
 *   SearchList↔firms   the assembled candidate universe — what /mandate
 *                      counted. Misses anything a search turned up later.
 *   SearchMembership   rows written when a search attaches a firm it found.
 *   discoveredVia      a firm whose discoveredViaSearchId points at one of
 *                      the mandate's searches. Catches firms a just-run
 *                      search CREATED before its membership rows land —
 *                      without this leg a fresh search reads as zero.
 *
 * scoped       = SearchList ∪ SearchMembership ∪ discoveredVia
 * fromSearches = SearchMembership ∪ discoveredVia
 *
 * fromSearches is the subset that searches actually turned up, as opposed
 * to the universe assembled up front — it is what makes "32 from searches"
 * meaningful next to "317 scoped".
 */

export interface SearchLike {
  searchId: string;
  mandateId?: string | null;
}

export interface MembershipLike {
  searchId?: string | null;
  firmId?: string | null;
}

export interface FirmLike {
  firmId?: string | null;
  discoveredViaSearchId?: string | null;
}

export interface SearchListLike {
  searchId: string;
  mandateId?: string | null;
}

export interface MandateFirmCounts {
  /** SearchList ∪ SearchMembership ∪ discoveredVia. */
  scoped: number;
  /** SearchMembership ∪ discoveredVia — the searches' own contribution. */
  fromSearches: number;
}

export const EMPTY_COUNTS: MandateFirmCounts = { scoped: 0, fromSearches: 0 };

export interface MandateFirmInput {
  /** Search objects, carrying the search → mandate mapping. */
  searches: readonly SearchLike[];
  /** SearchMembership rows. */
  memberships: readonly MembershipLike[];
  /** Loaded firms, for the discoveredViaSearchId leg. */
  firms: readonly FirmLike[];
  /** SearchList objects, carrying their own search → mandate mapping. */
  searchLists: readonly SearchListLike[];
  /** searchId → firmIds linked to that SearchList. See `searchListFirmIds`. */
  searchListFirmIds: ReadonlyMap<string, readonly string[]>;
}

/**
 * Adapt a `useLinks(...).linkedObjectsBySourcePrimaryKey` map into the plain
 * searchId → firmId[] map `mandateFirmCounts` takes, so the counting logic
 * stays free of server-object types and can be unit-tested directly.
 */
export function searchListFirmIds(
  // The link map types its key as string | number; searchIds are strings but
  // the map signature is wider, so normalize rather than cast at each call.
  linkedObjectsBySourcePrimaryKey: ReadonlyMap<string | number, readonly unknown[]>,
): Map<string, readonly string[]> {
  const out = new Map<string, readonly string[]>();
  for (const [key, linked] of linkedObjectsBySourcePrimaryKey) {
    const searchId = String(key);
    const ids: string[] = [];
    for (const f of linked) {
      const fid = ((f as { firmId?: string | null }).firmId ?? "").trim();
      if (fid !== "") {
        ids.push(fid);
      }
    }
    out.set(searchId, ids);
  }
  return out;
}

/**
 * mandateId → { scoped, fromSearches }. Mandates with no firms by any route
 * are absent; callers should fall back to EMPTY_COUNTS.
 */
export function mandateFirmCounts(input: MandateFirmInput): Map<string, MandateFirmCounts> {
  const { searches, memberships, firms, searchLists, searchListFirmIds: listFirmIds } = input;

  // searchId → mandateId, from both object types. SearchList rows carry the
  // mapping for lists that have no matching Search object.
  const mandateBySearch = new Map<string, string>();
  for (const s of searches) {
    const mid = (s.mandateId ?? "").trim();
    if (mid !== "") {
      mandateBySearch.set(s.searchId, mid);
    }
  }
  for (const sl of searchLists) {
    const mid = (sl.mandateId ?? "").trim();
    if (mid !== "" && !mandateBySearch.has(sl.searchId)) {
      mandateBySearch.set(sl.searchId, mid);
    }
  }

  // Leg 2 + 3 — what the searches turned up.
  const searchSets = new Map<string, Set<string>>();
  const addSearch = (mandateId: string, firmId: string): void => {
    const set = searchSets.get(mandateId);
    if (set === undefined) {
      searchSets.set(mandateId, new Set([firmId]));
    } else {
      set.add(firmId);
    }
  };
  for (const m of memberships) {
    const mid = mandateBySearch.get((m.searchId ?? "").trim());
    const fid = (m.firmId ?? "").trim();
    if (mid !== undefined && fid !== "") {
      addSearch(mid, fid);
    }
  }
  for (const f of firms) {
    const mid = mandateBySearch.get((f.discoveredViaSearchId ?? "").trim());
    const fid = (f.firmId ?? "").trim();
    if (mid !== undefined && fid !== "") {
      addSearch(mid, fid);
    }
  }

  // Leg 1 — the assembled universe, unioned on top.
  const scopedSets = new Map<string, Set<string>>();
  for (const [mid, set] of searchSets) {
    scopedSets.set(mid, new Set(set));
  }
  for (const sl of searchLists) {
    const mid = (sl.mandateId ?? "").trim();
    if (mid === "") {
      continue;
    }
    const linked = listFirmIds.get(sl.searchId);
    if (linked === undefined) {
      continue;
    }
    const set = scopedSets.get(mid) ?? new Set<string>();
    for (const fid of linked) {
      if (fid !== "") {
        set.add(fid);
      }
    }
    scopedSets.set(mid, set);
  }

  const out = new Map<string, MandateFirmCounts>();
  for (const mid of new Set([...scopedSets.keys(), ...searchSets.keys()])) {
    out.set(mid, {
      scoped: scopedSets.get(mid)?.size ?? 0,
      fromSearches: searchSets.get(mid)?.size ?? 0,
    });
  }
  return out;
}

/**
 * The one string both pages print. Keeping the copy here — not just the
 * arithmetic — is what stops the two surfaces drifting apart again through
 * wording alone.
 */
export function formatMandateFirmCounts(counts: MandateFirmCounts): string {
  return `${counts.scoped} scoped · ${counts.fromSearches} from searches`;
}
