import { getDb } from "../server/db/client.js";
import { type ListOptions, listObjects } from "../server/db/repo.js";
import { HttpError } from "../server/errors.js";
import { json, jsonError, jsonParam } from "../server/http.js";
import { isObjectTypeName } from "../shared/schema.js";

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const type = url.searchParams.get("type") ?? "";
    if (!isObjectTypeName(type)) {
      throw new HttpError(`Unknown object type "${type}"`, 404);
    }
    const data = await listObjects(await getDb(), type, {
      where: jsonParam(url, "where") as ListOptions["where"],
      orderBy: jsonParam(url, "orderBy") as ListOptions["orderBy"],
    });
    return json({ data });
  } catch (e) {
    return jsonError(e);
  }
}
