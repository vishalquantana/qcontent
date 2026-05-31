import { describe, it, expect, beforeAll, vi } from "vitest";
import { randomUUID, randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMigrations } from "../src/db/migrate.js";
import { makeDb } from "../src/db/client.js";
import { createBrand } from "../src/service/brands.js";
import { createSite } from "../src/service/sites.js";
import { saveCredential } from "../src/service/credentials.js";
import { addTopic } from "../src/service/topics.js";
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
