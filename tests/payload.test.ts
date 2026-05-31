import { describe, it, expect, vi, beforeEach } from "vitest";
import { PayloadAdapter } from "../src/adapters/publish/payload.js";
import type { Article } from "../src/domain/article.js";

const article: Article = {
  title: "How to Cut Blinkit Ad Waste in 2026: A Practical Guide",
  slug: "cut-blinkit-ad-waste-2026",
  excerpt: "A specific, concrete meta description about reducing Blinkit ad waste with steps, benchmarks, and data points to cite.",
  category: "Guides", tags: ["blinkit"], date: "2026-05-31",
  bodyMarkdown: "Lead.\n\n## What is ad waste?\n\nSee {{visual:v}}.",
  tldr: "Pause dark hours; save 18-30%.",
  faqs: [{ question: "a?", answer: "b" }, { question: "c?", answer: "d" }, { question: "e?", answer: "f" }],
  takeaways: ["Pause dark hours", "Tighten match", "Cap CPC", "Review weekly"],
  relatedSlugs: [], visuals: [{ token: "v", kind: "svg", code: "<svg/>", alt: "chart" }],
  seoHints: { jsonldType: "Article", mentions: ["Blinkit"], speakableSelectors: ["h1"] },
};

beforeEach(() => vi.unstubAllGlobals());

describe("PayloadAdapter", () => {
  it("POSTs a doc to the collection with markdown body and auth header", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return { ok: true, status: 201, json: async () => ({ doc: { id: "doc_1" } }) } as Response;
    }) as never);

    const site = {
      id: "s", baseUrl: "https://cms.example.com",
      adapterConfig: { collection: "posts", contentField: "content", statusField: "_status", status: "published" },
    } as never;

    const adapter = new PayloadAdapter();
    const result = await adapter.publish(article, site, { apiKey: "key-123" });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://cms.example.com/api/posts");
    const init = calls[0]!.init!;
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("users API-Key key-123");
    const sent = JSON.parse(init.body as string);
    expect(sent.title).toBe(article.title);
    expect(sent.slug).toBe(article.slug);
    expect(sent.content).toContain("## What is ad waste?");
    expect(sent.content).toContain("<svg/>");
    expect(sent.content).not.toContain("{{visual:v}}");
    expect(sent._status).toBe("published");

    expect(result.url).toBe("https://cms.example.com/posts/cut-blinkit-ad-waste-2026");
    expect(result.ref).toMatchObject({ id: "doc_1" });
  });

  it("uses defaults (collection=posts, contentField=content, no status field) and a custom authScheme", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return { ok: true, status: 201, json: async () => ({ doc: { id: "d2" } }) } as Response;
    }) as never);

    const site = { id: "s", baseUrl: "https://cms.example.com", adapterConfig: { authScheme: "api-keys API-Key" } } as never;
    const adapter = new PayloadAdapter();
    await adapter.publish(article, site, { apiKey: "k2" });

    expect(calls[0]!.url).toBe("https://cms.example.com/api/posts");
    expect((calls[0]!.init!.headers as Record<string, string>).Authorization).toBe("api-keys API-Key k2");
    const sent = JSON.parse(calls[0]!.init!.body as string);
    expect(sent.content).toContain("Lead.");
    expect(sent._status).toBeUndefined();
  });

  it("merges extraFields into the document", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return { ok: true, status: 201, json: async () => ({ doc: { id: "d3" } }) } as Response;
    }) as never);
    const site = { id: "s", baseUrl: "https://cms.example.com", adapterConfig: { extraFields: { author: "ai", featured: false } } } as never;
    const adapter = new PayloadAdapter();
    await adapter.publish(article, site, { apiKey: "k" });
    const sent = JSON.parse(calls[0]!.init!.body as string);
    expect(sent.author).toBe("ai");
    expect(sent.featured).toBe(false);
  });

  it("builds the public url from adapterConfig.baseUrl when site.baseUrl is null", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return { ok: true, status: 201, json: async () => ({ doc: { id: "d4" } }) } as Response;
    }) as never);
    // site.baseUrl is null (nullable column); only adapterConfig.baseUrl is set.
    const site = { id: "s", baseUrl: null, adapterConfig: { baseUrl: "https://cms.example.com", collection: "posts" } } as never;
    const adapter = new PayloadAdapter();
    const result = await adapter.publish(article, site, { apiKey: "k" });
    expect(calls[0]!.url).toBe("https://cms.example.com/api/posts");
    // url must be a full URL derived from the resolved base, not a bare slug
    expect(result.url).toBe("https://cms.example.com/posts/cut-blinkit-ad-waste-2026");
  });

  it("throws when apiKey is missing", async () => {
    const site = { id: "s", baseUrl: "https://cms.example.com", adapterConfig: {} } as never;
    const adapter = new PayloadAdapter();
    await expect(adapter.publish(article, site, {})).rejects.toThrow();
  });

  it("throws on a non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403, text: async () => "denied" }));
    const site = { id: "s", baseUrl: "https://cms.example.com", adapterConfig: {} } as never;
    const adapter = new PayloadAdapter();
    await expect(adapter.publish(article, site, { apiKey: "k" })).rejects.toThrow();
  });
});
