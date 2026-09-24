import {
  OBJECT_TYPES,
  type ObjectOf,
  type ObjectTypeName,
  type Props,
  findLink,
} from "../../shared/schema.js";
import { HttpError } from "../errors.js";
import type { Queryable } from "./client.js";

export interface ListOptions {
  where?: Record<string, { $eq: unknown }>;
  orderBy?: Record<string, "asc" | "desc">;
}

// Column names only ever come from the schema (checked below), never from input.
const col = (name: string): string => `"${name}"`;

function assertProps(type: ObjectTypeName, keys: readonly string[]): void {
  const props = OBJECT_TYPES[type].properties as Readonly<Record<string, unknown>>;
  for (const k of keys) {
    if (!Object.prototype.hasOwnProperty.call(props, k)) {
      throw new HttpError(`Unknown property "${k}" on ${type}`, 400);
    }
  }
}

/** DB row → wire object: nulls dropped, Dates as ISO strings, identity fields added. */
export function toWire<N extends ObjectTypeName>(
  type: N,
  row: Record<string, unknown>,
): ObjectOf<N> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (v === null || v === undefined) {
      continue;
    }
    out[k] = v instanceof Date ? v.toISOString() : v;
  }
  out.$apiName = type;
  out.$primaryKey = String(row[OBJECT_TYPES[type].primaryKey]);
  return out as ObjectOf<N>;
}

export async function insertObject<N extends ObjectTypeName>(
  q: Queryable,
  type: N,
  obj: Props<N>,
): Promise<void> {
  const def = OBJECT_TYPES[type];
  const entries = Object.entries(obj).filter(([, v]) => v !== undefined);
  assertProps(
    type,
    entries.map(([k]) => k),
  );
  const pk = entries.find(([k]) => k === def.primaryKey)?.[1];
  if (typeof pk !== "string" || pk === "") {
    throw new Error(`${type} insert is missing ${def.primaryKey}`);
  }
  await q.query(
    `INSERT INTO ${def.table} (${entries.map(([k]) => col(k)).join(", ")}) VALUES (${entries.map((_, i) => `$${i + 1}`).join(", ")})`,
    entries.map(([, v]) => v),
  );
}

/** Insert many rows in one statement (one round trip); the rows' own keys pick the columns. */
export async function insertObjects<N extends ObjectTypeName>(
  q: Queryable,
  type: N,
  objs: readonly Props<N>[],
): Promise<void> {
  if (objs.length === 0) {
    return;
  }
  const def = OBJECT_TYPES[type];
  const keys = [...new Set(objs.flatMap((o) => Object.keys(o)))];
  assertProps(type, keys);
  for (const o of objs) {
    const pk = (o as Record<string, unknown>)[def.primaryKey];
    if (typeof pk !== "string" || pk === "") {
      throw new Error(`${type} insert is missing ${def.primaryKey}`);
    }
  }
  const cols = keys.map(col).join(", ");
  await q.query(
    `INSERT INTO ${def.table} (${cols}) SELECT ${cols} FROM json_populate_recordset(NULL::${def.table}, $1::json)`,
    [JSON.stringify(objs)],
  );
}

export async function updateObject<N extends ObjectTypeName>(
  q: Queryable,
  type: N,
  pk: string,
  patch: Props<N>,
): Promise<void> {
  const def = OBJECT_TYPES[type];
  const entries = Object.entries(patch).filter(([k, v]) => v !== undefined && k !== def.primaryKey);
  assertProps(
    type,
    entries.map(([k]) => k),
  );
  if (entries.length === 0) {
    return;
  }
  const rows = await q.query(
    `UPDATE ${def.table} SET ${entries.map(([k], i) => `${col(k)} = $${i + 1}`).join(", ")} WHERE ${col(def.primaryKey)} = $${entries.length + 1} RETURNING ${col(def.primaryKey)}`,
    [...entries.map(([, v]) => v), pk],
  );
  if (rows.length === 0) {
    throw new HttpError(`${type} ${pk} not found`, 404);
  }
}

export async function getObject<N extends ObjectTypeName>(
  q: Queryable,
  type: N,
  pk: string,
  opts: { forUpdate?: boolean } = {},
): Promise<ObjectOf<N> | null> {
  const def = OBJECT_TYPES[type];
  const lock = opts.forUpdate ? " FOR UPDATE" : "";
  const rows = await q.query(
    `SELECT * FROM ${def.table} WHERE ${col(def.primaryKey)} = $1${lock}`,
    [pk],
  );
  return rows[0] ? toWire(type, rows[0]) : null;
}

export async function listObjects<N extends ObjectTypeName>(
  q: Queryable,
  type: N,
  opts: ListOptions = {},
): Promise<ObjectOf<N>[]> {
  const def = OBJECT_TYPES[type];
  const where = Object.entries(opts.where ?? {});
  assertProps(
    type,
    where.map(([k]) => k),
  );
  for (const [k, cond] of where) {
    if (typeof cond !== "object" || cond === null || Object.keys(cond).join() !== "$eq") {
      throw new HttpError(`Only {"$eq": value} filters are supported (property "${k}")`, 400);
    }
  }
  const order = Object.entries(opts.orderBy ?? {});
  assertProps(
    type,
    order.map(([k]) => k),
  );
  for (const [k, dir] of order) {
    if (dir !== "asc" && dir !== "desc") {
      throw new HttpError(`Sort direction for "${k}" must be asc or desc`, 400);
    }
  }
  const whereSql = where.length
    ? ` WHERE ${where.map(([k], i) => `${col(k)} = $${i + 1}`).join(" AND ")}`
    : "";
  const orderSql = [
    ...order.map(([k, d]) => `${col(k)} ${d.toUpperCase()} NULLS LAST`),
    `${col(def.primaryKey)} ASC`,
  ];
  const rows = await q.query(
    `SELECT * FROM ${def.table}${whereSql} ORDER BY ${orderSql.join(", ")}`,
    where.map(([, c]) => c.$eq),
  );
  return rows.map((r) => toWire(type, r));
}

/** Follow a join-table link for many sources in one query, keyed by source primary key. */
export async function listLinked(
  q: Queryable,
  source: string,
  linkName: string,
  pks: readonly string[],
): Promise<Record<string, ObjectOf<ObjectTypeName>[]>> {
  const link = findLink(source, linkName);
  if (!link) {
    throw new HttpError(`Unknown link ${source}.${linkName}`, 404);
  }
  const out: Record<string, ObjectOf<ObjectTypeName>[]> = Object.fromEntries(
    pks.map((pk) => [pk, []]),
  );
  if (pks.length === 0) {
    return out;
  }
  const target = OBJECT_TYPES[link.target];
  const rows = await q.query(
    `SELECT j.${col(link.sourceColumn)} AS "__source", t.* FROM ${link.joinTable} j
       JOIN ${target.table} t ON t.${col(target.primaryKey)} = j.${col(link.targetColumn)}
      WHERE j.${col(link.sourceColumn)} = ANY($1)
      ORDER BY t.${col(target.primaryKey)}`,
    [pks],
  );
  for (const { __source, ...rest } of rows) {
    (out[String(__source)] ??= []).push(toWire(link.target, rest));
  }
  return out;
}
