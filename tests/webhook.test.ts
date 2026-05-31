import { describe, it, expect, vi } from "vitest";
import { WebhookAdapter } from "../src/adapters/publish/webhook.js";
import { ArticleSchema } from "../src/domain/article.js";

const article = ArticleSchema.parse({
  title: "How to Cut Blinkit Ad Waste in 2026: A Practical Guide",
  slug: "cut-waste",
  excerpt: "Learn how to reduce Blinkit ad spend waste in 2026 with dayparting, match-type tightening, and CPC caps that save 18-30%.",
  category: "Guides", tags: [], date: "2026-05-31",
  bodyMarkdown: "Lead.\n\n## What?\n\nBody.",
  tldr: "Cut waste.", faqs: [
    { question: "a", answer: "b" }, { question: "c", answer: "d" }, { question: "e", answer: "f" },
  ],
  takeaways: ["x", "y", "z", "w"], relatedSlugs: [], visuals: [],
  seoHints: { jsonldType: "Article", mentions: [], speakableSelectors: [] },
});

describe("WebhookAdapter", () => {
  it("POSTs the article and returns a url + ref", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: "wh-1" }) });
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new WebhookAdapter();
    const result = await adapter.publish(
      article,
      { id: "s", baseUrl: "https://site.test", adapterConfig: {} } as never,
      { url: "https://hook.test/in", token: "secret" },
    );
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://hook.test/in");
    expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer secret" });
    expect(result.url).toBe("https://site.test/cut-waste");
    expect(result.ref).toMatchObject({ id: "wh-1" });
  });

  it("throws on non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => "boom" }));
    const adapter = new WebhookAdapter();
    await expect(
      adapter.publish(article, { id: "s", baseUrl: "https://s", adapterConfig: {} } as never, { url: "https://h" }),
    ).rejects.toThrow();
  });
});
