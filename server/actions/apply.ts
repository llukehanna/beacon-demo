import { randomUUID } from "node:crypto";
import { isActionName } from "../../shared/schema.js";
import { USER } from "../../shared/vocab.js";
import { chooseClusterer } from "../clustering/choose.js";
import type { Clusterer } from "../clustering/types.js";
import type { Db } from "../db/client.js";
import { ActionError } from "../errors.js";
import { resolveParams } from "./params.js";
import { ACTIONS } from "./registry.js";
import type { ActionResult } from "./types.js";

/** Tables that only grow as people use the demo (append-only history and proposals). */
const ACTIVITY_TABLES = [
  "research_finding",
  "qualification_score",
  "review_decision",
  "drift_event",
  "proposed_rule",
  "hard_screen_config",
];
/** About 10× a fresh seed: room to play, but a script can't bloat every page's fetch before the nightly reset. */
export const MAX_ACTIVITY_ROWS = 10_000;

export interface ApplyOptions {
  now?: Date;
  user?: string;
  newId?: (prefix: string) => string;
  clusterer?: Clusterer;
  /** Tests: override MAX_ACTIVITY_ROWS. */
  maxActivityRows?: number;
}

const defaultId = (prefix: string): string => `${prefix}-${randomUUID()}`;

/** Validate and run one named action inside a single transaction. */
export async function applyAction(
  db: Db,
  name: string,
  raw: unknown,
  opts: ApplyOptions = {},
): Promise<ActionResult> {
  const def = isActionName(name) ? ACTIONS[name] : undefined;
  if (!def) {
    throw new ActionError(`Unknown action "${name}"`, 404);
  }
  const limit = opts.maxActivityRows ?? MAX_ACTIVITY_ROWS;
  const [{ n }] = await db.query<{ n: number }>(
    `SELECT (${ACTIVITY_TABLES.map((t) => `(SELECT count(*) FROM ${t})`).join(" + ")})::int AS n`,
  );
  if (n >= limit) {
    throw new ActionError("The demo has filled up with activity. Reset it to start fresh.", 409);
  }
  const now = opts.now ?? new Date();
  // Outside the transaction: the cost-guard claim must not roll back with the action.
  const clusterer =
    opts.clusterer ?? (def.needsClusterer ? await chooseClusterer(db, now) : undefined);
  return db.transaction(async (tx) => {
    const params = await resolveParams(tx, def.params, raw);
    return def.run(
      {
        tx,
        now,
        user: opts.user ?? USER,
        newId: opts.newId ?? defaultId,
        clusterer,
      },
      params,
    );
  });
}
