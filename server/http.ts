import { HttpError } from "./errors.js";

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

/** Known errors keep their status and message; anything else is logged and hidden. */
export function jsonError(e: unknown): Response {
  if (e instanceof HttpError) {
    return json({ error: e.message }, e.status);
  }
  // Postgres class 22 (data exception): a filter value of the wrong type, e.g. {"employees": {"$eq": "abc"}}.
  const code = (e as { code?: unknown } | null)?.code;
  if (typeof code === "string" && code.startsWith("22")) {
    return json({ error: "A value has the wrong type for its property" }, 400);
  }
  // Class 40 (deadlock, serialization failure): two actions raced on the same objects.
  if (typeof code === "string" && code.startsWith("40")) {
    return json(
      { error: "Another change touched this record at the same moment. Try again." },
      409,
    );
  }
  // Operational signal for the server log: unexpected errors are hidden from the caller.
  // eslint-disable-next-line no-console
  console.error(e);
  return json({ error: "Internal error" }, 500);
}

export async function readBody(request: Request): Promise<Record<string, unknown>> {
  let v: unknown;
  try {
    v = await request.json();
  } catch {
    throw new HttpError("Request body must be JSON");
  }
  if (v === null || typeof v !== "object" || Array.isArray(v)) {
    throw new HttpError("Request body must be a JSON object");
  }
  return v as Record<string, unknown>;
}

export function jsonParam(url: URL, name: string): unknown {
  const raw = url.searchParams.get(name);
  if (raw === null) {
    return undefined;
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(`Query parameter "${name}" must be JSON`);
  }
}
