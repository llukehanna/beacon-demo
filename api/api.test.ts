import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Db, overrideDb } from "../server/db/client.js";
import { setMeta } from "../server/db/meta.js";
import { STRONG_CF, createTestDb, seedFirm } from "../server/testing.js";
import { POST as actions } from "./actions.js";
import { POST as links } from "./links.js";
import { GET as objects } from "./objects.js";
import { POST as resetButton, GET as resetCron } from "./reset.js";

let db: Db;

const req = (path: string, init?: RequestInit) => new Request(`http://localhost${path}`, init);
const post = (path: string, body: unknown) =>
  req(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(async () => {
  db = await createTestDb();
  overrideDb(db);
  await seedFirm(db, { firmId: "f1", firmName: "Alpha", ...STRONG_CF });
  await db.query(`INSERT INTO search_list_firm ("searchId", "firmId") VALUES ('L1', 'f1')`);
});

afterEach(() => vi.unstubAllEnvs());

describe("/api/objects", () => {
  it("lists objects with identity fields", async () => {
    const res = await objects(req("/api/objects?type=Firm"));
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data[0]).toMatchObject({ $apiName: "Firm", $primaryKey: "f1", firmName: "Alpha" });
  });

  it("filters by $eq and rejects bad input", async () => {
    const miss = encodeURIComponent(JSON.stringify({ firmName: { $eq: "Nope" } }));
    expect(
      (await (await objects(req(`/api/objects?type=Firm&where=${miss}`))).json()).data,
    ).toEqual([]);
    expect((await objects(req("/api/objects?type=Secrets"))).status).toBe(404);
    const gt = encodeURIComponent(JSON.stringify({ firmName: { $gt: "A" } }));
    expect((await objects(req(`/api/objects?type=Firm&where=${gt}`))).status).toBe(400);
    expect((await objects(req(`/api/objects?type=Firm&where=%7Bnot-json`))).status).toBe(400);
    const wrongType = encodeURIComponent(JSON.stringify({ employees: { $eq: "abc" } }));
    expect((await objects(req(`/api/objects?type=Firm&where=${wrongType}`))).status).toBe(400);
  });
});

describe("/api/actions", () => {
  it("applies an action", async () => {
    const res = await actions(
      post("/api/actions", { action: "qualifyFirm", params: { firm: "f1" } }),
    );
    expect(res.status).toBe(200);
    const { data } = await (await objects(req("/api/objects?type=Firm"))).json();
    expect(data[0].lifecycleState).toBe("Qualified");
  });

  it("returns readable errors", async () => {
    const bad = await actions(
      post("/api/actions", { action: "rejectFirm", params: { firm: "f1" } }),
    );
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toMatch(/rejectionRationale/);
    expect((await actions(post("/api/actions", { action: "nope", params: {} }))).status).toBe(404);
  });
});

describe("/api/links", () => {
  it("traverses a link for many sources", async () => {
    const { data } = await (
      await links(post("/api/links", { type: "SearchList", link: "firms", pks: ["L1", "L2"] }))
    ).json();
    expect(data.L1[0].$primaryKey).toBe("f1");
    expect(data.L2).toEqual([]);
  });
});

describe("/api/reset", () => {
  it("throttles both the cron and the button to one reset per window", async () => {
    await setMeta(db, "lastResetAt", new Date().toISOString());
    expect((await resetCron()).status).toBe(429);
    expect((await resetButton()).status).toBe(429);
  });

  it("requires CRON_SECRET on the cron GET when it is set; the button stays public", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    await setMeta(db, "lastResetAt", new Date().toISOString());
    expect((await resetCron(req("/api/reset"))).status).toBe(401);
    const authed = req("/api/reset", { headers: { authorization: "Bearer s3cret" } });
    expect((await resetCron(authed)).status).toBe(429); // past auth, stopped by the throttle
    expect((await resetButton()).status).toBe(429);
  });

  it("lets exactly one of two concurrent resets through", async () => {
    const statuses = (await Promise.all([resetButton(), resetCron()])).map((r) => r.status).sort();
    expect(statuses).toEqual([200, 429]);
  }, 300_000);
});
