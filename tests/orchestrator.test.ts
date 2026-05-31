import { describe, it, expect, beforeAll, vi } from "vitest";
import { randomUUID, randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMigrations } from "../src/db/migrate.js";
import { makeDb } from "../src/db/client.js";
import { createBrand } from "../src/service/brands.js";
import { createSite } from "../src/service/sites.js";
import { saveCredential } from "../src/service/credentials.js";
import { addTopic, peekQueuedTopic } from "../src/service/topics.js";
import { getAllSlugs } from "../src/service/published.js";
import { runGenerate } from "../src/generation/orchestrator.js";
import { registerLLMProvider } from "../src/providers/llm/index.js";

const URL = `file:${join(tmpdir(), `qcontent-orch-test-${randomUUID()}.db`)}`;

const fakeArticle = {
  title: "How to Cut Blinkit Ad Waste in 2026 Fast",
  slug: "cut-blinkit-ad-waste-2026",
  excerpt: "A short, specific meta description about reducing Blinkit ad waste with steps and data points.",
  category: "Guides", tags: ["blinkit"], date: "2026-05-31",
  bodyMarkdown: "Waste starts with dark hours.\n\n## What is ad waste?\n\nSee {{visual:waste}}.",
  tldr: "Pause dark hours; save 18-30%.",
  faqs: [{ question: "a?", answer: "b" }, { question: "c?", answer: "d" }, { question: "e?", answer: "f" }],
  takeaways: ["Pause dark hours", "Tighten match", "Cap CPC", "Review weekly"],
  relatedSlugs: [], visuals: [{ token: "waste", kind: "svg", code: "<svg/>", alt: "chart" }],
  seoHints: { jsonldType: "Article", mentions: ["Blinkit"], speakableSelectors: ["h1"] },
};

let siteId: string;
beforeAll(async () => {
  process.env.QCONTENT_MASTER_KEY = randomBytes(32).toString("base64");
  await runMigrations(URL);
  const db = makeDb(URL);
  const brand = await createBrand(db, { name: "Ladya", slug: "ladya-orch", seedKeywords: ["blinkit ads"] });
  const site = await createSite(db, {
    brandId: brand.id, name: "Ladya", slug: "ladya-orch-site", adapterType: "webhook",
    baseUrl: "https://ladya.in", contentTypes: { guides: { minWords: 1000 } },
  });
  siteId = site.id;
  await saveCredential(db, { siteId, integration: "webhook", secret: { url: "https://hook.test/in", token: "t" } });
  await addTopic(db, { siteId, title: "How to reduce Blinkit ad waste?", source: "manual", status: "approved", priority: 5 });

  registerLLMProvider("fake", () => ({
    name: "fake",
    async generateJson() { return fakeArticle as never; },
  }));

  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: "wh-1" }) }));
});

describe("runGenerate", () => {
  it("runs end-to-end: topic -> llm -> validate -> publish -> record", async () => {
    const db = makeDb(URL);
    const result = await runGenerate(db, { siteId, llmProvider: "fake", contentType: "guides" });
    expect(result.status).toBe("ok");
    expect(result.url).toBe("https://ladya.in/cut-blinkit-ad-waste-2026");
    expect(await getAllSlugs(db, siteId)).toContain("cut-blinkit-ad-waste-2026");
  });

  it("fails the run when the slug already exists (dedupe) and produces no second publish", async () => {
    const db = makeDb(URL);
    const result = await runGenerate(db, { siteId, llmProvider: "fake", contentType: "guides" });
    expect(result.status).toBe("failed");
  });
});

describe("runGenerate rejects disabled site", () => {
  it("returns failed status with 'disabled' in error when site.enabled is 0", async () => {
    const URL3 = `file:${join(tmpdir(), `qcontent-disabled-site-test-${randomUUID()}.db`)}`;
    await runMigrations(URL3);
    const db3 = makeDb(URL3);

    const brand = await createBrand(db3, { name: "L3", slug: "ladya-disabled", seedKeywords: ["x"] });
    const site = await createSite(db3, {
      brandId: brand.id, name: "L3", slug: "ladya-disabled-site", adapterType: "webhook",
      baseUrl: "https://ladya.in", contentTypes: { guides: {} }, enabled: 0,
    });
    await saveCredential(db3, { siteId: site.id, integration: "webhook", secret: { url: "https://hook.test/in", token: "t" } });
    await addTopic(db3, { siteId: site.id, title: "Should never generate", source: "manual", status: "approved", priority: 5 });

    const result = await runGenerate(db3, { siteId: site.id, llmProvider: "fake", contentType: "guides" });
    expect(result.status).toBe("failed");
    expect(result.error).toContain("disabled");
    expect(await getAllSlugs(db3, site.id)).toHaveLength(0);
  });
});

describe("runGenerate failure does not consume queued topic", () => {
  it("leaves the queued topic approved when generation fails validation", async () => {
    const URL2 = `file:${join(tmpdir(), `qcontent-orch-fail-test-${randomUUID()}.db`)}`;
    await runMigrations(URL2);
    const db2 = makeDb(URL2);

    const brand = await createBrand(db2, { name: "L2", slug: "ladya-fail", seedKeywords: ["x"] });
    const site = await createSite(db2, {
      brandId: brand.id, name: "L2", slug: "ladya-fail-site", adapterType: "webhook",
      baseUrl: "https://ladya.in", contentTypes: { guides: {} },
    });
    await saveCredential(db2, { siteId: site.id, integration: "webhook", secret: { url: "https://hook.test/in" } });
    await addTopic(db2, { siteId: site.id, title: "Queued and should survive failure", source: "manual", status: "approved", priority: 5 });

    registerLLMProvider("failval", () => ({
      name: "failval",
      async generateJson() {
        return { ...fakeArticle, slug: "fail-val-slug", bodyMarkdown: "x {{visual:missing}}" } as never;
      },
    }));

    const result = await runGenerate(db2, { siteId: site.id, llmProvider: "failval", contentType: "guides" });
    expect(result.status).toBe("failed");
    const stillThere = await peekQueuedTopic(db2, site.id);
    expect(stillThere?.title).toBe("Queued and should survive failure");
  });
});
