import { describe, it, expect, beforeAll } from "vitest";
import { randomUUID, randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMigrations } from "../src/db/migrate.js";
import { makeDb } from "../src/db/client.js";
import { brands, sites, runLogs } from "../src/db/schema.js";
import { startRun } from "../src/service/runs.js";
import { recordPublished, slugExists } from "../src/service/published.js";
import { eq } from "drizzle-orm";

const URL = `file:${join(tmpdir(), `qcontent-runs-test-${randomUUID()}.db`)}`;
let siteId: string;
beforeAll(async () => {
  process.env.QCONTENT_MASTER_KEY = randomBytes(32).toString("base64");
  await runMigrations(URL);
  const db = makeDb(URL);
  const bid = randomUUID();
  siteId = randomUUID();
  await db.insert(brands).values({ id: bid, name: "B", slug: "b-runs" });
  await db.insert(sites).values({ id: siteId, brandId: bid, name: "S", slug: "s-runs", adapterType: "webhook" });
});

describe("runs + published", () => {
  it("records a run with logs and finishes ok", async () => {
    const db = makeDb(URL);
    const run = await startRun(db, { siteId, jobType: "generate" });
    await run.log("info", "started", { foo: 1 });
    await run.finishOk({ slug: "x" });
    const logs = await db.select().from(runLogs).where(eq(runLogs.runId, run.id));
    expect(logs.length).toBeGreaterThanOrEqual(1);
  });

  it("records published content and detects existing slug", async () => {
    const db = makeDb(URL);
    expect(await slugExists(db, siteId, "my-post")).toBe(false);
    await recordPublished(db, { siteId, slug: "my-post", url: "https://x/my-post", title: "My Post" });
    expect(await slugExists(db, siteId, "my-post")).toBe(true);
  });
});
