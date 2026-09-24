/**
 * Search facets and the country → geography map. One source for the
 * SearchPage chips, the server's search matching, and the seed generator.
 * Generic by design: nothing here is copied from any real firm's site.
 */

export interface FacetGroup {
  label: string;
  subs: readonly string[];
}

export const REGIONS: readonly FacetGroup[] = [
  { label: "Americas", subs: ["United States", "Canada", "Mexico", "Brazil"] },
  {
    label: "Europe",
    subs: [
      "United Kingdom",
      "Germany",
      "France",
      "Netherlands",
      "Switzerland",
      "Sweden",
      "Spain",
      "Italy",
    ],
  },
  {
    label: "Middle East & Africa",
    subs: ["United Arab Emirates", "Saudi Arabia", "South Africa", "Nigeria"],
  },
  { label: "Asia-Pacific", subs: ["Australia", "Japan", "Singapore", "India", "Hong Kong"] },
];

export const PRODUCT_GROUPS: readonly FacetGroup[] = [
  {
    label: "Corporate Finance",
    subs: [
      "Sell-side M&A",
      "Buy-side M&A",
      "Sector-focused M&A",
      "Board & special committee advisory",
    ],
  },
  {
    label: "Capital Solutions",
    subs: [
      "Private credit advisory",
      "Structured & asset-based finance",
      "Equity private placements",
      "Secondaries & GP advisory",
    ],
  },
];

/** Product group → the firm type (thesis model) it selects. */
export const PRODUCT_FIRM_TYPE: Readonly<Record<string, "CF" | "CS">> = {
  "Corporate Finance": "CF",
  "Capital Solutions": "CS",
};

export const INDUSTRY_GROUPS: readonly FacetGroup[] = [
  {
    label: "Business Services",
    subs: ["IT Services", "Marketing Services", "Logistics", "Professional Services"],
  },
  { label: "Consumer", subs: ["Food & Beverage", "Retail", "Leisure"] },
  { label: "Energy & Industrials", subs: ["Energy", "Manufacturing", "Aerospace & Defense"] },
  { label: "Financial Services", subs: ["Banking", "Insurance", "Asset Management"] },
  { label: "Healthcare", subs: ["Healthcare Services", "Medical Devices", "Pharma Services"] },
  { label: "Technology", subs: ["Software", "FinTech", "Data & Analytics"] },
];

export const ALL_SECTORS: readonly string[] = INDUSTRY_GROUPS.flatMap((g) => g.subs);

export interface CountryGeo {
  region: string;
  /** Firm.geography bucket the UI groups by. */
  bucket: "US" | "EUR" | "Other";
  /** Firm.geographicFootprint: descriptive only in rubric v2. */
  footprint: string;
  /** Rubric geo axis: US/UK = 2, developed = 1, else 0. */
  geoScore: 0 | 1 | 2;
}

export const COUNTRY_GEO: Readonly<Record<string, CountryGeo>> = {
  "United States": { region: "Americas", bucket: "US", footprint: "US", geoScore: 2 },
  Canada: { region: "Americas", bucket: "Other", footprint: "Developed", geoScore: 1 },
  Mexico: { region: "Americas", bucket: "Other", footprint: "Emerging", geoScore: 0 },
  Brazil: { region: "Americas", bucket: "Other", footprint: "Emerging", geoScore: 0 },
  "United Kingdom": { region: "Europe", bucket: "EUR", footprint: "UK", geoScore: 2 },
  Germany: { region: "Europe", bucket: "EUR", footprint: "Developed", geoScore: 1 },
  France: { region: "Europe", bucket: "EUR", footprint: "Developed", geoScore: 1 },
  Netherlands: { region: "Europe", bucket: "EUR", footprint: "Developed", geoScore: 1 },
  Switzerland: { region: "Europe", bucket: "EUR", footprint: "Developed", geoScore: 1 },
  Sweden: { region: "Europe", bucket: "EUR", footprint: "Developed", geoScore: 1 },
  Spain: { region: "Europe", bucket: "EUR", footprint: "Developed", geoScore: 1 },
  Italy: { region: "Europe", bucket: "EUR", footprint: "Developed", geoScore: 1 },
  "United Arab Emirates": {
    region: "Middle East & Africa",
    bucket: "Other",
    footprint: "Emerging",
    geoScore: 0,
  },
  "Saudi Arabia": {
    region: "Middle East & Africa",
    bucket: "Other",
    footprint: "Emerging",
    geoScore: 0,
  },
  "South Africa": {
    region: "Middle East & Africa",
    bucket: "Other",
    footprint: "Emerging",
    geoScore: 0,
  },
  Nigeria: { region: "Middle East & Africa", bucket: "Other", footprint: "Emerging", geoScore: 0 },
  Australia: { region: "Asia-Pacific", bucket: "Other", footprint: "Developed", geoScore: 1 },
  Japan: { region: "Asia-Pacific", bucket: "Other", footprint: "Developed", geoScore: 1 },
  Singapore: { region: "Asia-Pacific", bucket: "Other", footprint: "Developed", geoScore: 1 },
  India: { region: "Asia-Pacific", bucket: "Other", footprint: "Emerging", geoScore: 0 },
  "Hong Kong": { region: "Asia-Pacific", bucket: "Other", footprint: "Developed", geoScore: 1 },
};

export interface Selection {
  countries: Set<string>;
  firmTypes: Set<"CF" | "CS">;
  sectors: Set<string>;
  /** Values that matched no facet — callers reject these. */
  unknown: string[];
}

/**
 * Expand facet picks (group labels or sub-chips, from any of the three
 * facets) into concrete match sets. Picking a group label selects all of
 * its subs; product picks select a firm type.
 */
export function expandSelections(values: readonly string[]): Selection {
  const sel: Selection = {
    countries: new Set(),
    firmTypes: new Set(),
    sectors: new Set(),
    unknown: [],
  };
  for (const raw of values) {
    const v = raw.trim();
    const region = REGIONS.find((g) => g.label === v);
    const product = PRODUCT_GROUPS.find((g) => g.label === v || g.subs.includes(v));
    const industry = INDUSTRY_GROUPS.find((g) => g.label === v);
    if (region) {
      region.subs.forEach((c) => sel.countries.add(c));
    } else if (v in COUNTRY_GEO) {
      sel.countries.add(v);
    } else if (product) {
      sel.firmTypes.add(PRODUCT_FIRM_TYPE[product.label]);
    } else if (industry) {
      industry.subs.forEach((s) => sel.sectors.add(s));
    } else if (ALL_SECTORS.includes(v)) {
      sel.sectors.add(v);
    } else {
      sel.unknown.push(raw);
    }
  }
  return sel;
}

export function matchesSelection(
  firm: { hqCountry?: string | null; firmType?: string | null; sector?: string | null },
  sel: Selection,
): boolean {
  if (sel.countries.size > 0 && !sel.countries.has(firm.hqCountry ?? "")) {
    return false;
  }
  if (sel.firmTypes.size > 0 && !sel.firmTypes.has((firm.firmType ?? "CF") as "CF" | "CS")) {
    return false;
  }
  if (sel.sectors.size > 0 && !sel.sectors.has(firm.sector ?? "")) {
    return false;
  }
  return true;
}
