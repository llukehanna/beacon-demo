import { getDb } from "../server/db/client.js";
import { resetDemo } from "../server/seed/reset.js";

const started = Date.now();
const db = await getDb();
const { firms } = await resetDemo(db);
const target = process.env.DATABASE_URL ? "DATABASE_URL" : ".data/pglite";
console.log(
  `Seeded ${firms} firms and their history into ${target} in ${((Date.now() - started) / 1000).toFixed(1)}s.`,
);
await db.close();
