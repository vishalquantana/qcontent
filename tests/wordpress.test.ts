import { describe, it, expect, vi, beforeEach } from "vitest";
import { WordPressAdapter } from "../src/adapters/publish/wordpress.js";
import type { Article } from "../src/domain/article.js";

const article: Article = {
  title: "How to Cut Blinkit Ad Waste in 2026: A Practical Guide",
  slug: "cut-blinkit-ad-waste-2026",
  excerpt: "A specific, concrete meta description about reducing Blinkit ad waste with steps, benchmarks, and data points to cite.",
  category: "Guides", tags: ["blinkit", "ad-waste"], date: "2026-05-31",
  bodyMarkdown: "Lead.\n\n## What is ad waste?\n\nSee {{visual:v}}.",
  tldr: "Pause dark hours; save 18-30%.",
  faqs: [{ question: "a?", answer: "b" }, { question: "c?", answer: "d" }, { question: "e?", answer: "f" }],
  takeaways: ["Pause dark hours", "Tighten match", "Cap CPC", "Review weekly"],
  relatedSlugs: [], visuals: [{ token: "v", kind: "svg", code: "<svg/>", alt: "chart" }],
  seoHints: { jsonldType: "Article", mentions: ["Blinkit"], speakableSelectors: ["h1"] },
};

const site = {
  id: "s", baseUrl: "https://wp.example.com",
  adapterConfig: { status: "publish", seoPlugin: "yoast" },
} as never;

const creds = { username: "admin", appPassword: "app pass word" };

beforeEach(() => vi.unstubAllGlobals());

function mockWp() {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  let tagId = 7;
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const method = init?.method ?? "GET";
    if (url.includes("/wp/v2/categories") && method === "GET") return { ok: true, status: 200, json: async () => [] } as Response;
    if (url.includes("/wp/v2/categories") && method === "POST") return { ok: true, status: 201, json: async () => ({ id: 5 }) } as Response;
    if (url.includes("/wp/v2/tags") && method === "GET") return { ok: true, status: 200, json: async () => [] } as Response;
    if (url.includes("/wp/v2/tags") && method === "POST") return { ok: true, status: 201, json: async () => ({ id: tagId++ }) } as Response;
    if (url.includes("/wp/v2/posts") && method === "POST") return { ok: true, status: 201, json: async () => ({ id: 99, link: "https://wp.example.com/?p=99" }) } as Response;
    return { ok: false, status: 500, text: async () => "unexpected" } as Response;
  });
  vi.stubGlobal("fetch", fetchMock as never);
  return { fetchMock, calls };
}

describe("WordPressAdapter", () => {
  it("creates the post with HTML content, taxonomy ids, and SEO meta", async () => {
    const { calls } = mockWp();
    const adapter = new WordPressAdapter();
    const result = await adapter.publish(article, site, creds);

    const postCall = calls.find((c) => c.url.includes("/wp/v2/posts") && (c.init?.method === "POST"))!;
    const sent = JSON.parse(postCall.init!.body as string);
    expect(sent.content).toContain("<h2");
    expect(sent.content).toContain("<svg/>");
    expect(sent.content).not.toContain("{{visual:v}}");
    expect(sent.title).toBe(article.title);
    expect(sent.slug).toBe(article.slug);
    expect(sent.status).toBe("publish");
    expect(sent.categories).toEqual([5]);
    expect(sent.tags).toEqual([7, 8]);
    expect(sent.meta._yoast_wpseo_title).toBe(article.title);
    expect(sent.meta._yoast_wpseo_metadesc).toBe(article.excerpt);

    const auth = (postCall.init!.headers as Record<string, string>)["Authorization"]!;
    expect(auth.startsWith("Basic ")).toBe(true);
    expect(Buffer.from(auth.slice(6), "base64").toString("utf8")).toBe("admin:app pass word");

    expect(result.url).toBe("https://wp.example.com/?p=99");
    expect(result.ref).toMatchObject({ id: 99 });
  });

  it("reuses existing category/tag ids when search returns matches", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const method = init?.method ?? "GET";
      if (url.includes("/wp/v2/categories") && method === "GET") return { ok: true, status: 200, json: async () => [{ id: 3, name: "Guides" }] } as Response;
      if (url.includes("/wp/v2/tags") && method === "GET") return { ok: true, status: 200, json: async () => [{ id: 11, name: "blinkit" }, { id: 12, name: "ad-waste" }] } as Response;
      if (url.includes("/wp/v2/posts") && method === "POST") return { ok: true, status: 201, json: async () => ({ id: 1, link: "https://wp.example.com/p/1" }) } as Response;
      return { ok: false, status: 500, text: async () => "x" } as Response;
    }) as never);

    const adapter = new WordPressAdapter();
    await adapter.publish(article, site, creds);
    const postCall = calls.find((c) => c.url.includes("/wp/v2/posts"))!;
    const sent = JSON.parse(postCall.init!.body as string);
    expect(sent.categories).toEqual([3]);
    expect(sent.tags).toEqual([11, 12]);
    expect(calls.some((c) => c.url.includes("/wp/v2/categories") && c.init?.method === "POST")).toBe(false);
  });

  it("omits SEO meta when seoPlugin is none", async () => {
    const noneSite = { id: "s", baseUrl: "https://wp.example.com", adapterConfig: { seoPlugin: "none" } } as never;
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const method = init?.method ?? "GET";
      if (url.includes("/categories") && method === "GET") return { ok: true, status: 200, json: async () => [{ id: 1, name: "Guides" }] } as Response;
      if (url.includes("/tags") && method === "GET") return { ok: true, status: 200, json: async () => [{ id: 2, name: "blinkit" }, { id: 3, name: "ad-waste" }] } as Response;
      if (url.includes("/posts") && method === "POST") return { ok: true, status: 201, json: async () => ({ id: 1, link: "https://wp.example.com/p/1" }) } as Response;
      return { ok: false, status: 500, text: async () => "x" } as Response;
    }) as never);
    const adapter = new WordPressAdapter();
    await adapter.publish(article, noneSite, creds);
    const sent = JSON.parse(calls.find((c) => c.url.includes("/posts"))!.init!.body as string);
    expect(sent.meta).toBeUndefined();
  });

  it("throws when credentials are missing", async () => {
    const adapter = new WordPressAdapter();
    await expect(adapter.publish(article, site, {})).rejects.toThrow();
  });

  it("throws when the post POST fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (url.includes("/posts") && method === "POST") return { ok: false, status: 400, text: async () => "bad" } as Response;
      return { ok: true, status: 200, json: async () => [{ id: 1, name: "Guides" }, { id: 2, name: "blinkit" }, { id: 3, name: "ad-waste" }] } as Response;
    }) as never);
    const adapter = new WordPressAdapter();
    await expect(adapter.publish(article, site, creds)).rejects.toThrow();
  });
});
