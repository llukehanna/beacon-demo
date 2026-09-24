import { getDb } from "../server/db/client.js";
import { claimWindow, getMeta } from "../server/db/meta.js";
import { json, jsonError } from "../server/http.js";
import { resetDemo } from "../server/seed/reset.js";

const COOLDOWN_MS = 5 * 60_000;

/**
 * Reseed the shared demo. Resetting is already public (the demo bar has a
 * button), so there is no secret; one throttle protects both callers.
 */
async function throttledReset(): Promise<Response> {
  try {
    const db = await getDb();
    // One atomic claim, before the slow part: concurrent resets would interleave and half-seed the demo.
    if (!(await claimWindow(db, "lastResetAt", new Date(), COOLDOWN_MS))) {
      return json({ error: "The demo was reset in the last few minutes. Try again shortly." }, 429);
    }
    const claimedAt = await getMeta(db, "lastResetAt");
    try {
      return json(await resetDemo(db));
    } catch (e) {
      // The reset rolled back; free the slot so it can be retried right away.
      await db.query(`DELETE FROM meta WHERE key = 'lastResetAt' AND value = $1`, [claimedAt]);
      throw e;
    }
  } catch (e) {
    return jsonError(e);
  }
}

/**
 * Vercel Cron (nightly). When CRON_SECRET is set, Vercel sends it as a bearer
 * token; requiring it keeps crawlers and link prefetchers from resetting the demo.
 */
export async function GET(request?: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (secret && request?.headers.get("authorization") !== `Bearer ${secret}`) {
    return json({ error: "Unauthorized" }, 401);
  }
  return throttledReset();
}

/** The demo bar's Reset button. */
export function POST(): Promise<Response> {
  return throttledReset();
}
