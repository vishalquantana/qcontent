import { describe, it, expect, beforeAll } from "vitest";
import { randomUUID, randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMigrations } from "../src/db/migrate.js";
import { makeDb } from "../src/db/client.js";
import { brands, sites } from "../src/db/schema.js";
import { recordPublished, getPublishedForSite, updatePublishedArticle } from "../src/service/published.js";
import type { Article } from "../src/domain/article.js";

const URL = `file:${join(tmpdir(), `qcontent-snap-test-${randomUUID()}.db`)}`;

const article: Article = {
  title: "How to Cut Blinkit Ad Waste in 2026: A Practical Guide",
  slug: "snap-slug",
  excerpt: "A specific, concrete meta description about reducing Blinkit ad waste with steps, benchmarks, and data points to cite.",
  category: "Guides", tags: ["blinkit"], date: "2026-05-31",
  bodyMarkdown: "Body here.", tldr: "tldr.",
  faqs: [{ question: "a?", answer: "b" }, { question: "c?", answer: "d" }, { question: "e?", answer: "f" }],
  takeaways: ["one", "two", "three", "four"], relatedSlugs: [], visuals: [],
  seoHints: { jsonldType: "Article", mentions: [], speakableSelectors: [] },
};

let siteId: string;
beforeAll(async () => {
  process.env.QCONTENT_MASTER_KEY = randomBytes(32).toString("base64");
  await runMigrations(URL);
  const db = makeDb(URL);
  const bid = randomUUID();
  siteId = randomUUID();
  await db.insert(brands).values({ id: bid, name: "B", slug: "b-snap" });
  await db.insert(sites).values({ id: siteId, brandId: bid, name: "S", slug: "s-snap", adapterType: "webhook" });
});

describe("published snapshot", () => {
  it("stores and returns the full Article snapshot + adapterRef", async () => {
    const db = makeDb(URL);
    await recordPublished(db, {
      siteId, slug: article.slug, url: "https://x/snap-slug", contentType: "guides",
      title: article.title, adapterRef: { id: 42 }, contentHash: "h1", article,
    });
    const rows = await getPublishedForSite(db, siteId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.slug).toBe("snap-slug");
    expect(rows[0]!.article?.title).toBe(article.title);
    expect(rows[0]!.adapterRef).toMatchObject({ id: 42 });
  });

  it("updatePublishedArticle replaces the snapshot + url + hash", async () => {
    const db = makeDb(URL);
    const rows = await getPublishedForSite(db, siteId);
    const id = rows[0]!.id;
    const updated = { ...article, bodyMarkdown: "New body." };
    await updatePublishedArticle(db, id, { article: updated, url: "https://x/snap-slug", contentHash: "h2" });
    const after = await getPublishedForSite(db, siteId);
    expect(after[0]!.article?.bodyMarkdown).toBe("New body.");
    expect(after[0]!.contentHash).toBe("h2");
  });
});
