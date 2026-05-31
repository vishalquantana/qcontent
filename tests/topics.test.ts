import { describe, it, expect, beforeAll } from "vitest";
import { randomUUID, randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMigrations } from "../src/db/migrate.js";
import { makeDb } from "../src/db/client.js";
import { brands, sites } from "../src/db/schema.js";
import { addTopic, popQueuedTopic } from "../src/service/topics.js";

const URL = `file:${join(tmpdir(), `qcontent-topics-test-${randomUUID()}.db`)}`;
let siteId: string;

beforeAll(async () => {
  process.env.QCONTENT_MASTER_KEY = randomBytes(32).toString("base64");
  await runMigrations(URL);
  const db = makeDb(URL);
  const bid = randomUUID();
  siteId = randomUUID();
  await db.insert(brands).values({ id: bid, name: "B", slug: "b-topics" });
  await db.insert(sites).values({ id: siteId, brandId: bid, name: "S", slug: "s-topics", adapterType: "webhook" });
});

describe("topics service", () => {
  it("pops the highest-priority approved topic and marks it used", async () => {
    const db = makeDb(URL);
    await addTopic(db, { siteId, title: "low", source: "manual", status: "approved", priority: 1 });
    await addTopic(db, { siteId, title: "high", source: "manual", status: "approved", priority: 5 });
    await addTopic(db, { siteId, title: "pending", source: "manual", status: "pending", priority: 9 });

    const t1 = await popQueuedTopic(db, siteId);
    expect(t1?.title).toBe("high");
    const t2 = await popQueuedTopic(db, siteId);
    expect(t2?.title).toBe("low");
    const t3 = await popQueuedTopic(db, siteId);
    expect(t3).toBeNull(); // 'pending' is not eligible
  });
});
