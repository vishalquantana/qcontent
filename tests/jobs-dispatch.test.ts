import { describe, it, expect, beforeAll } from "vitest";
import { randomUUID, randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMigrations } from "../src/db/migrate.js";
import { makeDb } from "../src/db/client.js";
import { brands, sites, schedules } from "../src/db/schema.js";
import { eq } from "drizzle-orm";
import { tick } from "../src/scheduler/worker.js";
import { registerJob, knownJobTypes } from "../src/jobs/index.js";

const URL = `file:${join(tmpdir(), `qcontent-dispatch-test-${randomUUID()}.db`)}`;
let siteId: string;
beforeAll(async () => {
  process.env.QCONTENT_MASTER_KEY = randomBytes(32).toString("base64");
  await runMigrations(URL);
  const db = makeDb(URL);
  const bid = randomUUID();
  siteId = randomUUID();
  await db.insert(brands).values({ id: bid, name: "B", slug: "b-disp" });
  await db.insert(sites).values({ id: siteId, brandId: bid, name: "S", slug: "s-disp", adapterType: "webhook" });
});

describe("dispatcher + scheduler", () => {
  it("knows all Phase 4 job types", () => {
    const types = knownJobTypes();
    for (const t of ["generate", "reindex", "maintain-links", "refresh", "distribute-social"]) {
      expect(types).toContain(t);
    }
  });

  it("tick dispatches a due schedule of an arbitrary job type via runJob", async () => {
    const db = makeDb(URL);
    let called: { jobType: string; siteId: string } | null = null;
    registerJob("test-job", async (_db, a) => { called = { jobType: "test-job", siteId: a.siteId }; return { status: "ok" }; });
    await db.insert(schedules).values({ id: randomUUID(), siteId, jobType: "test-job", cron: "0 9 * * *", enabled: 1, nextRunAt: new Date(Date.now() - 60000) });

    await tick(db, new Date());
    expect(called).not.toBeNull();
    expect(called!.jobType).toBe("test-job");

    const rows = await db.select().from(schedules).where(eq(schedules.jobType, "test-job"));
    expect(rows[0]!.nextRunAt).not.toBeNull();
  });
});
