import { describe, it, expect, vi, beforeEach } from "vitest";
import { GitHubMdxAdapter } from "../src/adapters/publish/github-mdx.js";
import type { Article } from "../src/domain/article.js";

const article: Article = {
  title: "How to Cut Blinkit Ad Waste in 2026: A Practical Guide",
  slug: "cut-blinkit-ad-waste-2026",
  excerpt: "A specific, concrete meta description about reducing Blinkit ad waste with steps, benchmarks, and data points worth citing here.",
  category: "Guides", tags: ["blinkit"], date: "2026-05-31",
  bodyMarkdown: "Lead.\n\n## What is ad waste?\n\nSee {{visual:v}}.",
  tldr: "Pause dark hours; save 18-30%.",
  faqs: [{ question: "a?", answer: "b" }, { question: "c?", answer: "d" }, { question: "e?", answer: "f" }],
  takeaways: ["Pause dark hours", "Tighten match", "Cap CPC", "Review weekly"],
  relatedSlugs: [], visuals: [{ token: "v", kind: "svg", code: "<svg/>", alt: "chart" }],
  seoHints: { jsonldType: "Article", mentions: ["Blinkit"], speakableSelectors: ["h1"] },
};

const site = {
  id: "s", baseUrl: "https://example.com",
  adapterConfig: { owner: "o", repo: "r", branch: "main", type: "guides" },
} as never;

beforeEach(() => vi.unstubAllGlobals());

function mockGitHub() {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (init?.method === undefined && url.includes("/contents/content/manifest.json")) {
      return { ok: false, status: 404, text: async () => "nf" } as Response;
    }
    if (init?.method === "PUT") {
      return { ok: true, status: 201, json: async () => ({ commit: { sha: "c1" }, content: { sha: "b1" } }) } as Response;
    }
    return { ok: false, status: 500, text: async () => "unexpected" } as Response;
  });
  vi.stubGlobal("fetch", fetchMock as never);
  return { fetchMock, calls };
}

describe("GitHubMdxAdapter", () => {
  it("writes the mdx file and the manifest, returns the public url", async () => {
    const { calls } = mockGitHub();
    const adapter = new GitHubMdxAdapter();
    const result = await adapter.publish(article, site, { token: "tok" });

    const puts = calls.filter((c) => c.init?.method === "PUT");
    expect(puts).toHaveLength(2);
    const paths = puts.map((p) => p.url);
    expect(paths.some((u) => u.endsWith("/contents/content/guides/cut-blinkit-ad-waste-2026.mdx"))).toBe(true);
    expect(paths.some((u) => u.endsWith("/contents/content/manifest.json"))).toBe(true);

    const mdxPut = puts.find((p) => p.url.endsWith(".mdx"))!;
    const mdxSent = JSON.parse(mdxPut.init.body as string);
    const mdxText = Buffer.from(mdxSent.content, "base64").toString("utf8");
    expect(mdxText).toContain("<svg/>");
    expect(mdxText).not.toContain("{{visual:v}}");
    expect(mdxText.startsWith("---\n")).toBe(true);

    expect(result.url).toBe("https://example.com/guides/cut-blinkit-ad-waste-2026");
    expect(result.ref).toMatchObject({ commitSha: "c1" });
  });

  it("merges into an existing manifest (passes its sha on update)", async () => {
    const existing = Buffer.from(JSON.stringify({ "old-slug": { slug: "old-slug" } }), "utf8").toString("base64");
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      if (init?.method === undefined && url.includes("manifest.json")) {
        return { ok: true, status: 200, json: async () => ({ sha: "manifestSha", content: existing, encoding: "base64" }) } as Response;
      }
      return { ok: true, status: 200, json: async () => ({ commit: { sha: "c2" }, content: { sha: "b2" } }) } as Response;
    }) as never);

    const adapter = new GitHubMdxAdapter();
    await adapter.publish(article, site, { token: "tok" });

    const manifestPut = calls.find((c) => c.init?.method === "PUT" && c.url.includes("manifest.json"))!;
    const sent = JSON.parse(manifestPut.init.body as string);
    expect(sent.sha).toBe("manifestSha");
    const merged = JSON.parse(Buffer.from(sent.content, "base64").toString("utf8"));
    expect(Object.keys(merged).sort()).toEqual(["cut-blinkit-ad-waste-2026", "old-slug"]);
  });

  it("throws when token is missing", async () => {
    const adapter = new GitHubMdxAdapter();
    await expect(adapter.publish(article, site, {})).rejects.toThrow();
  });
});
