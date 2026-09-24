import type { Db, Queryable } from "../db/client.js";
import { OBJECT_TABLES, ddl } from "../db/ddl.js";
import { setMeta } from "../db/meta.js";
import { insertObjects } from "../db/repo.js";
import { seedHistory } from "./history.js";
import { generateUniverse } from "./universe.js";

export const HISTORY_DAYS = 30;

/** A Db whose transactions join an enclosing one, so the real action handlers can run inside it. */
function joined(tx: Queryable, db: Db): Db {
  return {
    query: (sql, params) => tx.query(sql, params),
    exec: () =>
      Promise.reject(
        new Error("exec (multi-statement SQL) is not available inside the reset transaction"),
      ),
    transaction: (fn) => fn(tx),
    close: () => db.close(),
  };
}

/**
 * Wipe every object table and rebuild the demo world in one transaction:
 * readers see the old world or the new one, never a half-seeded mix, and a
 * failure or timeout rolls back cleanly. It also saves a BEGIN/COMMIT round
 * trip per seeded action.
 */
export async function resetDemo(db: Db, now: Date = new Date()): Promise<{ firms: number }> {
  await db.exec(ddl());
  const universe = generateUniverse();
  await db.transaction(async (tx) => {
    await tx.query(`TRUNCATE ${[...OBJECT_TABLES, "search_list_firm"].join(", ")}`);
    await insertObjects(tx, "Firm", universe);
    await seedHistory(joined(tx, db), new Date(now.getTime() - HISTORY_DAYS * 86_400_000));
  });
  await setMeta(db, "lastResetAt", now.toISOString());
  return { firms: universe.length };
}
