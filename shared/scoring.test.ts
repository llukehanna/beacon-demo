import { describe, expect, it } from "vitest";
import { axisPoints, formatAxisValue, parseAxisValue, scoreFirm } from "./scoring.js";
import { axisByName, nextLifecycle } from "./vocab.js";

const STRONG_CF = {
  firmType: "CF",
  coverageModel: "Single-sector focus",
  servicesFit: "Full advisory suite",
  mdPedigree: "Bulge-bracket or elite-boutique alumni",
  geoScore: 2,
  dealSizeMUsd: 200,
  dealsPerMdL3y: 5,
  firmAge: 15,
  employees: 20,
  feeGeneratingCount: 4,
};

describe("scoreFirm (rubric v2 eval suite)", () => {
  it("CF fully enriched → A, 18", () => {
    const r = scoreFirm(STRONG_CF);
    expect([r.tier, r.weightedTotal, r.maxPossible, r.hardRejected]).toEqual(["A", 18, 18, false]);
  });

  it("CS fully enriched → A, 18", () => {
    const r = scoreFirm({
      ...STRONG_CF,
      firmType: "CS",
      balanceSheetPrincipal: "Advisory only",
      servicesFit: "Full private-capital suite",
      mdPedigree: "Senior credit / capital-markets pedigree",
    });
    expect([r.tier, r.weightedTotal]).toEqual(["A", 18]);
  });

  it("CS principal investor → hard reject", () => {
    expect(
      scoreFirm({
        ...STRONG_CF,
        firmType: "CS",
        balanceSheetPrincipal: "Invests its own balance sheet",
      }).hardRejected,
    ).toBe(true);
  });

  it("headcount has a sweet spot: 8–40 beats both smaller and larger", () => {
    const points = (employees: number) => scoreFirm({ ...STRONG_CF, employees }).weightedTotal;
    expect([points(5), points(20), points(300)]).toEqual([16, 18, 17]);
  });

  it("CF generalist → hard reject, 0", () => {
    const r = scoreFirm({ ...STRONG_CF, coverageModel: "Generalist" });
    expect([r.hardRejected, r.weightedTotal, r.tier]).toEqual([true, 0, "Rejected"]);
  });

  it("CF conflicted services → hard reject", () => {
    expect(
      scoreFirm({ ...STRONG_CF, servicesFit: "Conflicted: trading, lending or research" })
        .hardRejected,
    ).toBe(true);
  });

  it("CS advisory conflict → hard reject", () => {
    expect(scoreFirm({ ...STRONG_CF, firmType: "CS", advisoryConflict: true }).hardRejected).toBe(
      true,
    );
  });

  it("CF B tier at the outreach floor → B, 12, Outreach; one point lower → Follow", () => {
    const b = {
      ...STRONG_CF,
      servicesFit: "Adjacent advisory services",
      mdPedigree: "Mixed: industry or boutique banking",
      dealSizeMUsd: 50,
      dealsPerMdL3y: 3,
      firmAge: 8,
      feeGeneratingCount: 3,
    };
    const r = scoreFirm(b);
    expect([r.tier, r.weightedTotal, r.action]).toEqual(["B", 12, "Outreach"]);
    expect(scoreFirm({ ...b, feeGeneratingCount: 1 }).action).toBe("Follow");
  });

  it("unknown values score 0", () => {
    const r = scoreFirm({ firmType: "CS" });
    expect([r.weightedTotal, r.tier, r.confidence]).toEqual([0, "Rejected", 0]);
  });
});

describe("axis helpers", () => {
  const services = axisByName("services_fit")!;
  const dealSize = axisByName("deal_size_usd_m")!;
  const solvent = axisByName("solvent")!;

  it("parses values by axis kind", () => {
    expect(parseAxisValue(dealSize, "42.5")).toBe(42.5);
    expect(parseAxisValue(dealSize, "n/a")).toBeNull();
    expect(parseAxisValue(solvent, "Yes")).toBe(true);
    expect(parseAxisValue(solvent, "0")).toBe(false);
    expect(parseAxisValue(services, "  Full advisory suite ")).toBe("Full advisory suite");
    expect(formatAxisValue(true)).toBe("true");
  });

  it("scores one axis in isolation", () => {
    expect(axisPoints({ firmType: "CF" }, services, "Full advisory suite")).toBe(2);
    expect(
      axisPoints({ firmType: "CF" }, services, "Conflicted: trading, lending or research"),
    ).toBe(0);
    expect(axisPoints({ firmType: "CF" }, dealSize, 200)).toBe(2);
    expect(axisPoints({ firmType: "CF" }, dealSize, 150)).toBe(1);
    expect(axisPoints({ firmType: "CF" }, solvent, true)).toBeNull();
    expect(axisPoints({ firmType: "CF" }, services, "Something else")).toBeNull();
  });

  it("advances one lifecycle stage at a time", () => {
    expect(nextLifecycle("Discovered")).toBe("In Review");
    expect(nextLifecycle("Outreach")).toBe("In Talks");
    expect(nextLifecycle("In Talks")).toBeNull();
    expect(nextLifecycle("Qualified")).toBeNull();
  });
});
