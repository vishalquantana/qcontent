import { describe, it, expect, beforeAll } from "vitest";
import { randomUUID, randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMigrations } from "../src/db/migrate.js";
import { makeDb } from "../src/db/client.js";
import { brands, sites, schedules } from "../src/db/schema.js";
import { dueSchedules } from "../src/scheduler/worker.js";

const URL = `file:${join(tmpdir(), `qcontent-sched-test-${randomUUID()}.db`)}`;
let siteId: string;
beforeAll(async () => {
  process.env.QCONTENT_MASTER_KEY = randomBytes(32).toString("base64");
  await runMigrations(URL);
  const db = makeDb(URL);
  const bid = randomUUID();
  siteId = randomUUID();
  await db.insert(brands).values({ id: bid, name: "B", slug: "b-sched" });
  await db.insert(sites).values({ id: siteId, brandId: bid, name: "S", slug: "s-sched", adapterType: "webhook" });
});

describe("dueSchedules", () => {
  it("returns enabled schedules whose next_run_at is in the past or unset", async () => {
    const db = makeDb(URL);
    const past = new Date(Date.now() - 60_000);
    const future = new Date(Date.now() + 3_600_000);
    await db.insert(schedules).values({ id: randomUUID(), siteId, jobType: "generate", cron: "0 9 * * *", enabled: 1, nextRunAt: past });
    await db.insert(schedules).values({ id: randomUUID(), siteId, jobType: "generate", cron: "0 9 * * *", enabled: 1, nextRunAt: future });
    await db.insert(schedules).values({ id: randomUUID(), siteId, jobType: "generate", cron: "0 9 * * *", enabled: 0, nextRunAt: past });

    const due = await dueSchedules(db, new Date());
    expect(due).toHaveLength(1);
    expect(due[0]!.jobType).toBe("generate");
  });
});
