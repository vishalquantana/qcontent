import { describe, it, expect, beforeAll, vi } from "vitest";
import { randomUUID, randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMigrations } from "../src/db/migrate.js";
import { makeDb } from "../src/db/client.js";
import { brands, sites, schedules } from "../src/db/schema.js";
import { dueSchedules, tick } from "../src/scheduler/worker.js";
import { createBrand } from "../src/service/brands.js";
import { createSite } from "../src/service/sites.js";
import { saveCredential } from "../src/service/credentials.js";
import { addTopic } from "../src/service/topics.js";
import { getAllSlugs } from "../src/service/published.js";
import { registerLLMProvider } from "../src/providers/llm/index.js";
import { eq } from "drizzle-orm";

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

describe("tick", () => {
  it("dispatches runGenerate for due generate schedules and updates lastRunAt/nextRunAt", async () => {
    const TICK_URL = `file:${join(tmpdir(), `qcontent-tick-test-${randomUUID()}.db`)}`;
    await runMigrations(TICK_URL);
    const db = makeDb(TICK_URL);

    const fakeArticle = {
      title: "Tick Test Article for Scheduler Dispatch Path",
      slug: "tick-test-article",
      excerpt: "This is a tick test article verifying that the scheduler dispatches runGenerate for due generate schedules correctly.",
      category: "Guides",
      tags: [],
      date: "2026-05-31",
      bodyMarkdown: "Tick test article body.\n\n## Section\n\nSee {{visual:v}}.",
      tldr: "Tick dispatches runGenerate.",
      faqs: [
        { question: "a?", answer: "b" },
        { question: "c?", answer: "d" },
        { question: "e?", answer: "f" },
      ],
      takeaways: ["Tick runs generate", "Updates lastRunAt", "Updates nextRunAt", "Publishes article"],
      relatedSlugs: [],
      visuals: [{ token: "v", kind: "svg", code: "<svg/>", alt: "chart" }],
      seoHints: { jsonldType: "Article", mentions: [], speakableSelectors: [] },
    };

    registerLLMProvider("claude", () => ({
      name: "claude",
      async generateJson() { return fakeArticle as never; },
    }));

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: "ok" }) }));

    const brand = await createBrand(db, { name: "TickBrand", slug: "tick-brand", seedKeywords: ["tick"] });
    const site = await createSite(db, {
      brandId: brand.id,
      name: "TickSite",
      slug: "tick-site",
      adapterType: "webhook",
      baseUrl: "https://tick.test",
      contentTypes: { guides: {} },
      enabled: 1,
    });
    await saveCredential(db, { siteId: site.id, integration: "webhook", secret: { url: "https://hook.tick/in", token: "tok" } });
    await addTopic(db, { siteId: site.id, title: "Tick test topic", source: "manual", status: "approved", priority: 5 });

    const scheduleId = randomUUID();
    await db.insert(schedules).values({
      id: scheduleId,
      siteId: site.id,
      jobType: "generate",
      cron: "0 9 * * *",
      enabled: 1,
      nextRunAt: new Date(Date.now() - 60_000),
    });

    const now = new Date();
    await tick(db, now);

    const slugs = await getAllSlugs(db, site.id);
    expect(slugs).toContain("tick-test-article");

    const updated = await db.select().from(schedules).where(eq(schedules.id, scheduleId));
    expect(updated[0]!.lastRunAt).not.toBeNull();
    expect(updated[0]!.nextRunAt!.getTime()).toBeGreaterThan(now.getTime());
  });
});
