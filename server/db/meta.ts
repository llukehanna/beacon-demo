import type { Queryable } from "./client.js";

export async function getMeta(q: Queryable, key: string): Promise<string | null> {
  const rows = await q.query<{ value: string | null }>(`SELECT value FROM meta WHERE key = $1`, [
    key,
  ]);
  return rows[0]?.value ?? null;
}

export async function setMeta(q: Queryable, key: string, value: string): Promise<void> {
  await q.query(
    `INSERT INTO meta (key, value, "updatedAt") VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, "updatedAt" = now()`,
    [key, value],
  );
}

/**
 * Claim a throttle window atomically: stores `now` under `key` and returns
 * true only if the stored time is absent or at least `windowMs` old.
 * Concurrent callers serialize on the meta row, so only one of them wins.
 */
export async function claimWindow(
  q: Queryable,
  key: string,
  now: Date,
  windowMs: number,
): Promise<boolean> {
  const rows = await q.query<{ key: string }>(
    `INSERT INTO meta (key, value, "updatedAt") VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, "updatedAt" = now()
       WHERE meta.value IS NULL OR meta.value::timestamptz <= $3::timestamptz
     RETURNING key`,
    [key, now.toISOString(), new Date(now.getTime() - windowMs).toISOString()],
  );
  return rows.length > 0;
}

/**
 * Take one unit of a per-UTC-day quota atomically; false once `max` units
 * have been taken today. Stored as "YYYY-MM-DD:count" under `key`.
 */
export async function claimDailyQuota(
  q: Queryable,
  key: string,
  now: Date,
  max: number,
): Promise<boolean> {
  const day = now.toISOString().slice(0, 10);
  // CASE (not OR) so the ::int cast only runs on a well-formed value from today; anything else restarts the count.
  const today = `split_part(meta.value, ':', 1) = $2 AND split_part(meta.value, ':', 2) ~ '^[0-9]+$'`;
  const rows = await q.query<{ key: string }>(
    `INSERT INTO meta (key, value, "updatedAt") VALUES ($1, $2 || ':1', now())
     ON CONFLICT (key) DO UPDATE SET
       value = CASE WHEN ${today} THEN $2 || ':' || (split_part(meta.value, ':', 2)::int + 1) ELSE $2 || ':1' END,
       "updatedAt" = now()
       WHERE CASE WHEN ${today} THEN split_part(meta.value, ':', 2)::int < $3 ELSE true END
     RETURNING key`,
    [key, day, max],
  );
  return rows.length > 0;
}
