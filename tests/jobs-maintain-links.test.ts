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
import { runMaintainLinks } from "../src/jobs/maintain-links.js";
import "../src/adapters/publish/webhook.js";
import type { Article } from "../src/domain/article.js";

const URL = `file:${join(tmpdir(), `qcontent-mlinks-test-${randomUUID()}.db`)}`;

function art(slug: string, title: string, body: string): Article {
  return {
    title, slug, excerpt: "A specific, concrete meta description padded out to clear the forty character minimum bound easily.",
    category: "Guides", tags: [], date: "2026-05-31", bodyMarkdown: body, tldr: "t.",
    faqs: [{ question: "a?", answer: "b" }, { question: "c?", answer: "d" }, { question: "e?", answer: "f" }],
    takeaways: ["one", "two", "three", "four"], relatedSlugs: [], visuals: [],
    seoHints: { jsonldType: "Article", mentions: [], speakableSelectors: [] },
  };
}

let siteId: string;
beforeAll(async () => {
  process.env.QCONTENT_MASTER_KEY = randomBytes(32).toString("base64");
  await runMigrations(URL);
  const db = makeDb(URL);
  const brand = await createBrand(db, { name: "B", slug: "b-ml" });
  const site = await createSite(db, { brandId: brand.id, name: "S", slug: "s-ml", adapterType: "webhook", baseUrl: "https://x.test" });
  siteId = site.id;
  await saveCredential(db, { siteId, integration: "webhook", secret: { url: "https://hook/in" } });
  await recordPublished(db, { siteId, slug: "a", url: "https://x.test/guides/a", contentType: "guides", title: "Reduce Blinkit Ad Waste", article: art("a", "Reduce Blinkit Ad Waste", "Use dayparting to cut spend."), adapterRef: { id: "wa" } });
  await recordPublished(db, { siteId, slug: "dayparting", url: "https://x.test/learn/dayparting", contentType: "learn", title: "Dayparting Explained", article: art("dayparting", "Dayparting Explained", "Dayparting means scheduling ads."), adapterRef: { id: "wd" } });
});

describe("runMaintainLinks", () => {
  it("adds an internal link in post A pointing at the dayparting post and updates it", async () => {
    const db = makeDb(URL);
    const updates: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      const b = init?.body ? JSON.parse(init.body as string) : {};
      if (b.action === "update") updates.push(b.article);
      return { ok: true, status: 200, json: async () => ({ id: "wh" }) } as Response;
    }) as never);

    const result = await runMaintainLinks(db, { siteId, maxLinksPerPost: 3 });
    expect(result.status).toBe("ok");
    expect((result.summary?.updated as number) >= 1).toBe(true);

    const rows = await getPublishedForSite(db, siteId);
    const a = rows.find((r) => r.slug === "a")!;
    expect(a.article?.bodyMarkdown).toContain("/learn/dayparting");
  });
});
