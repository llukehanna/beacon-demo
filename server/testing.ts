import { randomUUID } from "node:crypto";
import type { ActionName, ObjectOf, Props } from "../shared/schema.js";
import { type ApplyOptions, applyAction } from "./actions/apply.js";
import type { ActionResult } from "./actions/types.js";
import { type Db, createPgliteDb } from "./db/client.js";
import { ddl } from "./db/ddl.js";
import { getObject, insertObject } from "./db/repo.js";

/** Fixed clock for action tests. */
export const T0 = new Date("2026-09-01T12:00:00.000Z");

/** A CF firm that scores 18/18, tier A, under rubric v2. */
export const STRONG_CF: Props<"Firm"> = {
  firmType: "CF",
  coverageModel: "Single-sector focus",
  servicesFit: "Full advisory suite",
  mdPedigree: "Bulge-bracket or elite-boutique alumni",
  geoScore: 2,
  dealSizeMUsd: 200,
  dealsPerMdL3y: 5,
  firmAge: 15,
  employees: 20,
  feeGeneratingCount: 4,
};

/** Fresh in-memory Postgres with the full schema. One per test. */
export async function createTestDb(): Promise<Db> {
  const db = await createPgliteDb();
  await db.exec(ddl());
  return db;
}

export async function seedFirm(db: Db, overrides: Props<"Firm"> = {}): Promise<ObjectOf<"Firm">> {
  const firmId = overrides.firmId ?? `firm-${randomUUID().slice(0, 8)}`;
  await insertObject(db, "Firm", {
    firmName: "Test Advisors",
    firmType: "CF",
    hqCountry: "United States",
    geography: "US",
    geographicFootprint: "US",
    geoScore: 2,
    sector: "Software",
    employees: 25,
    coverageModel: "Single-sector focus",
    lifecycleState: "In Review",
    currentStage: "In Review",
    ...overrides,
    firmId,
  });
  return (await getObject(db, "Firm", firmId))!;
}

export function run(
  db: Db,
  name: ActionName,
  params: Record<string, unknown>,
  opts: ApplyOptions = {},
): Promise<ActionResult> {
  return applyAction(db, name, params, { now: T0, ...opts });
}
