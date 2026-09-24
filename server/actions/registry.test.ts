import { describe, expect, it } from "vitest";
import { ACTION_NAMES } from "../../shared/schema.js";
import { ACTIONS } from "./registry.js";

describe("action registry", () => {
  it("implements every action the frontend can call", () => {
    expect(ACTION_NAMES.filter((n) => ACTIONS[n] === undefined)).toEqual([]);
  });
});
