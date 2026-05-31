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
import { runDistributeSocial } from "../src/jobs/distribute-social.js";
import { registerLLMProvider } from "../src/providers/llm/index.js";
import type { Article } from "../src/domain/article.js";

const URL = `file:${join(tmpdir(), `qcontent-social-test-${randomUUID()}.db`)}`;

function art(slug: string): Article {
  return {
    title: "How to Cut Blinkit Ad Waste in 2026: A Practical Guide", slug,
    excerpt: "A specific, concrete meta description padded out to clear the forty character minimum bound easily here.",
    category: "Guides", tags: ["blinkit"], date: "2026-05-31", bodyMarkdown: "Body about waste.", tldr: "t.",
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
  const brand = await createBrand(db, { name: "Ladya", slug: "b-social", hashtags: ["#blinkit"], social: { instagram: "getladya" } });
  const site = await createSite(db, { brandId: brand.id, name: "S", slug: "s-social", adapterType: "webhook", baseUrl: "https://x.test", indexing: {} });
  siteId = site.id;
  await saveCredential(db, { siteId, integration: "upload-post", secret: { apiKey: "K", user: "ladya" } });
  await recordPublished(db, { siteId, slug: "p1", url: "https://x.test/guides/p1", contentType: "guides", title: "P1", article: art("p1"), adapterRef: { id: "w1" } });

  registerLLMProvider("fakeSlides", () => ({
    name: "fakeSlides",
    async generateJson() {
      return { caption: "Cut Blinkit ad waste", hashtags: ["#blinkit", "#qcommerce"], slides: [{ type: "hook", text: "Wasting spend?" }, { type: "cta", text: "Follow @getladya" }] } as never;
    },
  }));
});

describe("runDistributeSocial", () => {
  it("generates slide copy, renders (injected fake) + delivers to Upload-Post, marks social_posted", async () => {
    const db = makeDb(URL);
    let uploadCalled = false;
    let renderedSlides = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("upload-post.com")) uploadCalled = true;
      return { ok: true, status: 200, json: async () => ({ success: true, request_id: "rq" }) } as Response;
    }) as never);

    const fakeRender = async (_html: string) => { renderedSlides++; return Buffer.from("png"); };

    const result = await runDistributeSocial(db, { siteId, llmProvider: "fakeSlides", render: fakeRender });
    expect(result.status).toBe("ok");
    expect(result.summary?.posted).toBe(1);
    expect(uploadCalled).toBe(true);
    expect(renderedSlides).toBe(2);

    const rows = await getPublishedForSite(db, siteId);
    expect(rows.find((r) => r.slug === "p1")!.socialPosted).toBe(1);
  });

  it("is a no-op ok when there is no unposted content", async () => {
    const db = makeDb(URL);
    const fakeRender = async (_html: string) => Buffer.from("png");
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) } as Response)) as never);
    const result = await runDistributeSocial(db, { siteId, llmProvider: "fakeSlides", render: fakeRender });
    expect(result.status).toBe("ok");
    expect(result.summary?.posted).toBe(0);
  });
});
