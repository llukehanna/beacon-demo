/** 700 synthetic advisory firms. Names come from invented words; any resemblance to a real firm is coincidental. */
import type { Props } from "../../shared/schema.js";
import { ALL_SECTORS, COUNTRY_GEO } from "../../shared/taxonomy.js";
import { COVERAGE_LABELS, firmIdFor } from "../../shared/vocab.js";
import { gaussian, pick, rng } from "../enrichment/random.js";

export const UNIVERSE_SIZE = 700;
export const UNIVERSE_SEED = "beacon-universe-v1";

const STEMS = [
  "Brevarre",
  "Calthorn",
  "Dellaway",
  "Elsworthy",
  "Farrowgate",
  "Gannister",
  "Halvercroft",
  "Istrenne",
  "Jorvane",
  "Kellmarsh",
  "Loxbury",
  "Morrendale",
  "Nethercote",
  "Orlanne",
  "Pellingham",
  "Quarrington",
  "Rathmore",
  "Sallowfield",
  "Tarrenvale",
  "Ulverdane",
  "Vessington",
  "Wexcombe",
  "Yardleigh",
  "Zennormoor",
  "Ambercroft",
  "Bellhaven",
  "Corrivale",
  "Dunstanmere",
  "Eversholt",
  "Fallowmere",
  "Glenharrow",
  "Hollinsby",
  "Ivorwick",
  "Kestermoor",
  "Lanworth",
  "Mirrowdale",
  "Northwold",
  "Oakenvale",
  "Pennarth",
  "Ravenmere",
] as const;
const MIDDLES = ["", " Hollis", " Maren", " Voss", " Talbot", " Quay"] as const;
const SUFFIXES = [
  "Partners",
  "Advisors",
  "Capital Advisors",
  "& Co.",
  "Group",
  "Advisory",
  "Corporate Finance",
  "Securities",
] as const;

const COUNTRY_WEIGHTS: ReadonlyArray<readonly [string, number]> = [
  ["United States", 45],
  ["United Kingdom", 12],
  ["Germany", 6],
  ["France", 5],
  ["Canada", 5],
  ["Netherlands", 3],
  ["Switzerland", 3],
  ["Australia", 3],
  ["Sweden", 2],
  ["Spain", 2],
  ["Italy", 2],
  ["Japan", 2],
  ["Singapore", 2],
  ["India", 2],
  ["Hong Kong", 1],
  ["Mexico", 1],
  ["Brazil", 1],
  ["United Arab Emirates", 1],
  ["Saudi Arabia", 1],
  ["South Africa", 1],
  ["Nigeria", 1],
];

export function employeeGroup(n: number): string {
  if (n < 10) {
    return "1-9";
  }
  if (n < 50) {
    return "10-49";
  }
  if (n < 200) {
    return "50-199";
  }
  return "200+";
}

export function generateUniverse(size = UNIVERSE_SIZE, seed = UNIVERSE_SEED): Props<"Firm">[] {
  const r = rng(seed);
  const names = new Set<string>();
  const firms: Props<"Firm">[] = [];
  while (firms.length < size) {
    const name = `${pick(r, STEMS)}${pick(r, MIDDLES)} ${pick(r, SUFFIXES)}`;
    if (names.has(name)) {
      continue;
    }
    names.add(name);
    const country = pick(
      r,
      COUNTRY_WEIGHTS.map((c) => c[0]),
      COUNTRY_WEIGHTS.map((c) => c[1]),
    );
    const geo = COUNTRY_GEO[country];
    const employees = Math.min(
      600,
      Math.max(2, Math.round(Math.exp(Math.log(25) + 0.9 * gaussian(r)))),
    );
    firms.push({
      firmId: firmIdFor(name, country),
      firmName: name,
      source: "synthetic",
      firmType: r() < 0.1 ? "CS" : "CF",
      hqCountry: country,
      geography: geo.bucket,
      geographicFootprint: geo.footprint,
      geoScore: geo.geoScore,
      sector: pick(r, ALL_SECTORS),
      employees,
      employeeGroup: employeeGroup(employees),
      coverageModel: pick(r, COVERAGE_LABELS, [0.15, 0.4, 0.45]),
      lifecycleState: "Discovered",
      currentStage: "Discovered",
    });
  }
  return firms;
}
