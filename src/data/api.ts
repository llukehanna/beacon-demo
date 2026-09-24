import { type WireObject, serializeParams } from "./wire";

export type { WireObject } from "./wire";

export class ActionFailedError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ActionFailedError";
  }
}

async function readJson<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as { error?: unknown };
  if (!res.ok) {
    throw new ActionFailedError(
      typeof body.error === "string" ? body.error : `HTTP ${res.status}`,
      res.status,
    );
  }
  return body as T;
}

export interface ObjectQuery {
  where?: Record<string, { $eq: unknown }>;
  orderBy?: Record<string, "asc" | "desc">;
}

export async function fetchObjects(type: string, q: ObjectQuery = {}): Promise<WireObject[]> {
  const params = new URLSearchParams({ type });
  if (q.where) {
    params.set("where", JSON.stringify(q.where));
  }
  if (q.orderBy) {
    params.set("orderBy", JSON.stringify(q.orderBy));
  }
  const body = await readJson<{ data: WireObject[] }>(
    await fetch(`/api/objects?${params.toString()}`),
  );
  return body.data;
}

export async function fetchLinks(
  type: string,
  link: string,
  pks: string[],
): Promise<Record<string, WireObject[]>> {
  const res = await fetch("/api/links", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type, link, pks }),
  });
  return (await readJson<{ data: Record<string, WireObject[]> }>(res)).data;
}

export interface ActionResponse {
  created?: string[];
  modified?: string[];
  note?: string;
}

export async function postAction(
  action: string,
  params: Record<string, unknown>,
): Promise<ActionResponse> {
  const res = await fetch("/api/actions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, params: serializeParams(params) }),
  });
  return readJson<ActionResponse>(res);
}

export async function resetDemo(): Promise<{ firms: number }> {
  return readJson<{ firms: number }>(await fetch("/api/reset", { method: "POST" }));
}
