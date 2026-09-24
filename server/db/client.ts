import { mkdir } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { ddl } from "./ddl.js";

export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
}

export interface Db extends Queryable {
  exec(sql: string): Promise<void>;
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/**
 * In-process Postgres (WASM): in-memory without a dataDir (tests), persisted
 * under .data/ for local dev. Imported lazily so deployed functions, which
 * use DATABASE_URL, never load the WASM bundle.
 */
export async function createPgliteDb(dataDir?: string): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  const lite = dataDir ? new PGlite(dataDir) : new PGlite();
  await lite.waitReady;
  return {
    async query<T>(sql: string, params: unknown[] = []) {
      return (await lite.query<T>(sql, params)).rows;
    },
    async exec(sql: string) {
      await lite.exec(sql);
    },
    transaction<T>(fn: (tx: Queryable) => Promise<T>) {
      return lite.transaction((tx) =>
        fn({
          async query<R>(sql: string, params: unknown[] = []) {
            return (await tx.query<R>(sql, params)).rows;
          },
        }),
      );
    },
    close: () => lite.close(),
  };
}

/** Hosted Postgres (Neon in production) over node-postgres. */
export function createPgDb(connectionString: string): Db {
  const pool = new pg.Pool({ connectionString, max: 3 });
  return {
    async query<T>(sql: string, params: unknown[] = []) {
      return (await pool.query(sql, params)).rows as T[];
    },
    async exec(sql: string) {
      await pool.query(sql);
    },
    async transaction<T>(fn: (tx: Queryable) => Promise<T>) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await fn({
          async query<R>(sql: string, params: unknown[] = []) {
            return (await client.query(sql, params)).rows as R[];
          },
        });
        await client.query("COMMIT");
        return result;
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

declare global {
  // Survives Vite's SSR module reloads in dev so PGlite opens its directory once.
  // `var` is required here: TypeScript's `declare global` ambient blocks only allow `var`.
  var __beaconDb: Promise<Db> | undefined;
}

/** DATABASE_URL → Postgres; otherwise a PGlite database persisted under .data/. */
export function getDb(): Promise<Db> {
  globalThis.__beaconDb ??= (async () => {
    const url = process.env.DATABASE_URL;
    let db: Db;
    if (url) {
      db = createPgDb(url);
    } else {
      const dir = process.env.PGLITE_DIR ?? ".data/pglite";
      await mkdir(path.dirname(dir), { recursive: true }); // PGlite creates only the leaf directory
      db = await createPgliteDb(dir);
    }
    await db.exec(ddl());
    return db;
  })();
  return globalThis.__beaconDb;
}

/** Tests: route getDb() to a prepared database. */
export function overrideDb(db: Db): void {
  globalThis.__beaconDb = Promise.resolve(db);
}
