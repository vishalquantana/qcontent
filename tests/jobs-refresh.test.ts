import { describe, it, expect, beforeAll, vi } from "vitest";
import { randomUUID, randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMigrations } from "../src/db/migrate.js";
import { makeDb } from "../src/db/client.js";
import { createBrand } from "../src/service/brands.js";
import { createSite } from "../src/service/sites.js";
import { saveCredential } from "../src/service/credentials.js";
import { recordPublished, getPublishedForSite } from "../src/service/published.js";
import { selectStale, runRefresh } from "../src/jobs/refresh.js";
import { registerLLMProvider } from "../src/providers/llm/index.js";
import "../src/adapters/publish/webhook.js";
import type { Article } from "../src/domain/article.js";

const URL = `file:${join(tmpdir(), `qcontent-refresh-test-${randomUUID()}.db`)}`;

function art(slug: string, body: string): Article {
  return {
    title: "How to Cut Blinkit Ad Waste in 2026: A Practical Guide", slug,
    excerpt: "A specific, concrete meta description padded out to clear the forty character minimum bound easily here.",
    category: "Guides", tags: ["blinkit"], date: "2026-01-01", bodyMarkdown: body, tldr: "t.",
    faqs: [{ question: "a?", answer: "b" }, { question: "c?", answer: "d" }, { question: "e?", answer: "f" }],
    takeaways: ["one", "two", "three", "four"], relatedSlugs: [], visuals: [],
    seoHints: { jsonldType: "Article", mentions: [], speakableSelectors: [] },
  };
}

describe("selectStale", () => {
  it("picks rows older than maxAgeDays, oldest first, up to limit", () => {
    const now = new Date("2026-06-01T00:00:00Z");
    const rows = [
      { id: "new", publishedAt: new Date("2026-05-20T00:00:00Z") },
      { id: "old1", publishedAt: new Date("2026-01-01T00:00:00Z") },
      { id: "old2", publishedAt: new Date("2026-02-01T00:00:00Z") },
    ];
    const picked = selectStale(rows, now, 60, 1);
    expect(picked.map((r) => r.id)).toEqual(["old1"]);
  });
});

let siteId: string;
beforeAll(async () => {
  process.env.QCONTENT_MASTER_KEY = randomBytes(32).toString("base64");
  await runMigrations(URL);
  const db = makeDb(URL);
  const brand = await createBrand(db, { name: "B", slug: "b-refresh" });
  const site = await createSite(db, { brandId: brand.id, name: "S", slug: "s-refresh", adapterType: "webhook", baseUrl: "https://x.test" });
  siteId = site.id;
  await saveCredential(db, { siteId, integration: "webhook", secret: { url: "https://hook/in" } });
  await recordPublished(db, { siteId, slug: "old", url: "https://x.test/guides/old", contentType: "guides", title: "Old", article: art("old", "Stale body."), adapterRef: { id: "w1" } });

  registerLLMProvider("fakeRefresh", () => ({
    name: "fakeRefresh",
    async generateJson() { return { ...art("old", "Refreshed body with 2026 data."), title: "How to Cut Blinkit Ad Waste in 2026: Updated Guide" } as never; },
  }));
});

describe("runRefresh", () => {
  it("regenerates a stale post and updates it in place (same slug)", async () => {
    const db = makeDb(URL);
    const updates: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      const b = init?.body ? JSON.parse(init.body as string) : {};
      if (b.action === "update") updates.push(b.article);
      return { ok: true, status: 200, json: async () => ({ id: "wh" }) } as Response;
    }) as never);

    const result = await runRefresh(db, { siteId, llmProvider: "fakeRefresh", maxAgeDays: 30, limit: 5, now: "2026-06-01T00:00:00Z" });
    expect(result.status).toBe("ok");
    expect(result.summary?.refreshed).toBe(1);

    const rows = await getPublishedForSite(db, siteId);
    const old = rows.find((r) => r.slug === "old")!;
    expect(old.article?.bodyMarkdown).toContain("Refreshed body");
    expect(old.slug).toBe("old");
  });
});
