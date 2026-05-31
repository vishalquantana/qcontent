# qcontent Phase 3 (WordPress + Payload adapters) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two more publish adapters behind the existing `PublishAdapter` seam — **WordPress** (REST API: Markdown→HTML post + category/tag resolution + SEO meta) and **Payload CMS** (REST: create a collection document with the body in a configurable markdown field) — so the engine can publish to those site types with no orchestrator changes.

**Architecture:** Both adapters are drop-in `PublishAdapter` implementations that reuse the canonical `Article` and the existing `inlineVisuals` helper. A small, dependency-free **Markdown→HTML** converter (sufficient for article bodies) feeds the WordPress adapter; the Payload adapter sends Markdown as-is into a configured field. Both authenticate from the encrypted `credentials` table and read per-site settings from `adapterConfig`. No changes to the orchestrator, scheduler, or domain model.

**Tech Stack:** Existing (TS ESM, Drizzle/Turso, zod, vitest). New dep: `marked` (Markdown→HTML). No other new deps (Payload takes markdown verbatim).

**Spec:** `docs/superpowers/specs/2026-05-31-qcontent-multisite-engine-design.md` — Phase 3 in §10; adapter model §4.

**Builds on Phases 1–2 (merged to master).** Existing exports this plan uses:
- `Article`, `Visual` (`src/domain/article.js`)
- `Site` (`src/service/sites.js`)
- `PublishAdapter`, `PublishResult`, `registerPublishAdapter` (`src/adapters/publish/index.js`)
- `inlineVisuals(article)` → string (`src/adapters/publish/mdx-format.js`) — replaces `{{visual:token}}` with raw `<svg>` / `![alt](url)`
- orchestrator side-effect-imports built-in adapters (Task 6 adds the two new imports there + CLI)

**Conventions (carry over):**
- ESM/NodeNext: project imports use `.js`; tests import `../src/...js`.
- `noUncheckedIndexedAccess` on — guard indexed access with `!`/`??`.
- Adapters self-register via a side-effect at the bottom of their module; the orchestrator + CLI must import them.
- Node 26 global `fetch`. zod v3. Installed majors unchanged from Phase 2.
- A real-DB test uses a temp-file libSQL URL; these Phase 3 adapter tests mock `fetch` and need no DB.

---

## File Structure (Phase 3)

```
src/
  adapters/
    publish/
      markdown-html.ts     # markdownToHtml(md): dependency-light MD->HTML (via marked)
      wordpress.ts         # PublishAdapter 'wordpress' (REST: post + taxonomy + SEO meta)
      payload.ts           # PublishAdapter 'payload' (REST: create collection doc, markdown field)
  generation/
    orchestrator.ts        # MODIFY: side-effect import wordpress + payload adapters
  cli/
    index.ts               # MODIFY: side-effect import wordpress + payload adapters
tests/
  markdown-html.test.ts
  wordpress.test.ts
  payload.test.ts
```

Repo root: `/Users/vishalkumar/Downloads/qcontent`. Controller creates branch `phase3-wordpress-payload` before Task 1.

---

### Task 1: Add `marked` dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install marked**

Run: `npm install marked@^15` (if a postinstall binary fails in this environment, re-run with `npm install --ignore-scripts marked@^15`).
Expected: `package.json` `dependencies` now includes `marked`.

- [ ] **Step 2: Verify the full suite still passes**

Run: `npx vitest run`
Expected: 21 files / 49 tests pass (unchanged).

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add marked dep for Phase 3 (markdown -> html)"
```

---

### Task 2: Markdown → HTML converter

**Files:**
- Create: `src/adapters/publish/markdown-html.ts`
- Test: `tests/markdown-html.test.ts`

The WordPress REST API stores post content as HTML. We convert the (visual-inlined) Markdown body to HTML with `marked`. Raw inline HTML/SVG in the body must pass through untouched (marked allows raw HTML by default).

- [ ] **Step 1: Write the failing test — `tests/markdown-html.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { markdownToHtml } from "../src/adapters/publish/markdown-html.js";

describe("markdownToHtml", () => {
  it("converts headings, paragraphs, and links to HTML", () => {
    const html = markdownToHtml("# Title\n\nHello [world](https://x.test).");
    expect(html).toContain("<h1");
    expect(html).toContain("Title");
    expect(html).toContain('<a href="https://x.test"');
    expect(html).toContain("world");
  });

  it("passes raw inline SVG/HTML through untouched", () => {
    const html = markdownToHtml("Intro.\n\n<svg viewBox=\"0 0 10 10\"><rect/></svg>");
    expect(html).toContain("<svg viewBox=\"0 0 10 10\">");
    expect(html).toContain("<rect");
  });

  it("renders a markdown image as an <img> tag", () => {
    const html = markdownToHtml("![a pic](https://cdn.test/p.png)");
    expect(html).toContain('<img');
    expect(html).toContain('src="https://cdn.test/p.png"');
    expect(html).toContain('alt="a pic"');
  });

  it("returns a string synchronously (not a Promise)", () => {
    const out = markdownToHtml("plain");
    expect(typeof out).toBe("string");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/markdown-html.test.ts`
Expected: FAIL ("Cannot find module ... markdown-html.js").

- [ ] **Step 3: Implement `src/adapters/publish/markdown-html.ts`**

```ts
import { marked } from "marked";

/**
 * Convert article Markdown to HTML for HTML-bodied CMSs (WordPress).
 * Configured synchronous + GFM; raw inline HTML/SVG passes through untouched
 * (marked does not sanitize, which is what we want for our own generated content).
 */
export function markdownToHtml(markdown: string): string {
  const out = marked.parse(markdown, { async: false, gfm: true, breaks: false });
  return typeof out === "string" ? out : String(out);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/markdown-html.test.ts`
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
git add src/adapters/publish/markdown-html.ts tests/markdown-html.test.ts
git commit -m "feat: markdown -> html converter (marked) for HTML-bodied CMSs"
```

---

### Task 3: WordPress publish adapter

**Files:**
- Create: `src/adapters/publish/wordpress.ts`
- Test: `tests/wordpress.test.ts`

Behavior. `adapterConfig`: `{ baseUrl?, status?, seoPlugin?, type? }` (the WP REST root is `site.adapterConfig.baseUrl` or `site.baseUrl`). `creds`: `{ username, appPassword }` (WordPress Application Passwords → HTTP Basic). Steps:
1. Resolve category & tag IDs by name via `GET /wp-json/wp/v2/categories?search=` / `tags?search=`; create with `POST` when not found. Categories from `article.category` (single), tags from `article.tags`.
2. Build the post: `title`, `content` (Markdown→HTML of `inlineVisuals(article)`), `excerpt`, `slug`, `status` (default `"publish"`), `categories` (ids), `tags` (ids), and `meta` for SEO. SEO meta keys depend on `seoPlugin`: `"yoast"` → `_yoast_wpseo_title` / `_yoast_wpseo_metadesc`; `"rankmath"` → `rank_math_title` / `rank_math_description`; `"none"`/unset → no meta. SEO title = `article.title`; description = `article.excerpt`.
3. `POST /wp-json/wp/v2/posts` with HTTP Basic auth. Return `{ url: link, ref: { id, link } }` using the response's `link` (fallback to `${base}/${slug}`).

- [ ] **Step 1: Write the failing test — `tests/wordpress.test.ts`** (mocks `fetch`)

```ts
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

/** Mock WP REST: categories search empty -> create id 5; tags search empty -> create ids 7,8; post -> id 99. */
function mockWp() {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  let tagId = 7;
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const method = init?.method ?? "GET";
    if (url.includes("/wp/v2/categories") && method === "GET") {
      return { ok: true, status: 200, json: async () => [] } as Response;
    }
    if (url.includes("/wp/v2/categories") && method === "POST") {
      return { ok: true, status: 201, json: async () => ({ id: 5 }) } as Response;
    }
    if (url.includes("/wp/v2/tags") && method === "GET") {
      return { ok: true, status: 200, json: async () => [] } as Response;
    }
    if (url.includes("/wp/v2/tags") && method === "POST") {
      return { ok: true, status: 201, json: async () => ({ id: tagId++ }) } as Response;
    }
    if (url.includes("/wp/v2/posts") && method === "POST") {
      return { ok: true, status: 201, json: async () => ({ id: 99, link: "https://wp.example.com/?p=99" }) } as Response;
    }
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
    // body converted to HTML, visual inlined
    expect(sent.content).toContain("<h2");
    expect(sent.content).toContain("<svg/>");
    expect(sent.content).not.toContain("{{visual:v}}");
    expect(sent.title).toBe(article.title);
    expect(sent.slug).toBe(article.slug);
    expect(sent.status).toBe("publish");
    expect(sent.categories).toEqual([5]);
    expect(sent.tags).toEqual([7, 8]);
    // Yoast SEO meta
    expect(sent.meta._yoast_wpseo_title).toBe(article.title);
    expect(sent.meta._yoast_wpseo_metadesc).toBe(article.excerpt);

    // HTTP Basic auth header on the post call
    const auth = (postCall.init!.headers as Record<string, string>).Authorization;
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
    // no POST to categories/tags happened (all resolved by search)
    expect(calls.some((c) => c.url.includes("/wp/v2/categories") && c.init?.method === "POST")).toBe(false);
  });

  it("omits SEO meta when seoPlugin is none", async () => {
    mockWp();
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/wordpress.test.ts`
Expected: FAIL ("Cannot find module ... wordpress.js").

- [ ] **Step 3: Implement `src/adapters/publish/wordpress.ts`**

```ts
import type { Article } from "../../domain/article.js";
import type { Site } from "../../service/sites.js";
import type { PublishAdapter, PublishResult } from "./index.js";
import { registerPublishAdapter } from "./index.js";
import { inlineVisuals } from "./mdx-format.js";
import { markdownToHtml } from "./markdown-html.js";

interface WordPressConfig {
  baseUrl?: string;
  status?: string;       // default 'publish'
  seoPlugin?: "yoast" | "rankmath" | "none";
}

interface WordPressCreds {
  username?: string;
  appPassword?: string;
}

interface WpTerm {
  id: number;
  name: string;
}

export class WordPressAdapter implements PublishAdapter {
  readonly type = "wordpress";

  async publish(article: Article, site: Site, creds: Record<string, unknown>): Promise<PublishResult> {
    const c = creds as WordPressCreds;
    if (!c.username || !c.appPassword) throw new Error("wordpress adapter: missing 'username'/'appPassword' credentials");

    const cfg = (site.adapterConfig ?? {}) as WordPressConfig;
    const base = (cfg.baseUrl ?? site.baseUrl ?? "").replace(/\/$/, "");
    if (!base) throw new Error("wordpress adapter: missing base URL (adapterConfig.baseUrl or site.baseUrl)");
    const api = `${base}/wp-json/wp/v2`;
    const auth = "Basic " + Buffer.from(`${c.username}:${c.appPassword}`).toString("base64");
    const headers = { Authorization: auth, "Content-Type": "application/json" };

    // 1. Resolve taxonomy ids (search, else create).
    const categoryId = await this.resolveTerm(api, "categories", article.category, headers);
    const tagIds: number[] = [];
    for (const tag of article.tags) {
      tagIds.push(await this.resolveTerm(api, "tags", tag, headers));
    }

    // 2. Build the post payload.
    const html = markdownToHtml(inlineVisuals(article));
    const payload: Record<string, unknown> = {
      title: article.title,
      content: html,
      excerpt: article.excerpt,
      slug: article.slug,
      status: cfg.status ?? "publish",
      categories: [categoryId],
      tags: tagIds,
    };
    const meta = this.seoMeta(cfg.seoPlugin, article);
    if (meta) payload.meta = meta;

    // 3. Create the post.
    const res = await fetch(`${api}/posts`, { method: "POST", headers, body: JSON.stringify(payload) });
    if (!res.ok) throw new Error(`wordpress post failed: ${res.status} ${await res.text().catch(() => "")}`);
    const body = (await res.json()) as { id: number; link?: string };
    const url = body.link ?? `${base}/${article.slug}`;
    return { url, ref: { id: body.id, link: body.link } };
  }

  /** Find a term id by exact (case-insensitive) name, else create it. */
  private async resolveTerm(
    api: string,
    taxonomy: "categories" | "tags",
    name: string,
    headers: Record<string, string>,
  ): Promise<number> {
    const searchRes = await fetch(`${api}/${taxonomy}?search=${encodeURIComponent(name)}`, { headers });
    if (!searchRes.ok) throw new Error(`wordpress ${taxonomy} search failed: ${searchRes.status}`);
    const found = (await searchRes.json()) as WpTerm[];
    const match = found.find((t) => t.name.toLowerCase() === name.toLowerCase());
    if (match) return match.id;

    const createRes = await fetch(`${api}/${taxonomy}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name }),
    });
    if (!createRes.ok) throw new Error(`wordpress ${taxonomy} create failed: ${createRes.status} ${await createRes.text().catch(() => "")}`);
    const created = (await createRes.json()) as WpTerm;
    return created.id;
  }

  private seoMeta(plugin: WordPressConfig["seoPlugin"], article: Article): Record<string, string> | undefined {
    if (plugin === "yoast") {
      return { _yoast_wpseo_title: article.title, _yoast_wpseo_metadesc: article.excerpt };
    }
    if (plugin === "rankmath") {
      return { rank_math_title: article.title, rank_math_description: article.excerpt };
    }
    return undefined;
  }
}

registerPublishAdapter("wordpress", () => new WordPressAdapter());
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/wordpress.test.ts`
Expected: PASS (5 passed).

- [ ] **Step 5: Commit**

```bash
git add src/adapters/publish/wordpress.ts tests/wordpress.test.ts
git commit -m "feat: WordPress publish adapter (REST post + taxonomy + SEO meta)"
```

---

### Task 4: Payload CMS publish adapter

**Files:**
- Create: `src/adapters/publish/payload.ts`
- Test: `tests/payload.test.ts`

Behavior. `adapterConfig`: `{ baseUrl?, collection?, contentField?, statusField?, status?, extraFields? }`. Defaults: `collection="posts"`, `contentField="content"`, no status field unless `statusField` set. `creds`: `{ apiKey }` (sent as `Authorization: <apiKeyPrefix> <key>` — Payload's API-key auth header is `"<slug> API-Key <key>"`; we keep it configurable via `adapterConfig.authScheme`, default `"users API-Key"`). Steps:
1. Build the doc: `title`, `slug`, `excerpt`, `[contentField]` = `inlineVisuals(article)` (markdown string), `date`, `tags`, plus any `extraFields` merged in; if `statusField` set, `[statusField] = status ?? "published"`.
2. `POST {baseUrl}/api/{collection}` with the auth header. Payload returns `{ doc: { id, ... } }` (create responses wrap the document under `doc`). Return `{ url, ref: { id } }` with `url = ${site.baseUrl}/${collection}/${slug}` (fallback to slug).

- [ ] **Step 1: Write the failing test — `tests/payload.test.ts`** (mocks `fetch`)

```ts
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
    expect(sent._status).toBeUndefined(); // no statusField configured
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/payload.test.ts`
Expected: FAIL ("Cannot find module ... payload.js").

- [ ] **Step 3: Implement `src/adapters/publish/payload.ts`**

```ts
import type { Article } from "../../domain/article.js";
import type { Site } from "../../service/sites.js";
import type { PublishAdapter, PublishResult } from "./index.js";
import { registerPublishAdapter } from "./index.js";
import { inlineVisuals } from "./mdx-format.js";

interface PayloadConfig {
  baseUrl?: string;
  collection?: string;
  contentField?: string;
  statusField?: string;
  status?: string;
  authScheme?: string;
  extraFields?: Record<string, unknown>;
}

interface PayloadCreds {
  apiKey?: string;
}

export class PayloadAdapter implements PublishAdapter {
  readonly type = "payload";

  async publish(article: Article, site: Site, creds: Record<string, unknown>): Promise<PublishResult> {
    const apiKey = (creds as PayloadCreds).apiKey;
    if (!apiKey) throw new Error("payload adapter: missing 'apiKey' credential");

    const cfg = (site.adapterConfig ?? {}) as PayloadConfig;
    const base = (cfg.baseUrl ?? site.baseUrl ?? "").replace(/\/$/, "");
    if (!base) throw new Error("payload adapter: missing base URL (adapterConfig.baseUrl or site.baseUrl)");
    const collection = cfg.collection ?? "posts";
    const contentField = cfg.contentField ?? "content";
    const authScheme = cfg.authScheme ?? "users API-Key";

    const doc: Record<string, unknown> = {
      title: article.title,
      slug: article.slug,
      excerpt: article.excerpt,
      [contentField]: inlineVisuals(article),
      date: article.date,
      tags: article.tags,
      ...(cfg.extraFields ?? {}),
    };
    if (cfg.statusField) doc[cfg.statusField] = cfg.status ?? "published";

    const res = await fetch(`${base}/api/${collection}`, {
      method: "POST",
      headers: { Authorization: `${authScheme} ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(doc),
    });
    if (!res.ok) throw new Error(`payload create failed: ${res.status} ${await res.text().catch(() => "")}`);
    const body = (await res.json()) as { doc?: { id: string | number } };
    const id = body.doc?.id;
    const url = site.baseUrl ? `${site.baseUrl.replace(/\/$/, "")}/${collection}/${article.slug}` : article.slug;
    return { url, ref: { id } };
  }
}

registerPublishAdapter("payload", () => new PayloadAdapter());
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/payload.test.ts`
Expected: PASS (5 passed).

- [ ] **Step 5: Commit**

```bash
git add src/adapters/publish/payload.ts tests/payload.test.ts
git commit -m "feat: Payload CMS publish adapter (REST create, markdown field)"
```

---

### Task 5: Register the new adapters in orchestrator + CLI

**Files:**
- Modify: `src/generation/orchestrator.ts`
- Modify: `src/cli/index.ts`

- [ ] **Step 1: Add side-effect imports to `src/generation/orchestrator.ts`**

Find the existing adapter side-effect imports at the top:
```ts
import "../adapters/publish/webhook.js";
import "../adapters/publish/github-mdx.js";
```
and add the two new ones immediately after:
```ts
import "../adapters/publish/wordpress.js";
import "../adapters/publish/payload.js";
```

- [ ] **Step 2: Add the same side-effect imports to `src/cli/index.ts`**

Find the existing block:
```ts
import "../adapters/publish/webhook.js";
import "../adapters/publish/github-mdx.js";
```
and add after it:
```ts
import "../adapters/publish/wordpress.js";
import "../adapters/publish/payload.js";
```

- [ ] **Step 3: Typecheck + full suite**

Run: `npm run typecheck`
Expected: clean.

Run: `npx vitest run`
Expected: all test files pass (Phases 1–3 together).

- [ ] **Step 4: Smoke-check adapter registration**

Run:
```bash
npx tsx -e "import('./src/generation/orchestrator.js').then(async () => { const { getPublishAdapter } = await import('./src/adapters/publish/index.js'); for (const t of ['webhook','github-mdx','wordpress','payload']) console.log(t, '->', getPublishAdapter(t).type); })"
```
Expected: prints each type mapping (`wordpress -> wordpress`, `payload -> payload`, etc.) with no "unknown publish adapter" error.

- [ ] **Step 5: Commit**

```bash
git add src/generation/orchestrator.ts src/cli/index.ts
git commit -m "feat: register wordpress + payload adapters (orchestrator + CLI)"
```

---

### Task 6: Docs — README + .env.example for WordPress & Payload

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update `README.md`**

Add a new section after the Phase 2 section and update the Roadmap line. Insert:

```markdown
## Phase 3 (done): WordPress + Payload adapters

**WordPress** — publishes via the REST API: Markdown→HTML body (visuals inlined as `<svg>`/`<img>`),
title/excerpt/slug/status, category from `article.category` and tags from `article.tags`
(resolved by name, created if missing), and SEO meta for Yoast or Rank Math.

```bash
npm run cli -- site:add --brand <brandId> --name "WP Blog" --slug wpblog --adapter wordpress \
  --base-url https://blog.example.com \
  --config '{"status":"publish","seoPlugin":"yoast"}'
npm run cli -- creds:set --site <siteId> --integration wordpress \
  --json '{"username":"admin","appPassword":"xxxx xxxx xxxx xxxx"}'
```
(Use a WordPress **Application Password**, not the login password.)

**Payload CMS** — creates a document in a configurable collection, sending the body as Markdown
into a configurable field (default `content`).

```bash
npm run cli -- site:add --brand <brandId> --name "Payload Site" --slug pl --adapter payload \
  --base-url https://cms.example.com \
  --config '{"collection":"posts","contentField":"content","statusField":"_status","status":"published","authScheme":"users API-Key"}'
npm run cli -- creds:set --site <siteId> --integration payload --json '{"apiKey":"xxxxx"}'
```
```

Then change the Roadmap line from:
```markdown
## Roadmap
Phase 3: WordPress + Payload adapters. Phase 4: maintenance jobs (internal links, refresh,
reindex) + social distribution. Phase 5: HTTP API + dashboard.
```
to:
```markdown
## Roadmap
Phase 4: maintenance jobs (internal links, refresh, reindex) + social distribution.
Phase 5: HTTP API + dashboard.
```

(Render real backtick fences in the file.)

- [ ] **Step 2: Full suite + typecheck (docs-only sanity)**

Run: `npx vitest run && npm run typecheck`
Expected: all green.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document Phase 3 WordPress + Payload adapters"
```

---

## Self-Review (against the spec)

**Spec coverage (Phase 3, §10 + §4):**
- WordPress adapter: Markdown→HTML post, categories/tags, SEO fields → Tasks 2, 3. ✓
- Payload adapter: create a collection document, body in a (markdown) field → Task 4. ✓
- Both behind the existing `PublishAdapter` seam; visuals resolved via shared `inlineVisuals` → Tasks 3, 4. ✓
- Registration so the orchestrator/CLI can use `--adapter wordpress|payload` → Task 5. ✓
- Per-site config + encrypted credentials (reuses existing `creds:set` + `adapterConfig`) → Tasks 3, 4, 6. ✓
- Docs/convention for operators → Task 6. ✓

**Placeholder scan:** No TBD/TODO/"add error handling"-style steps; every code step shows full code.

**Type consistency:** Both adapters implement `PublishAdapter` and return `PublishResult` (`{url, ref}`), matching the Phase 1 interface used by the orchestrator. `inlineVisuals(article)→string` and `markdownToHtml(string)→string` signatures match their call sites. Adapters self-register as `"wordpress"` / `"payload"` matching `site.adapterType`. `adapterConfig`/`creds` are read as `Record<string,unknown>` and narrowed locally, consistent with the webhook/github-mdx adapters.

**Decisions captured (from brainstorming):** Payload sends Markdown into a configurable field (no Lexical AST conversion this phase). WordPress scope = post + taxonomy + SEO meta (no featured-media upload this phase; visuals stay inline). Both are noted as deliberate scope boundaries, extensible later.

**Note on marked + raw HTML:** `marked` passes through raw inline HTML/SVG by default and does not sanitize — intended here because the engine publishes its own generated content (not untrusted input). If a future phase ingests third-party content, add sanitization at that point.
