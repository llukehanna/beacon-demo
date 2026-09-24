/**
 * Deterministic mock data providers. Each firm has a hidden "truth" per
 * axis, and each provider observes it with its own coverage and error rate.
 * Everything is a pure function of (provider, firmId, axis), so there is no
 * fixture table and firms discovered later still get data.
 */
import {
  type AxisDef,
  CF_MD_LABELS,
  CF_SERVICES_LABELS,
  CS_BSP_LABELS,
  CS_MD_LABELS,
  CS_SERVICES_LABELS,
  type Provider,
} from "../../shared/vocab.js";
import { gaussian, pick, rng } from "./random.js";

export interface Observation {
  provider: Provider;
  axis: string;
  value: string;
  confidence: number;
  sourceUrl: string;
  sourceExcerpt: string;
}

interface FirmRef {
  firmId?: string | null;
  firmName?: string | null;
  firmType?: string | null;
  $primaryKey?: string;
}

const idOf = (f: FirmRef): string => f.$primaryKey ?? f.firmId ?? "";
const isCs = (f: FirmRef): boolean => (f.firmType ?? "").toLowerCase() === "cs";

const PROVIDERS: Readonly<
  Record<
    Provider,
    {
      label: string;
      axes: readonly string[];
      coverage: number;
      errorRate: number;
      conf: [number, number];
      host: string;
    }
  >
> = {
  beacondb: {
    label: "BeaconDB",
    axes: ["services_fit", "md_pedigree", "firm_age", "fee_generating_count"],
    coverage: 0.25,
    errorRate: 0.02,
    conf: [0.85, 0.97],
    host: "beacondb.example",
  },
  dealdb: {
    label: "Deal DB",
    axes: [
      "deal_size_usd_m",
      "deals_per_md_l3y",
      "firm_age",
      "fee_generating_count",
      "balance_sheet_principal",
    ],
    coverage: 0.7,
    errorRate: 0.1,
    conf: [0.7, 0.9],
    host: "dealdb.example",
  },
  filings: {
    label: "Filings",
    axes: [
      "advisory_conflict",
      "has_st_or_balance_sheet",
      "solvent",
      "firm_age",
      "balance_sheet_principal",
    ],
    coverage: 0.6,
    errorRate: 0.05,
    conf: [0.75, 0.92],
    host: "filings.example",
  },
  websearch: {
    label: "Web search",
    axes: ["services_fit", "md_pedigree", "web_activity", "deals_per_md_l3y"],
    coverage: 0.55,
    errorRate: 0.2,
    conf: [0.4, 0.75],
    host: "web.example",
  },
};

/** The firm's hidden true value for an axis (what a perfect analyst would find). */
export function truthFor(firm: FirmRef, axis: AxisDef): string {
  const r = rng(`truth|${idOf(firm)}|${axis.axis}`);
  const cs = isCs(firm);
  switch (axis.axis) {
    case "services_fit":
      return cs
        ? pick(r, CS_SERVICES_LABELS, [0.15, 0.45, 0.4])
        : pick(r, CF_SERVICES_LABELS, [0.1, 0.5, 0.4]);
    case "md_pedigree":
      return pick(r, cs ? CS_MD_LABELS : CF_MD_LABELS, [0.15, 0.5, 0.35]);
    case "balance_sheet_principal":
      return pick(r, CS_BSP_LABELS, [0.2, 0.4, 0.4]);
    case "deal_size_usd_m":
      return String(Math.max(5, Math.round(Math.exp(Math.log(60) + 0.8 * gaussian(r)))));
    case "deals_per_md_l3y":
      return (Math.round(r() * 60) / 10).toFixed(1);
    case "firm_age":
      return String(1 + Math.floor(r() * 30));
    case "fee_generating_count":
      return String(1 + Math.floor(r() * 8));
    case "advisory_conflict":
      return r() < 0.12 ? "true" : "false";
    case "has_st_or_balance_sheet":
      return r() < 0.1 ? "true" : "false";
    case "web_activity":
      return r() < 0.85 ? "true" : "false";
    case "solvent":
      return r() < 0.95 ? "true" : "false";
    default:
      throw new Error(`No truth model for axis ${axis.axis}`);
  }
}

function wrongValue(firm: FirmRef, axis: AxisDef, truth: string, r: () => number): string {
  if (axis.kind === "gate") {
    return truth === "true" ? "false" : "true";
  }
  if (axis.kind === "number") {
    const n = Number(truth) * (r() < 0.5 ? 0.4 + r() * 0.4 : 1.3 + r() * 0.6);
    return axis.axis === "deals_per_md_l3y" ? n.toFixed(1) : String(Math.max(1, Math.round(n)));
  }
  const cs = isCs(firm);
  const labels: readonly string[] =
    axis.axis === "services_fit"
      ? cs
        ? CS_SERVICES_LABELS
        : CF_SERVICES_LABELS
      : axis.axis === "md_pedigree"
        ? cs
          ? CS_MD_LABELS
          : CF_MD_LABELS
        : CS_BSP_LABELS;
  return pick(
    r,
    labels.filter((l) => l !== truth),
  );
}

/** What one provider reports for one firm and axis, or null if it has nothing. */
export function observe(provider: Provider, firm: FirmRef, axis: AxisDef): Observation | null {
  const p = PROVIDERS[provider];
  if (!p.axes.includes(axis.axis)) {
    return null;
  }
  const r = rng(`obs|${provider}|${idOf(firm)}|${axis.axis}`);
  if (r() > p.coverage) {
    return null;
  }
  const truth = truthFor(firm, axis);
  const value = r() < p.errorRate ? wrongValue(firm, axis, truth, r) : truth;
  const confidence = Math.round((p.conf[0] + r() * (p.conf[1] - p.conf[0])) * 100) / 100;
  return {
    provider,
    axis: axis.axis,
    value,
    confidence,
    sourceUrl: `https://${p.host}/firms/${encodeURIComponent(idOf(firm))}#${axis.axis}`,
    sourceExcerpt: `${p.label} lists ${axis.axis.replace(/_/g, " ")} for ${firm.firmName ?? "this firm"} as "${value}".`,
  };
}
