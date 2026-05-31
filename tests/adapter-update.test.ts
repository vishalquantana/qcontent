import { describe, it, expect, vi, beforeEach } from "vitest";
import { WebhookAdapter } from "../src/adapters/publish/webhook.js";
import { GitHubMdxAdapter } from "../src/adapters/publish/github-mdx.js";
import { WordPressAdapter } from "../src/adapters/publish/wordpress.js";
import { PayloadAdapter } from "../src/adapters/publish/payload.js";
import type { Article } from "../src/domain/article.js";

const article: Article = {
  title: "Updated: Cut Blinkit Ad Waste in 2026 — A Practical Guide",
  slug: "cut-blinkit-ad-waste-2026",
  excerpt: "A specific, concrete meta description about reducing Blinkit ad waste with steps, benchmarks, and data points to cite.",
  category: "Guides", tags: ["blinkit"], date: "2026-05-31",
  bodyMarkdown: "Updated body.\n\n## H\n\nSee {{visual:v}}.",
  tldr: "tldr.", faqs: [{ question: "a?", answer: "b" }, { question: "c?", answer: "d" }, { question: "e?", answer: "f" }],
  takeaways: ["one", "two", "three", "four"], relatedSlugs: [], visuals: [{ token: "v", kind: "svg", code: "<svg/>", alt: "c" }],
  seoHints: { jsonldType: "Article", mentions: [], speakableSelectors: [] },
};

beforeEach(() => vi.unstubAllGlobals());

describe("WebhookAdapter.update", () => {
  it("POSTs the article with an update marker", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: "wh" }) });
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new WebhookAdapter();
    const site = { id: "s", baseUrl: "https://x", adapterConfig: {} } as never;
    const result = await adapter.update!(article, { id: "wh" }, site, { url: "https://hook/in" });
    const sent = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
    expect(sent.action).toBe("update");
    expect(sent.article.slug).toBe("cut-blinkit-ad-waste-2026");
    expect(result.url).toBe("https://x/cut-blinkit-ad-waste-2026");
  });
});

describe("GitHubMdxAdapter.update", () => {
  it("re-PUTs the existing file path using its current sha", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if ((init?.method ?? "GET") === "GET" && url.endsWith(".mdx")) {
        return { ok: true, status: 200, json: async () => ({ sha: "oldsha", content: Buffer.from("old").toString("base64"), encoding: "base64" }) } as Response;
      }
      return { ok: true, status: 200, json: async () => ({ commit: { sha: "c9" }, content: { sha: "b9" } }) } as Response;
    }) as never);

    const adapter = new GitHubMdxAdapter();
    const site = { id: "s", baseUrl: "https://example.com", adapterConfig: { owner: "o", repo: "r", branch: "main", type: "guides" } } as never;
    const ref = { path: "content/guides/cut-blinkit-ad-waste-2026.mdx", branch: "main" };
    const result = await adapter.update!(article, ref, site, { token: "tok" });

    const put = calls.find((c) => c.init?.method === "PUT" && c.url.endsWith(".mdx"))!;
    const sent = JSON.parse(put.init!.body as string);
    expect(sent.sha).toBe("oldsha");
    const text = Buffer.from(sent.content, "base64").toString("utf8");
    expect(text).toContain("<svg/>");
    expect(text).not.toContain("{{visual:v}}");
    expect(result.url).toBe("https://example.com/guides/cut-blinkit-ad-waste-2026");
  });
});

describe("WordPressAdapter.update", () => {
  it("posts to /posts/{id} with HTML content", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return { ok: true, status: 200, json: async () => ({ id: 99, link: "https://wp/p/99" }) } as Response;
    }) as never);
    const adapter = new WordPressAdapter();
    const site = { id: "s", baseUrl: "https://wp.example.com", adapterConfig: { seoPlugin: "none" } } as never;
    const result = await adapter.update!(article, { id: 99 }, site, { username: "u", appPassword: "p" });
    const call = calls[0]!;
    expect(call.url).toBe("https://wp.example.com/wp-json/wp/v2/posts/99");
    expect(call.init!.method).toBe("POST");
    const sent = JSON.parse(call.init!.body as string);
    expect(sent.content).toContain("<svg/>");
    expect(sent.title).toBe(article.title);
    expect(result.url).toBe("https://wp/p/99");
  });

  it("throws if ref has no id", async () => {
    const adapter = new WordPressAdapter();
    const site = { id: "s", baseUrl: "https://wp.example.com", adapterConfig: {} } as never;
    await expect(adapter.update!(article, {}, site, { username: "u", appPassword: "p" })).rejects.toThrow();
  });
});

describe("PayloadAdapter.update", () => {
  it("PATCHes the collection doc by id with the markdown body", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return { ok: true, status: 200, json: async () => ({ doc: { id: "d1" } }) } as Response;
    }) as never);
    const adapter = new PayloadAdapter();
    const site = { id: "s", baseUrl: "https://cms.example.com", adapterConfig: { collection: "posts", contentField: "content" } } as never;
    const result = await adapter.update!(article, { id: "d1" }, site, { apiKey: "k" });
    const call = calls[0]!;
    expect(call.url).toBe("https://cms.example.com/api/posts/d1");
    expect(call.init!.method).toBe("PATCH");
    const sent = JSON.parse(call.init!.body as string);
    expect(sent.content).toContain("## H");
    expect(sent.content).not.toContain("{{visual:v}}");
    expect(result.url).toBe("https://cms.example.com/posts/cut-blinkit-ad-waste-2026");
  });

  it("throws if ref has no id", async () => {
    const adapter = new PayloadAdapter();
    const site = { id: "s", baseUrl: "https://cms.example.com", adapterConfig: {} } as never;
    await expect(adapter.update!(article, {}, site, { apiKey: "k" })).rejects.toThrow();
  });
});
