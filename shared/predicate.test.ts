import { describe, expect, it } from "vitest";
import { matchesPredicate, predicateField, ruleKey } from "./predicate.js";

describe("matchesPredicate", () => {
  const firm = { firmType: "CF", employees: 6, coverageModel: "Generalist", geoScore: 1 };

  it("compares numerically when both sides are numbers", () => {
    expect(matchesPredicate(firm, { axis: "employees", operator: "<", threshold: "10" })).toBe(
      true,
    );
    expect(matchesPredicate(firm, { axis: "employees", operator: ">=", threshold: "10" })).toBe(
      false,
    );
    expect(matchesPredicate(firm, { axis: "geo_score", operator: "<", threshold: "2" })).toBe(true);
  });

  it("compares strings case-insensitively for == and !=", () => {
    expect(
      matchesPredicate(firm, { axis: "coverage_model", operator: "==", threshold: "generalist" }),
    ).toBe(true);
    expect(
      matchesPredicate(firm, { axis: "coverage_model", operator: "!=", threshold: "Generalist" }),
    ).toBe(false);
  });

  it("never screens a firm that is missing the value", () => {
    expect(
      matchesPredicate({ firmType: "CF" }, { axis: "employees", operator: "<", threshold: "10" }),
    ).toBe(false);
  });

  it("respects the rule's model scope", () => {
    const p = { axis: "employees", operator: "<", threshold: "10" };
    expect(matchesPredicate(firm, { ...p, model: "CS" })).toBe(false);
    expect(matchesPredicate(firm, { ...p, model: "both" })).toBe(true);
  });

  it("rejects unknown axes and operators", () => {
    expect(predicateField("vibes")).toBeNull();
    expect(matchesPredicate(firm, { axis: "employees", operator: "~", threshold: "10" })).toBe(
      false,
    );
  });

  it("builds a stable identity key", () => {
    expect(ruleKey("employees", "<", " 10 ", "Both")).toBe("employees|<|10|both");
  });
});
