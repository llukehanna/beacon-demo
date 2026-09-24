import type { Queryable } from "../db/client.js";
import { claimDailyQuota, claimWindow } from "../db/meta.js";
import { createClaudeClusterer } from "./claude.js";
import { heuristicClusterer } from "./heuristic.js";
import type { Clusterer } from "./types.js";

/** Public demo cost guard: at most one Claude clustering call per window, across all visitors. */
export const CLAUDE_COOLDOWN_MS = 10 * 60_000;
/** Hard ceiling on daily spend, whatever the window allows. */
export const CLAUDE_DAILY_MAX = 24;
const LAST_CALL = "lastClaudeClusterAt";
const DAILY_CALLS = "claudeClusterCallsToday";

export async function chooseClusterer(
  q: Queryable,
  now: Date,
  create: () => Clusterer = () => createClaudeClusterer(),
): Promise<Clusterer> {
  if (process.env.CLAUDE_CLUSTERING !== "on") {
    return heuristicClusterer;
  }
  if (!(await claimWindow(q, LAST_CALL, now, CLAUDE_COOLDOWN_MS))) {
    return heuristicClusterer;
  }
  if (!(await claimDailyQuota(q, DAILY_CALLS, now, CLAUDE_DAILY_MAX))) {
    return heuristicClusterer;
  }
  return async (rows) => {
    try {
      return await create()(rows);
    } catch (e) {
      // Operational signal for the server log: the fallback is silent to the visitor.
      // eslint-disable-next-line no-console
      console.warn("Claude clustering unavailable; using the heuristic clusterer.", e);
      return heuristicClusterer(rows);
    }
  };
}
