import { getDb } from "../server/db/client.js";
import { listLinked } from "../server/db/repo.js";
import { HttpError } from "../server/errors.js";
import { json, jsonError, readBody } from "../server/http.js";

const MAX_SOURCES = 2000;

export async function POST(request: Request): Promise<Response> {
  try {
    const { type, link, pks } = await readBody(request);
    if (
      typeof type !== "string" ||
      typeof link !== "string" ||
      !Array.isArray(pks) ||
      !pks.every((p) => typeof p === "string")
    ) {
      throw new HttpError("Expected { type: string, link: string, pks: string[] }");
    }
    if (pks.length > MAX_SOURCES) {
      throw new HttpError(`At most ${MAX_SOURCES} source objects per request`);
    }
    return json({ data: await listLinked(await getDb(), type, link, pks as string[]) });
  } catch (e) {
    return jsonError(e);
  }
}
