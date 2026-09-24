import type { ObjectOf } from "../../shared/schema.js";
import { scoreFirm } from "../../shared/scoring.js";
import { type Selection, expandSelections, matchesSelection } from "../../shared/taxonomy.js";
import { REJECTED, firmIdFor } from "../../shared/vocab.js";
import { getObject, insertObject, insertObjects, listObjects } from "../db/repo.js";
import { ActionError } from "../errors.js";
import { type FirmObj, iso, requireObject } from "./common.js";
import { type ActionContext, defineAction } from "./types.js";

type MandateObj = ObjectOf<"Mandate">;

const BREADTH_CAP: Readonly<Record<string, number>> = {
  narrow: 20,
  standard: 30,
  broad: 40,
  exhaustive: Number.POSITIVE_INFINITY,
};

const norm = (s: string | undefined | null): string => (s ?? "").trim().toLowerCase();

/** Row ceilings for the shared public demo; the nightly reset clears them. */
export const MAX_MANDATES = 25;
export const MAX_SEARCHES = 50;

async function assertRoom(
  ctx: ActionContext,
  table: string,
  max: number,
  what: string,
): Promise<void> {
  const [{ n }] = await ctx.tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`);
  if (n >= max) {
    throw new ActionError(
      `The demo already holds ${max} ${what}. Reset the demo to start fresh.`,
      409,
    );
  }
}

function selectionOrThrow(values: readonly string[]): Selection {
  const sel = expandSelections(values);
  if (sel.unknown.length > 0) {
    throw new ActionError(`Unknown filter value(s): ${sel.unknown.join(", ")}`);
  }
  return sel;
}

export const runSearch = defineAction<{
  mandate: MandateObj;
  geographies?: string[];
  industries?: string[];
  seedFirms?: string[];
  exclusions?: string[];
  breadth?: string;
}>({
  params: {
    mandate: { type: { object: "Mandate" } },
    geographies: { type: "string[]", nullable: true },
    industries: { type: "string[]", nullable: true },
    seedFirms: { type: "string[]", nullable: true },
    exclusions: { type: "string[]", nullable: true },
    breadth: { type: "string", nullable: true },
  },
  async run(ctx, p) {
    const breadth = p.breadth ?? "standard";
    const cap = BREADTH_CAP[breadth];
    if (cap === undefined) {
      throw new ActionError(
        `Unknown breadth "${breadth}"; use ${Object.keys(BREADTH_CAP).join(", ")}`,
      );
    }
    const sel = selectionOrThrow([...(p.geographies ?? []), ...(p.industries ?? [])]);
    const archetype = p.mandate.archetype === "CS" ? "CS" : "CF";
    if (sel.firmTypes.size === 0) {
      sel.firmTypes.add(archetype);
    }

    await assertRoom(ctx, "search", MAX_SEARCHES, "searches");
    const searchId = ctx.newId("search");
    const all = await listObjects(ctx.tx, "Firm");
    const seeds: FirmObj[] = [];
    for (const name of p.seedFirms ?? []) {
      const hit = all.find((f) => norm(f.firmName) === norm(name));
      if (hit) {
        seeds.push(hit);
        continue;
      }
      const base = firmIdFor(name, "unknown");
      let firmId = base;
      let suffix = 2;
      while (await getObject(ctx.tx, "Firm", firmId)) {
        firmId = `${base}_${suffix}`;
        suffix += 1;
      }
      await insertObject(ctx.tx, "Firm", {
        firmId,
        firmName: name.trim(),
        source: "search_discovery",
        firmType: archetype,
        lifecycleState: "Discovered",
        currentStage: "Discovered",
        discoveredViaSearchId: searchId,
      });
      seeds.push(await requireObject(ctx, "Firm", firmId));
    }

    const excluded = new Set((p.exclusions ?? []).map(norm));
    const matches = all
      .filter(
        (f) =>
          f.lifecycleState !== REJECTED &&
          !excluded.has(norm(f.firmName)) &&
          !excluded.has(norm(f.$primaryKey)) &&
          matchesSelection(f, sel),
      )
      .map((f) => ({ f, s: scoreFirm(f).weightedTotal }))
      .sort((a, b) => b.s - a.s || (a.f.firmName ?? "").localeCompare(b.f.firmName ?? ""))
      .map((x) => x.f);
    const seen = new Set<string>();
    const chosen = [...seeds, ...matches]
      .filter((f) => !seen.has(f.$primaryKey) && seen.add(f.$primaryKey))
      .slice(0, cap);

    await insertObject(ctx.tx, "Search", {
      searchId,
      name: `${p.mandate.title ?? "Search"} · ${iso(ctx.now).slice(0, 10)}`,
      mandateId: p.mandate.$primaryKey,
      geographies: p.geographies ?? [],
      industries: p.industries ?? [],
      seedFirms: p.seedFirms ?? [],
      exclusions: p.exclusions ?? [],
      breadth,
      runAt: iso(ctx.now),
      runBy: ctx.user,
      status: "complete",
      resultCount: chosen.length,
    });
    await insertObjects(
      ctx.tx,
      "SearchMembership",
      chosen.map((f) => ({
        membershipId: `${searchId}:${f.$primaryKey}`,
        searchId,
        firmId: f.$primaryKey,
      })),
    );
    return { created: [searchId] };
  },
});

export const runMandateSearch = defineAction<{
  title: string;
  archetype: string;
  geographies?: string[];
  priority?: string;
  sizeMaxUsdM?: number;
}>({
  params: {
    title: { type: "string" },
    archetype: { type: "string" },
    geographies: { type: "string[]", nullable: true },
    priority: { type: "string", nullable: true },
    sizeMaxUsdM: { type: "integer", nullable: true },
  },
  async run(ctx, p) {
    const title = p.title.trim();
    if (title === "") {
      throw new ActionError("A mandate needs a title");
    }
    const archetype = p.archetype.trim().toUpperCase();
    if (archetype !== "CF" && archetype !== "CS") {
      throw new ActionError("Archetype must be CF or CS");
    }
    const sel = selectionOrThrow(p.geographies ?? []);
    sel.firmTypes.add(archetype);

    await assertRoom(ctx, "mandate", MAX_MANDATES, "mandates");
    const mandateId = ctx.newId("mandate");
    await insertObject(ctx.tx, "Mandate", {
      mandateId,
      title,
      intentStatement: title,
      archetype,
      priority: p.priority ?? "Medium",
      active: true,
      createdAt: iso(ctx.now),
      geographies: p.geographies ?? [],
      industries: [],
      products: [],
      sizeMaxUsdM: p.sizeMaxUsdM,
    });
    const firms = (await listObjects(ctx.tx, "Firm")).filter(
      (f) => f.lifecycleState !== REJECTED && matchesSelection(f, sel),
    );
    const listId = ctx.newId("list");
    await insertObject(ctx.tx, "SearchList", {
      searchId: listId,
      name: `${title} — universe`,
      mandateId,
      filtersJson: JSON.stringify({ archetype, geographies: p.geographies ?? [] }),
      resultCount: firms.length,
      requestedMore: false,
      createdAt: iso(ctx.now),
    });
    await ctx.tx.query(
      `INSERT INTO search_list_firm ("searchId", "firmId") SELECT $1, unnest($2::text[])`,
      [listId, firms.map((f) => f.$primaryKey)],
    );
    return { created: [mandateId, listId] };
  },
});
