import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { PREDICATE_AXES } from "../../shared/predicate.js";
import { OPERATORS } from "../../shared/vocab.js";
import type { Clusterer, RejectionRow, RuleProposal } from "./types.js";

export const CLUSTER_MODEL = "claude-opus-5";

const SYSTEM = `You help a corporate development team learn from its own decisions.

You will receive the rejections an analyst has made while screening advisory firms as acquisition targets. Each has the analyst's rationale in their own words and the firm's known facts.

Find recurring reasons that a simple, deterministic screen could have caught before the analyst spent time on the firm. For each one, propose a single predicate on one firm fact, plus the ids of the rejections it explains.

A good proposal:
- is supported by at least four rejections whose rationale AND facts both point to it
- uses a threshold that separates those firms cleanly (round numbers an analyst would write)
- has a one-sentence summary an analyst could read on a card

Propose nothing when there is no clear pattern; an empty list is a good answer. Every proposal is checked against the data and reviewed by a human before it screens anything.`;

const OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["rules"],
  properties: {
    rules: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "predicateAxis",
          "ruleOperator",
          "ruleThreshold",
          "ruleModel",
          "summary",
          "supportingDecisionIds",
        ],
        properties: {
          predicateAxis: { type: "string", enum: [...PREDICATE_AXES] },
          ruleOperator: { type: "string", enum: [...OPERATORS] },
          ruleThreshold: { type: "string" },
          ruleModel: { type: "string", enum: ["CF", "CS", "both"] },
          summary: { type: "string" },
          supportingDecisionIds: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
} as const;

const ProposalsSchema = z.object({
  rules: z.array(
    z.object({
      predicateAxis: z.string(),
      ruleOperator: z.string(),
      ruleThreshold: z.string(),
      ruleModel: z.enum(["CF", "CS", "both"]),
      summary: z.string(),
      supportingDecisionIds: z.array(z.string()),
    }),
  ),
});

const FACTS = [
  "firmType",
  "employees",
  "dealSizeMUsd",
  "dealsPerMdL3y",
  "firmAge",
  "feeGeneratingCount",
  "geoScore",
  "coverageModel",
] as const;

/** One JSON object per line: decision id, rationale, and the facts a predicate can use. */
export function renderRejections(rows: readonly RejectionRow[]): string {
  const lines = rows.map((r) =>
    JSON.stringify({
      decisionId: r.decisionId,
      rationale: r.rationale,
      facts: Object.fromEntries(
        FACTS.filter((k) => r.firm[k] !== undefined).map((k) => [k, r.firm[k]]),
      ),
    }),
  );
  return `Predicate facts map to axes: employees→employees, dealSizeMUsd→deal_size_usd_m, dealsPerMdL3y→deals_per_md_l3y, firmAge→firm_age, feeGeneratingCount→fee_generating_count, geoScore→geo_score, coverageModel→coverage_model.\n\nRejections:\n${lines.join("\n")}`;
}

interface MessageLike {
  stop_reason: string | null;
  content: ReadonlyArray<{ type: string; text?: string }>;
}

export function parseClusterResponse(message: MessageLike): RuleProposal[] {
  if (message.stop_reason !== "end_turn") {
    throw new Error(`Clustering did not complete (stop_reason: ${message.stop_reason})`);
  }
  const text = message.content
    .flatMap((b) => (b.type === "text" && typeof b.text === "string" ? [b.text] : []))
    .join("");
  return ProposalsSchema.parse(JSON.parse(text)).rules;
}

export function createClaudeClusterer(client: Anthropic = new Anthropic()): Clusterer {
  return async (rows) => {
    const message = await client.beta.messages.create({
      model: CLUSTER_MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      thinking: { type: "adaptive" },
      output_config: { format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
      system: SYSTEM,
      messages: [{ role: "user", content: renderRejections(rows) }],
    });
    return { proposals: parseClusterResponse(message), source: "claude" };
  };
}
