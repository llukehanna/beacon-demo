import { applyAction } from "../server/actions/apply.js";
import { getDb } from "../server/db/client.js";
import { HttpError } from "../server/errors.js";
import { json, jsonError, readBody } from "../server/http.js";

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readBody(request);
    if (typeof body.action !== "string") {
      throw new HttpError("Expected { action: string, params: object }");
    }
    return json(await applyAction(await getDb(), body.action, body.params ?? {}));
  } catch (e) {
    return jsonError(e);
  }
}
