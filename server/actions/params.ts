import type { Queryable } from "../db/client.js";
import { getObject } from "../db/repo.js";
import { ActionError } from "../errors.js";
import type { ParamDef } from "./types.js";

/** Input bounds for a public demo: one visitor must not be able to bloat the shared database. */
export const MAX_STRING = 2000;
export const MAX_LIST = 50;
export const MAX_LIST_ITEM = 200;

/** Validate raw JSON params against a spec; object params (primary keys) are loaded. */
export async function resolveParams(
  tx: Queryable,
  spec: Readonly<Record<string, ParamDef>>,
  raw: unknown,
): Promise<Record<string, unknown>> {
  const input = raw ?? {};
  if (typeof input !== "object" || Array.isArray(input)) {
    throw new ActionError("Parameters must be an object");
  }
  const given = input as Record<string, unknown>;
  for (const k of Object.keys(given)) {
    if (!Object.prototype.hasOwnProperty.call(spec, k)) {
      throw new ActionError(`Unknown parameter "${k}"`);
    }
  }
  const out: Record<string, unknown> = {};
  for (const [name, def] of Object.entries(spec)) {
    const v = given[name];
    if (v === undefined || v === null) {
      if (!def.nullable) {
        throw new ActionError(`Missing required parameter "${name}"`);
      }
      out[name] = undefined;
      continue;
    }
    const t = def.type;
    if (typeof t === "object") {
      if (typeof v !== "string") {
        throw new ActionError(`"${name}" must be a ${t.object} primary key`);
      }
      // Locked for the action's transaction: concurrent actions on one object serialize.
      const obj = await getObject(tx, t.object, v, { forUpdate: true });
      if (!obj) {
        throw new ActionError(`${t.object} ${v} not found`, 404);
      }
      out[name] = obj;
    } else if (t === "string") {
      if (typeof v !== "string") {
        throw new ActionError(`"${name}" must be a string`);
      }
      if (v.length > MAX_STRING) {
        throw new ActionError(`"${name}" is longer than ${MAX_STRING} characters`);
      }
      out[name] = v;
    } else if (t === "integer") {
      if (!Number.isInteger(v)) {
        throw new ActionError(`"${name}" must be an integer`);
      }
      out[name] = v;
    } else if (t === "double") {
      if (typeof v !== "number" || !Number.isFinite(v)) {
        throw new ActionError(`"${name}" must be a number`);
      }
      out[name] = v;
    } else if (t === "boolean") {
      if (typeof v !== "boolean") {
        throw new ActionError(`"${name}" must be true or false`);
      }
      out[name] = v;
    } else if (t === "timestamp") {
      if (typeof v !== "string" || Number.isNaN(Date.parse(v))) {
        throw new ActionError(`"${name}" must be an ISO timestamp`);
      }
      out[name] = new Date(v).toISOString();
    } else {
      if (!Array.isArray(v) || !v.every((x) => typeof x === "string")) {
        throw new ActionError(`"${name}" must be a list of strings`);
      }
      if (v.length > MAX_LIST || v.some((x) => x.length > MAX_LIST_ITEM)) {
        throw new ActionError(
          `"${name}" allows at most ${MAX_LIST} items of up to ${MAX_LIST_ITEM} characters`,
        );
      }
      out[name] = v;
    }
  }
  return out;
}
