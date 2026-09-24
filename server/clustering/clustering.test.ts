import type Anthropic from "@anthropic-ai/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyAction } from "../actions/apply.js";
import { getMeta } from "../db/meta.js";
import { createTestDb } from "../testing.js";
import { CLAUDE_COOLDOWN_MS, chooseClusterer } from "./choose.js";
import { createClaudeClusterer, parseClusterResponse, renderRejections } from "./claude.js";
import { heuristicClusterer } from "./heuristic.js";
import type { Clusterer, RejectionRow } from "./types.js";

const rows: RejectionRow[] = [
  {
    decisionId: "d1",
    firmId: "f1",
    rationale: "Too small — 6 staff.",
    firm: { firmType: "CF", employees: 6 },
  },
];

const reply = (text: string, stop_reason = "end_turn") => ({
  stop_reason,
  content: [{ type: "text", text }],
});
const goodJson = JSON.stringify({
  rules: [
    {
      predicateAxis: "employees",
      ruleOperator: "<",
      ruleThreshold: "10",
      ruleModel: "both",
      summary: "Small firms.",
      supportingDecisionIds: ["d1"],
    },
  ],
});

afterEach(() => vi.unstubAllEnvs());

describe("Claude clusterer", () => {
  it("renders rejections with their decision ids and firm facts", () => {
    const text = renderRejections(rows);
    expect(text).toContain('"decisionId":"d1"');
    expect(text).toContain('"employees":6');
  });

  it("parses structured output and refuses anything else", () => {
    expect(parseClusterResponse(reply(goodJson))[0].predicateAxis).toBe("employees");
    expect(() => parseClusterResponse(reply(goodJson, "refusal"))).toThrow(/refusal/);
    expect(() => parseClusterResponse(reply("not json"))).toThrow();
    expect(() => parseClusterResponse(reply(JSON.stringify({ rules: [{ nope: 1 }] })))).toThrow();
  });

  it("calls claude-opus-5 with a JSON schema and refusal fallbacks", async () => {
    const create = vi.fn(async (_req: unknown) => reply(goodJson));
    const client = { beta: { messages: { create } } } as unknown as Anthropic;
    const out = await createClaudeClusterer(client)(rows);
    expect(out.source).toBe("claude");
    const req = create.mock.calls[0][0] as Record<string, unknown>;
    expect(req.model).toBe("claude-opus-5");
    expect(req.fallbacks).toBe("default");
    expect((req.output_config as { format: { type: string } }).format.type).toBe("json_schema");
  });
});

describe("chooseClusterer", () => {
  it("uses the heuristic unless CLAUDE_CLUSTERING=on", async () => {
    const db = await createTestDb();
    expect(await chooseClusterer(db, new Date())).toBe(heuristicClusterer);
  });

  it("throttles Claude to one call per cooldown window", async () => {
    vi.stubEnv("CLAUDE_CLUSTERING", "on");
    const db = await createTestDb();
    const fake: Clusterer = async () => ({ proposals: [], source: "claude" });
    const t = new Date("2026-09-22T12:00:00Z");
    expect((await (await chooseClusterer(db, t, () => fake))(rows)).source).toBe("claude");
    expect(await chooseClusterer(db, new Date(t.getTime() + 60_000), () => fake)).toBe(
      heuristicClusterer,
    );
  });

  it("falls back to the heuristic when Claude fails", async () => {
    vi.stubEnv("CLAUDE_CLUSTERING", "on");
    const db = await createTestDb();
    const broken: Clusterer = async () => {
      throw new Error("no credentials");
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const out = await (await chooseClusterer(db, new Date(), () => broken))(rows);
    expect(out.source).toBe("heuristic");
    expect(warn).toHaveBeenCalled();
  });

  it("claims the window outside the action's transaction", async () => {
    vi.stubEnv("CLAUDE_CLUSTERING", "on");
    const db = await createTestDb();
    const t = new Date("2026-09-22T12:00:00Z");
    // No rejections yet, so the action returns before any clusterer runs.
    await applyAction(db, "clusterRejections", {}, { now: t });
    expect(await getMeta(db, "lastClaudeClusterAt")).toBe(t.toISOString());
    await expect(
      db.transaction(async (tx) => {
        await chooseClusterer(tx, new Date(t.getTime() + CLAUDE_COOLDOWN_MS));
        throw new Error("rolled back");
      }),
    ).rejects.toThrow();
    expect(await getMeta(db, "lastClaudeClusterAt")).toBe(t.toISOString());
    expect(await chooseClusterer(db, new Date(t.getTime() + CLAUDE_COOLDOWN_MS - 1))).toBe(
      heuristicClusterer,
    );
    expect(await chooseClusterer(db, new Date(t.getTime() + CLAUDE_COOLDOWN_MS))).not.toBe(
      heuristicClusterer,
    );
  });
});
