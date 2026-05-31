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
import { runGenerate } from "../src/generation/orchestrator.js";
import { registerLLMProvider } from "../src/providers/llm/index.js";

const URL = `file:${join(tmpdir(), `qcontent-notify-test-${randomUUID()}.db`)}`;

const fakeArticle = {
  title: "How to Cut Blinkit Ad Waste in 2026: A Practical Guide",
  slug: "notify-cut-waste",
  excerpt: "A specific, concrete meta description about reducing Blinkit ad waste with steps, benchmarks, and data points to cite.",
  category: "Guides", tags: ["blinkit"], date: "2026-05-31",
  bodyMarkdown: "Lead.\n\n## What is ad waste?\n\nSee {{visual:v}}.",
  tldr: "Pause dark hours; save 18-30%.",
  faqs: [{ question: "a?", answer: "b" }, { question: "c?", answer: "d" }, { question: "e?", answer: "f" }],
  takeaways: ["Pause dark hours", "Tighten match", "Cap CPC", "Review weekly"],
  relatedSlugs: [], visuals: [{ token: "v", kind: "svg", code: "<svg/>", alt: "chart" }],
  seoHints: { jsonldType: "Article", mentions: ["Blinkit"], speakableSelectors: ["h1"] },
};

let siteId: string;
beforeAll(async () => {
  process.env.QCONTENT_MASTER_KEY = randomBytes(32).toString("base64");
  await runMigrations(URL);
  const db = makeDb(URL);
  const brand = await createBrand(db, { name: "Ladya", slug: "ladya-notify", seedKeywords: ["blinkit ads"] });
  const site = await createSite(db, {
    brandId: brand.id, name: "Ladya", slug: "ladya-notify-site", adapterType: "webhook",
    baseUrl: "https://ladya.in", contentTypes: { guides: {} },
    indexing: { sitemapUrl: "https://ladya.in/sitemap.xml" },
  });
  siteId = site.id;
  await saveCredential(db, { siteId, integration: "webhook", secret: { url: "https://hook.test/in", token: "t" } });
  await saveCredential(db, { siteId, integration: "telegram", secret: { botToken: "BOT", chatId: "1" } });
  await addTopic(db, { siteId, title: "How to reduce Blinkit ad waste?", source: "manual", status: "approved", priority: 5 });

  registerLLMProvider("fake", () => ({ name: "fake", async generateJson() { return fakeArticle as never; } }));
});

describe("orchestrator notifications", () => {
  it("sends a telegram 'published' message after a successful publish", async () => {
    const db = makeDb(URL);
    const tgCalls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (typeof url === "string" && url.includes("api.telegram.org")) tgCalls.push(url);
      return { ok: true, status: 200, json: async () => ({ ok: true, id: "wh" }), text: async () => "ok" } as Response;
    }) as never);

    const result = await runGenerate(db, { siteId, llmProvider: "fake", contentType: "guides" });
    expect(result.status).toBe("ok");
    expect(tgCalls.length).toBeGreaterThanOrEqual(1);
  });
});
