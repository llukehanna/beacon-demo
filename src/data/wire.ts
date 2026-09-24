/** Pure helpers between the hooks and the HTTP API (kept React-free for tests). */

export type WireObject = Record<string, unknown> & { $apiName: string; $primaryKey: string };

export function isWireObject(v: unknown): v is WireObject {
  return typeof v === "object" && v !== null && "$primaryKey" in v && "$apiName" in v;
}

/** Action params travel as JSON; object references travel as primary keys. */
export function serializeParams(params: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) {
      continue;
    }
    out[k] = isWireObject(v) ? v.$primaryKey : v;
  }
  return out;
}

export function toLinkMap(
  data: Record<string, WireObject[]> | undefined,
): Map<string, WireObject[]> {
  return new Map(Object.entries(data ?? {}));
}

/** TanStack reports "no error" as null; the pages compare against undefined. */
export function normalizeError(e: Error | null): Error | undefined {
  return e ?? undefined;
}
