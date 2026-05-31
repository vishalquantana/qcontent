# qcontent Phase 4 (Maintenance jobs + Social distribution) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add four new job types beyond `generate` — `reindex`, `maintain-links`, `refresh`, and `distribute-social` — plus the foundations they need: a full-article snapshot in `published_content`, an optional `update()` on every publish adapter, and a job dispatcher wired into the scheduler + CLI.

**Architecture:** A new `jobs/` layer holds one runner per job type, all sharing a `JobResult` shape and the existing `startRun` recorder. A new `article` JSON column on `published_content` snapshots the full canonical `Article` at publish time, so maintenance jobs read content adapter-agnostically from our own DB. `PublishAdapter` gains an optional `update(article, ref, site, creds)` implemented for all four adapters; jobs that mutate content call it. A `runJob(db, siteId, jobType, opts)` dispatcher replaces the scheduler's hard-coded `generate` call and powers `qcontent run --job <type>`.

**Tech Stack:** Existing (TS ESM, Drizzle/Turso, zod, vitest, marked) + **`playwright`** (Chromium) for rendering branded carousel PNGs. The Playwright screenshot call is isolated in one module behind an injectable `RenderFn` so jobs are unit-tested without a browser; a single env-gated smoke test exercises real Chromium.

> **Chromium caveat:** this sandbox has had trouble running postinstall binaries (`npm install --ignore-scripts` was needed for earlier deps). `playwright` needs its browser binary via `npx playwright install chromium`. If that can't run here, the renderer module still type-checks and unit-tests (template + injected fake render) pass; only the env-gated real-render smoke test is skipped. The carousel renderer is therefore built and tested logically now; the browser binary is an operational install step documented in the README.

**Spec:** `docs/superpowers/specs/2026-05-31-qcontent-multisite-engine-design.md` — Phase 4 in §10; jobs §6.

**Builds on Phases 1–3 (merged to master).** Existing exports this plan uses/extends:
- `Article`, `ArticleSchema` (`src/domain/article.js`); `validateArticle` (`src/domain/validators.js`)
- `Site` (`src/service/sites.js`); `getSite`; `getBrand` (`src/service/brands.js`)
- `getCredential` (`src/service/credentials.js`); `startRun`, `RunHandle` (`src/service/runs.js`)
- `publishedContent` table (`src/db/schema.js`); `recordPublished`, `getAllSlugs`, `slugExists`, `getPublishedForSite` (new) (`src/service/published.js`)
- `PublishAdapter`, `PublishResult`, `getPublishAdapter`, `registerPublishAdapter` (`src/adapters/publish/index.js`)
- the four adapters: `webhook.js`, `github-mdx.js`, `wordpress.js`, `payload.js`
- `GitHubClient` (`src/github/client.js`); `inlineVisuals` (`src/adapters/publish/mdx-format.js`); `articleToMdx` (`src/adapters/publish/mdx-format.js`); `markdownToHtml` (`src/adapters/publish/markdown-html.js`)
- `runIndexing`, `ServiceAccount` (`src/adapters/index/google-indexing.js`)
- `getLLMProvider` (`src/providers/llm/index.js`); `runGenerate`, `GenerateResult` (`src/generation/orchestrator.js`)
- `runMigrations` (`src/db/migrate.js`); `makeDb`, `DB` (`src/db/client.js`)

**Conventions (carry over):**
- ESM/NodeNext: project imports use `.js`; tests import `../src/...js`.
- `noUncheckedIndexedAccess` on — guard indexed access with `!`/`??`.
- Adapters/jobs self-register via a side-effect at the bottom of their module; the dispatcher imports the job modules.
- DB tests use a temp-file libSQL URL: `file:${join(tmpdir(), \`qcontent-<name>-test-${randomUUID()}.db\`)}` (NOT `file::memory:?cache=shared`).
- Node 26 global `fetch`. zod v3.

---

## File Structure (Phase 4)

```
src/
  db/
    schema.ts            # MODIFY: add `article` (json) column to publishedContent
    migrate.ts           # MODIFY: add column in CREATE + guarded ALTER for existing DBs
  service/
    published.ts         # MODIFY: store article snapshot; add getPublishedForSite, updatePublishedArticle
  adapters/
    publish/
      index.ts           # MODIFY: add optional update() to PublishAdapter
      webhook.ts         # MODIFY: implement update()
      github-mdx.ts      # MODIFY: implement update()
      wordpress.ts       # MODIFY: implement update()
      payload.ts         # MODIFY: implement update()
    social/
      upload-post.ts     # NEW: deliverCarousel(creds, payload) -> Upload-Post or generic webhook
  generation/
    orchestrator.ts      # MODIFY: pass article snapshot into recordPublished
  jobs/
    types.ts             # NEW: JobResult, JobArgs
    links.ts             # NEW: injectInternalLinks() pure function + keyword helpers
    reindex.ts           # NEW: runReindex
    maintain-links.ts    # NEW: runMaintainLinks
    refresh.ts           # NEW: runRefresh (staleness select + LLM regen + update)
    distribute-social.ts # NEW: slide-data generation + delivery
    index.ts             # NEW: runJob dispatcher (registry of job runners)
  scheduler/
    worker.ts            # MODIFY: tick() dispatches via runJob for any job type
  cli/
    index.ts             # MODIFY: `run --job <type>` routes through runJob
tests/
  published-snapshot.test.ts
  adapter-update.test.ts
  social-carousel-render.test.ts
  social-upload-post.test.ts
  jobs-reindex.test.ts
  jobs-links.test.ts
  jobs-maintain-links.test.ts
  jobs-refresh.test.ts
  jobs-distribute-social.test.ts
  jobs-dispatch.test.ts
```

Repo root: `/Users/vishalkumar/Downloads/qcontent`. Controller creates branch `phase4-maintenance-social` before Task 1.

---

### Task 1: Snapshot the full Article in `published_content`

**Files:**
- Modify: `src/db/schema.ts`, `src/db/migrate.ts`, `src/service/published.ts`, `src/generation/orchestrator.ts`
- Test: `tests/published-snapshot.test.ts`

- [ ] **Step 1: Write the failing test — `tests/published-snapshot.test.ts`**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/published-snapshot.test.ts`
Expected: FAIL (`getPublishedForSite`/`updatePublishedArticle` not exported; `article` column missing).

- [ ] **Step 3: Add the `article` column in `src/db/schema.ts`**

In the `publishedContent` table definition, add this column alongside the existing ones (after `contentHash`):

```ts
  article: text("article", { mode: "json" }).$type<Record<string, unknown>>(),
```

- [ ] **Step 4: Update `src/db/migrate.ts`**

In the `CREATE TABLE IF NOT EXISTS published_content (...)` statement, add `article TEXT,` to the column list (e.g. after `content_hash TEXT,`). Then, AFTER the DDL loop in `runMigrations`, add a guarded ALTER so pre-existing DBs gain the column. Replace the end of `runMigrations` (the part after the `for (const stmt ...)` loop and before `client.close()`) with:

```ts
  // Idempotent column add for DBs created before the snapshot column existed.
  try {
    await client.execute("ALTER TABLE published_content ADD COLUMN article TEXT");
  } catch {
    // Column already exists (fresh DBs get it from CREATE TABLE) — ignore.
  }
  client.close();
```

(Keep the existing `for (const stmt of DDL...)` loop and the CLI entry guard unchanged.)

- [ ] **Step 5: Update `src/service/published.ts`**

Add `article` to `recordPublished`'s args and insert; add the two new functions. Add `eq` and `desc` to the `drizzle-orm` import if not present (it already imports `and, eq`; add `desc`). Replace the `recordPublished` signature/body and append the new functions:

```ts
import { randomUUID } from "node:crypto";
import { and, eq, desc } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { publishedContent } from "../db/schema.js";
import type { Article } from "../domain/article.js";

export async function slugExists(db: DB, siteId: string, slug: string): Promise<boolean> {
  const rows = await db
    .select({ id: publishedContent.id })
    .from(publishedContent)
    .where(and(eq(publishedContent.siteId, siteId), eq(publishedContent.slug, slug)))
    .limit(1);
  return rows.length > 0;
}

export async function getAllSlugs(db: DB, siteId: string): Promise<string[]> {
  const rows = await db
    .select({ slug: publishedContent.slug })
    .from(publishedContent)
    .where(eq(publishedContent.siteId, siteId));
  return rows.map((r) => r.slug);
}

export async function recordPublished(
  db: DB,
  args: {
    siteId: string; slug: string; url?: string; contentType?: string; title?: string;
    adapterRef?: Record<string, unknown>; contentHash?: string; article?: Article;
  },
): Promise<void> {
  const { article, ...rest } = args;
  await db.insert(publishedContent).values({
    id: randomUUID(),
    ...rest,
    article: (article as unknown as Record<string, unknown>) ?? undefined,
  } as typeof publishedContent.$inferInsert);
}

export interface PublishedRow {
  id: string;
  siteId: string;
  slug: string;
  url: string | null;
  contentType: string | null;
  title: string | null;
  adapterRef: Record<string, unknown> | null;
  contentHash: string | null;
  socialPosted: number;
  article: Article | null;
  publishedAt: Date | null;
}

export async function getPublishedForSite(db: DB, siteId: string): Promise<PublishedRow[]> {
  const rows = await db
    .select()
    .from(publishedContent)
    .where(eq(publishedContent.siteId, siteId))
    .orderBy(desc(publishedContent.publishedAt));
  return rows.map((r) => ({
    id: r.id,
    siteId: r.siteId,
    slug: r.slug,
    url: r.url ?? null,
    contentType: r.contentType ?? null,
    title: r.title ?? null,
    adapterRef: (r.adapterRef as Record<string, unknown> | null) ?? null,
    contentHash: r.contentHash ?? null,
    socialPosted: r.socialPosted,
    article: (r.article as unknown as Article | null) ?? null,
    publishedAt: r.publishedAt ?? null,
  }));
}

export async function updatePublishedArticle(
  db: DB,
  id: string,
  args: { article: Article; url?: string; contentHash?: string },
): Promise<void> {
  await db
    .update(publishedContent)
    .set({
      article: args.article as unknown as Record<string, unknown>,
      ...(args.url ? { url: args.url } : {}),
      ...(args.contentHash ? { contentHash: args.contentHash } : {}),
    })
    .where(eq(publishedContent.id, id));
}

export async function markSocialPosted(db: DB, id: string): Promise<void> {
  await db.update(publishedContent).set({ socialPosted: 1 }).where(eq(publishedContent.id, id));
}
```

> Note: keep any existing imports/exports in `published.ts` that aren't shown — this replaces `recordPublished` and adds functions; `slugExists`/`getAllSlugs` are repeated here verbatim so the file is consistent if you rewrite it wholesale. If you prefer surgical edits, only change the `drizzle-orm` import (add `desc`), the `recordPublished` body (add `article`), and append `PublishedRow`, `getPublishedForSite`, `updatePublishedArticle`, `markSocialPosted`.

- [ ] **Step 6: Update `src/generation/orchestrator.ts` to store the snapshot**

Find the existing `recordPublished` call and add `article` to it:

```ts
    await recordPublished(db, {
      siteId: args.siteId, slug: article.slug, url: published.url, contentType,
      title: article.title, adapterRef: published.ref as Record<string, unknown>, contentHash,
      article,
    });
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npx vitest run tests/published-snapshot.test.ts`
Expected: PASS (2 passed).

- [ ] **Step 8: Full suite + typecheck**

Run: `npx vitest run && npm run typecheck`
Expected: all green (existing generate/e2e tests still pass; they now also write the snapshot).

- [ ] **Step 9: Commit**

```bash
git add src/db/schema.ts src/db/migrate.ts src/service/published.ts src/generation/orchestrator.ts tests/published-snapshot.test.ts
git commit -m "feat: snapshot full Article in published_content + read/update helpers"
```

---

### Task 2: Add `update()` to the adapter interface + webhook & github-mdx

**Files:**
- Modify: `src/adapters/publish/index.ts`, `src/adapters/publish/webhook.ts`, `src/adapters/publish/github-mdx.ts`
- Test: `tests/adapter-update.test.ts`

- [ ] **Step 1: Write the failing test — `tests/adapter-update.test.ts`** (mocks `fetch`; covers webhook + github-mdx update)

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { WebhookAdapter } from "../src/adapters/publish/webhook.js";
import { GitHubMdxAdapter } from "../src/adapters/publish/github-mdx.js";
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
    expect(sent.sha).toBe("oldsha"); // update requires the current blob sha
    const text = Buffer.from(sent.content, "base64").toString("utf8");
    expect(text).toContain("<svg/>");
    expect(text).not.toContain("{{visual:v}}");
    expect(result.url).toBe("https://example.com/guides/cut-blinkit-ad-waste-2026");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/adapter-update.test.ts`
Expected: FAIL (`update` is not a function / not defined).

- [ ] **Step 3: Add optional `update()` to `src/adapters/publish/index.ts`**

Add to the `PublishAdapter` interface (after `publish`):

```ts
  update?(article: Article, ref: unknown, site: Site, creds: Record<string, unknown>): Promise<PublishResult>;
```

- [ ] **Step 4: Implement `update()` in `src/adapters/publish/webhook.ts`**

Add a method to `WebhookAdapter` (reuse the same endpoint logic as `publish`). The simplest correct approach is to factor the POST into the existing publish and add `update` that POSTs with `action: "update"`:

```ts
  async update(article: Article, _ref: unknown, site: Site, creds: Record<string, unknown>): Promise<PublishResult> {
    const endpoint = (creds.url as string | undefined) ?? ((site.adapterConfig as Record<string, unknown> | null)?.url as string | undefined);
    if (!endpoint) throw new Error("webhook adapter: missing 'url' in credentials or adapterConfig");
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (creds.token) headers.Authorization = `Bearer ${creds.token as string}`;
    const res = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({ action: "update", site: { id: site.id, baseUrl: site.baseUrl }, article }),
    });
    if (!res.ok) throw new Error(`webhook update failed: ${res.status} ${await res.text().catch(() => "")}`);
    const ref = await res.json().catch(() => ({}));
    const url = site.baseUrl ? `${site.baseUrl.replace(/\/$/, "")}/${article.slug}` : article.slug;
    return { url, ref };
  }
```

(Add `import type { Article } ...` if not already imported — it is, via the existing `publish` signature.)

- [ ] **Step 5: Implement `update()` in `src/adapters/publish/github-mdx.ts`**

Add a method to `GitHubMdxAdapter`. It reads the existing file's sha (from `ref.path`/`ref.branch`, falling back to recomputing the path from config), then re-PUTs with the new MDX:

```ts
  async update(article: Article, ref: unknown, site: Site, creds: Record<string, unknown>): Promise<PublishResult> {
    const token = creds.token as string | undefined;
    if (!token) throw new Error("github-mdx adapter: missing 'token' credential");
    const cfg = (site.adapterConfig ?? {}) as { owner?: string; repo?: string; branch?: string; basePath?: string; type?: string };
    if (!cfg.owner || !cfg.repo) throw new Error("github-mdx adapter: adapterConfig.owner and .repo are required");
    const r = (ref ?? {}) as { path?: string; branch?: string };
    const branch = r.branch ?? cfg.branch ?? "main";
    const basePath = cfg.basePath ?? "content";
    const type = cfg.type ?? "guides";
    const filePath = r.path ?? mdxPath(article.slug, type, basePath);
    const gh = new GitHubClient(token);

    const existing = await gh.getFile(cfg.owner, cfg.repo, filePath, branch);
    const res = await gh.putFile({
      owner: cfg.owner, repo: cfg.repo, path: filePath,
      message: `content: update "${article.title}"`, content: articleToMdx(article), branch,
      ...(existing ? { sha: existing.sha } : {}),
    });
    const url = site.baseUrl ? `${site.baseUrl.replace(/\/$/, "")}/${type}/${article.slug}` : article.slug;
    return { url, ref: { commitSha: res.commitSha, path: filePath, branch } };
  }
```

(`mdxPath`, `articleToMdx`, `GitHubClient` are already imported in this file.)

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/adapter-update.test.ts`
Expected: PASS (2 passed).

- [ ] **Step 7: Full suite + typecheck**

Run: `npx vitest run && npm run typecheck`
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add src/adapters/publish/index.ts src/adapters/publish/webhook.ts src/adapters/publish/github-mdx.ts tests/adapter-update.test.ts
git commit -m "feat: optional PublishAdapter.update() + webhook & github-mdx impls"
```

---

### Task 3: `update()` for WordPress & Payload

**Files:**
- Modify: `src/adapters/publish/wordpress.ts`, `src/adapters/publish/payload.ts`
- Test: append to `tests/adapter-update.test.ts`

- [ ] **Step 1: Add the failing tests — append to `tests/adapter-update.test.ts`**

```ts
import { WordPressAdapter } from "../src/adapters/publish/wordpress.js";
import { PayloadAdapter } from "../src/adapters/publish/payload.js";

describe("WordPressAdapter.update", () => {
  it("PATCHes the existing post by id with HTML content", async () => {
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
    expect(call.init!.method).toBe("POST"); // WP REST accepts POST for updates to /posts/{id}
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/adapter-update.test.ts`
Expected: FAIL (WordPress/Payload `update` not defined).

- [ ] **Step 3: Implement `update()` in `src/adapters/publish/wordpress.ts`**

Add a method to `WordPressAdapter` (reuses the SEO/content building; updates by id, does not touch taxonomy):

```ts
  async update(article: Article, ref: unknown, site: Site, creds: Record<string, unknown>): Promise<PublishResult> {
    const c = creds as { username?: string; appPassword?: string };
    if (!c.username || !c.appPassword) throw new Error("wordpress adapter: missing 'username'/'appPassword' credentials");
    const id = (ref as { id?: number | string } | null)?.id;
    if (id === undefined || id === null) throw new Error("wordpress adapter: update requires ref.id");
    const cfg = (site.adapterConfig ?? {}) as { baseUrl?: string; status?: string; seoPlugin?: "yoast" | "rankmath" | "none" };
    const base = (cfg.baseUrl ?? site.baseUrl ?? "").replace(/\/$/, "");
    if (!base) throw new Error("wordpress adapter: missing base URL");
    const auth = "Basic " + Buffer.from(`${c.username}:${c.appPassword}`).toString("base64");
    const headers = { Authorization: auth, "Content-Type": "application/json" };

    const payload: Record<string, unknown> = {
      title: article.title,
      content: markdownToHtml(inlineVisuals(article)),
      excerpt: article.excerpt,
    };
    const meta = this.seoMeta(cfg.seoPlugin, article);
    if (meta) payload.meta = meta;

    const res = await fetch(`${base}/wp-json/wp/v2/posts/${id}`, { method: "POST", headers, body: JSON.stringify(payload) });
    if (!res.ok) throw new Error(`wordpress update failed: ${res.status} ${await res.text().catch(() => "")}`);
    const body = (await res.json()) as { id: number; link?: string };
    const url = body.link ?? `${base}/${article.slug}`;
    return { url, ref: { id: body.id, link: body.link } };
  }
```

(`this.seoMeta`, `markdownToHtml`, `inlineVisuals` already exist/are imported in this file.)

- [ ] **Step 4: Implement `update()` in `src/adapters/publish/payload.ts`**

Add a method to `PayloadAdapter`:

```ts
  async update(article: Article, ref: unknown, site: Site, creds: Record<string, unknown>): Promise<PublishResult> {
    const apiKey = (creds as { apiKey?: string }).apiKey;
    if (!apiKey) throw new Error("payload adapter: missing 'apiKey' credential");
    const id = (ref as { id?: string | number } | null)?.id;
    if (id === undefined || id === null) throw new Error("payload adapter: update requires ref.id");
    const cfg = (site.adapterConfig ?? {}) as { baseUrl?: string; collection?: string; contentField?: string; authScheme?: string };
    const base = (cfg.baseUrl ?? site.baseUrl ?? "").replace(/\/$/, "");
    if (!base) throw new Error("payload adapter: missing base URL");
    const collection = cfg.collection ?? "posts";
    const contentField = cfg.contentField ?? "content";
    const authScheme = cfg.authScheme ?? "users API-Key";

    const doc: Record<string, unknown> = {
      title: article.title,
      excerpt: article.excerpt,
      [contentField]: inlineVisuals(article),
    };
    const res = await fetch(`${base}/api/${collection}/${id}`, {
      method: "PATCH",
      headers: { Authorization: `${authScheme} ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(doc),
    });
    if (!res.ok) throw new Error(`payload update failed: ${res.status} ${await res.text().catch(() => "")}`);
    const url = base ? `${base}/${collection}/${article.slug}` : article.slug;
    return { url, ref: { id } };
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/adapter-update.test.ts`
Expected: PASS (4 passed total in the file).

- [ ] **Step 6: Full suite + typecheck**

Run: `npx vitest run && npm run typecheck`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add src/adapters/publish/wordpress.ts src/adapters/publish/payload.ts tests/adapter-update.test.ts
git commit -m "feat: WordPress + Payload adapter update() by id"
```

---

### Task 4: Job types + `reindex` job + dispatcher skeleton

**Files:**
- Create: `src/jobs/types.ts`, `src/jobs/reindex.ts`, `src/jobs/index.ts`
- Test: `tests/jobs-reindex.test.ts`

- [ ] **Step 1: Write the failing test — `tests/jobs-reindex.test.ts`**

```ts
import { describe, it, expect, beforeAll, vi } from "vitest";
import { randomUUID, randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMigrations } from "../src/db/migrate.js";
import { makeDb } from "../src/db/client.js";
import { createBrand } from "../src/service/brands.js";
import { createSite } from "../src/service/sites.js";
import { saveCredential } from "../src/service/credentials.js";
import { recordPublished } from "../src/service/published.js";
import { runReindex } from "../src/jobs/reindex.js";

const URL = `file:${join(tmpdir(), `qcontent-reindex-test-${randomUUID()}.db`)}`;

vi.mock("jose", () => ({
  importPKCS8: vi.fn().mockResolvedValue({ fake: "k" }),
  SignJWT: class { setProtectedHeader(){return this;} setIssuedAt(){return this;} setIssuer(){return this;} setSubject(){return this;} setAudience(){return this;} setExpirationTime(){return this;} async sign(){return "jwt";} },
}));

let siteId: string;
beforeAll(async () => {
  process.env.QCONTENT_MASTER_KEY = randomBytes(32).toString("base64");
  await runMigrations(URL);
  const db = makeDb(URL);
  const brand = await createBrand(db, { name: "B", slug: "b-reindex" });
  const site = await createSite(db, { brandId: brand.id, name: "S", slug: "s-reindex", adapterType: "webhook", baseUrl: "https://x.test", indexing: { sitemapUrl: "https://x.test/sitemap.xml" } });
  siteId = site.id;
  await saveCredential(db, { siteId, integration: "google-indexing", secret: { client_email: "svc@x.iam", private_key: "-----BEGIN PRIVATE KEY-----\nMII\n-----END PRIVATE KEY-----\n" } });
  await recordPublished(db, { siteId, slug: "a", url: "https://x.test/guides/a", contentType: "guides", title: "A" });
  await recordPublished(db, { siteId, slug: "b", url: "https://x.test/guides/b", contentType: "guides", title: "B" });
});

describe("runReindex", () => {
  it("submits every published URL and reports a count", async () => {
    const db = makeDb(URL);
    const submitted: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "https://oauth2.googleapis.com/token") return { ok: true, status: 200, json: async () => ({ access_token: "at" }) } as Response;
      if (url.includes("urlNotifications:publish")) { submitted.push(JSON.parse(init!.body as string).url); return { ok: true, status: 200, json: async () => ({}) } as Response; }
      return { ok: true, status: 200, text: async () => "OK" } as Response; // sitemap ping
    }) as never);

    const result = await runReindex(db, { siteId });
    expect(result.status).toBe("ok");
    expect(submitted.sort()).toEqual(["https://x.test/guides/a", "https://x.test/guides/b"]);
    expect(result.summary?.submitted).toBe(2);
  });

  it("skips (ok) when the site has no google-indexing credential", async () => {
    const db = makeDb(URL);
    const brand = await createBrand(db, { name: "B2", slug: "b-reindex2" });
    const site = await createSite(db, { brandId: brand.id, name: "S2", slug: "s-reindex2", adapterType: "webhook", baseUrl: "https://y.test" });
    await recordPublished(db, { siteId: site.id, slug: "c", url: "https://y.test/c" });
    const result = await runReindex(db, { siteId: site.id });
    expect(result.status).toBe("ok");
    expect(result.summary?.skipped).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/jobs-reindex.test.ts`
Expected: FAIL ("Cannot find module ... reindex.js").

- [ ] **Step 3: Implement `src/jobs/types.ts`**

```ts
import type { DB } from "../db/client.js";

export interface JobArgs {
  siteId: string;
  [key: string]: unknown;
}

export interface JobResult {
  status: "ok" | "failed";
  summary?: Record<string, unknown>;
  error?: string;
}

export type JobRunner = (db: DB, args: JobArgs) => Promise<JobResult>;
```

- [ ] **Step 4: Implement `src/jobs/reindex.ts`**

```ts
import type { DB } from "../db/client.js";
import type { JobArgs, JobResult } from "./types.js";
import { getSite } from "../service/sites.js";
import { getCredential } from "../service/credentials.js";
import { getPublishedForSite } from "../service/published.js";
import { startRun } from "../service/runs.js";
import { runIndexing, type ServiceAccount } from "../adapters/index/google-indexing.js";

export async function runReindex(db: DB, args: JobArgs): Promise<JobResult> {
  const run = await startRun(db, { siteId: args.siteId, jobType: "reindex" });
  try {
    const site = await getSite(db, args.siteId);
    if (!site) throw new Error(`site not found: ${args.siteId}`);
    const sa = await getCredential<ServiceAccount>(db, args.siteId, "google-indexing");
    if (!sa) {
      await run.log("info", "no google-indexing credential; skipping", {});
      await run.finishOk({ skipped: true });
      return { status: "ok", summary: { skipped: true } };
    }
    const sitemapUrl = (site.indexing as Record<string, unknown> | null)?.sitemapUrl as string | undefined;
    const rows = await getPublishedForSite(db, args.siteId);
    let submitted = 0;
    for (const row of rows) {
      if (!row.url) continue;
      const res = await runIndexing(sa, row.url, sitemapUrl);
      if (res.submitted) submitted++;
    }
    await run.log("info", "reindex complete", { total: rows.length, submitted });
    await run.finishOk({ skipped: false, total: rows.length, submitted });
    return { status: "ok", summary: { skipped: false, total: rows.length, submitted } };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await run.log("error", "reindex failed", { message });
    await run.finishFailed(message);
    return { status: "failed", error: message };
  }
}
```

- [ ] **Step 5: Implement `src/jobs/index.ts` (dispatcher; generate + reindex registered now, more added later)**

```ts
import type { DB } from "../db/client.js";
import type { JobArgs, JobResult, JobRunner } from "./types.js";
import { runGenerate } from "../generation/orchestrator.js";
import { runReindex } from "./reindex.js";

const runners: Record<string, JobRunner> = {
  generate: (db, args) => runGenerate(db, args as { siteId: string }) as Promise<JobResult>,
  reindex: runReindex,
};

export function registerJob(jobType: string, runner: JobRunner): void {
  runners[jobType] = runner;
}

export function knownJobTypes(): string[] {
  return Object.keys(runners);
}

export async function runJob(db: DB, jobType: string, args: JobArgs): Promise<JobResult> {
  const runner = runners[jobType];
  if (!runner) throw new Error(`unknown job type: ${jobType}`);
  return runner(db, args);
}
```

> Note: `runGenerate` returns `GenerateResult` (`{status, url?, slug?, error?}`), which is assignable to `JobResult` (status matches; extra fields are allowed structurally only if cast). The `as Promise<JobResult>` cast bridges them. That is acceptable — both share the `status` discriminant the dispatcher cares about.

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/jobs-reindex.test.ts`
Expected: PASS (2 passed).

- [ ] **Step 7: Full suite + typecheck**

Run: `npx vitest run && npm run typecheck`
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add src/jobs/types.ts src/jobs/reindex.ts src/jobs/index.ts tests/jobs-reindex.test.ts
git commit -m "feat: job types + reindex job + runJob dispatcher"
```

---

### Task 5: Internal-link injector (pure function)

**Files:**
- Create: `src/jobs/links.ts`
- Test: `tests/jobs-links.test.ts`

- [ ] **Step 1: Write the failing test — `tests/jobs-links.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { deriveKeywords, injectInternalLinks, type LinkCandidate } from "../src/jobs/links.js";

describe("deriveKeywords", () => {
  it("extracts lowercase keywords from a title, dropping stopwords", () => {
    const kws = deriveKeywords("How to Reduce Blinkit Ad Waste");
    expect(kws).toContain("blinkit");
    expect(kws).toContain("waste");
    expect(kws).not.toContain("to");
    expect(kws).not.toContain("how");
  });
});

describe("injectInternalLinks", () => {
  const candidates: LinkCandidate[] = [
    { slug: "acos", title: "ACoS Explained", url: "/learn/acos", keywords: ["acos"] },
    { slug: "dayparting", title: "Dayparting Guide", url: "/learn/dayparting", keywords: ["dayparting"] },
  ];

  it("links the first un-linked occurrence of a candidate keyword, up to maxLinks", () => {
    const body = "Lower your ACoS with dayparting and smarter bids.";
    const out = injectInternalLinks(body, candidates, 3);
    expect(out.changed).toBe(true);
    expect(out.body).toContain("[ACoS](/learn/acos)");
    expect(out.body).toContain("[dayparting](/learn/dayparting)");
  });

  it("does not double-link text already inside a markdown link", () => {
    const body = "See [ACoS](/learn/acos) for details about acos and dayparting.";
    const out = injectInternalLinks(body, candidates, 3);
    // the existing [ACoS](...) is untouched; only 'dayparting' gets linked (and at most one 'acos' not already linked)
    expect(out.body.match(/\]\(\/learn\/acos\)/g)!.length).toBe(1);
    expect(out.body).toContain("[dayparting](/learn/dayparting)");
  });

  it("respects maxLinks", () => {
    const body = "acos dayparting acos dayparting";
    const out = injectInternalLinks(body, candidates, 1);
    const links = out.body.match(/\]\(\/learn\//g) ?? [];
    expect(links.length).toBe(1);
  });

  it("never links a candidate to itself (caller filters); returns changed=false when nothing matches", () => {
    const out = injectInternalLinks("nothing relevant here", candidates, 3);
    expect(out.changed).toBe(false);
    expect(out.body).toBe("nothing relevant here");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/jobs-links.test.ts`
Expected: FAIL ("Cannot find module ... links.js").

- [ ] **Step 3: Implement `src/jobs/links.ts`**

```ts
const STOPWORDS = new Set([
  "the", "a", "an", "to", "of", "in", "on", "for", "and", "or", "with", "how", "what",
  "why", "your", "you", "is", "are", "be", "from", "by", "at", "as", "it", "this", "that",
  "guide", "vs", "best", "2026", "2025",
]);

export interface LinkCandidate {
  slug: string;
  title: string;
  url: string;
  keywords: string[];
}

export interface LinkResult {
  body: string;
  changed: boolean;
}

/** Lowercase content words from a title, minus stopwords and short tokens. */
export function deriveKeywords(title: string): string[] {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Inject up to `maxLinks` internal markdown links into `body`. For each candidate,
 * link the first occurrence of one of its keywords that is NOT already inside a
 * markdown link. Case-insensitive match; preserves the matched text's original case.
 */
export function injectInternalLinks(body: string, candidates: LinkCandidate[], maxLinks: number): LinkResult {
  let out = body;
  let added = 0;

  for (const cand of candidates) {
    if (added >= maxLinks) break;
    for (const kw of cand.keywords) {
      if (added >= maxLinks) break;
      // Match the keyword as a whole word, NOT immediately preceded by "](" or "["
      // and NOT part of an existing link target. Negative lookbehind for "[" (link text already)
      // and we avoid matches followed by "](" (link text) or preceded by "/" (url path).
      const re = new RegExp(`(?<![\\[\\w/])(${escapeRegExp(kw)})(?![\\w/])(?!\\]\\()`, "i");
      const m = re.exec(out);
      if (!m) continue;
      // Skip if this occurrence is already within a markdown link target by quick check:
      // ensure the matched index is not directly after "](".
      const idx = m.index;
      const before2 = out.slice(Math.max(0, idx - 2), idx);
      if (before2 === "](") continue;
      const matchedText = m[1]!;
      out = out.slice(0, idx) + `[${matchedText}](${cand.url})` + out.slice(idx + matchedText.length);
      added++;
      break; // one link per candidate
    }
  }

  return { body: out, changed: added > 0 };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/jobs-links.test.ts`
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
git add src/jobs/links.ts tests/jobs-links.test.ts
git commit -m "feat: internal-link injector (pure function) + keyword derivation"
```

---

### Task 6: `maintain-links` job

**Files:**
- Create: `src/jobs/maintain-links.ts`
- Modify: `src/jobs/index.ts` (register `maintain-links`)
- Test: `tests/jobs-maintain-links.test.ts`

- [ ] **Step 1: Write the failing test — `tests/jobs-maintain-links.test.ts`** (real DB, fake adapter via webhook + stubbed fetch)

```ts
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
  // Post A mentions "dayparting"; Post B is the dayparting glossary. A should get a link to B.
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

    // The stored snapshot for post A now contains a link to the dayparting url.
    const rows = await getPublishedForSite(db, siteId);
    const a = rows.find((r) => r.slug === "a")!;
    expect(a.article?.bodyMarkdown).toContain("/learn/dayparting");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/jobs-maintain-links.test.ts`
Expected: FAIL ("Cannot find module ... maintain-links.js").

- [ ] **Step 3: Implement `src/jobs/maintain-links.ts`**

```ts
import { createHash } from "node:crypto";
import type { DB } from "../db/client.js";
import type { JobArgs, JobResult } from "./types.js";
import { getSite } from "../service/sites.js";
import { getCredential } from "../service/credentials.js";
import { getPublishedForSite, updatePublishedArticle, type PublishedRow } from "../service/published.js";
import { startRun } from "../service/runs.js";
import { getPublishAdapter } from "../adapters/publish/index.js";
import { ArticleSchema, type Article } from "../domain/article.js";
import { deriveKeywords, injectInternalLinks, type LinkCandidate } from "./links.js";

export async function runMaintainLinks(db: DB, args: JobArgs): Promise<JobResult> {
  const run = await startRun(db, { siteId: args.siteId, jobType: "maintain-links" });
  try {
    const site = await getSite(db, args.siteId);
    if (!site) throw new Error(`site not found: ${args.siteId}`);
    const adapter = getPublishAdapter(site.adapterType);
    if (!adapter.update) {
      await run.log("info", "adapter does not support update; skipping", { adapter: site.adapterType });
      await run.finishOk({ skipped: true, reason: "no update()" });
      return { status: "ok", summary: { skipped: true } };
    }
    const maxLinks = (args.maxLinksPerPost as number) ?? 3;
    const creds = (await getCredential<Record<string, unknown>>(db, args.siteId, site.adapterType)) ?? {};

    const rows = (await getPublishedForSite(db, args.siteId)).filter((r): r is PublishedRow & { article: Article } => !!r.article && !!r.url);
    const candidates: LinkCandidate[] = rows.map((r) => ({
      slug: r.slug, title: r.title ?? r.article.title, url: r.url!, keywords: deriveKeywords(r.title ?? r.article.title),
    }));

    let updated = 0;
    for (const row of rows) {
      const others = candidates.filter((c) => c.slug !== row.slug);
      const { body, changed } = injectInternalLinks(row.article.bodyMarkdown, others, maxLinks);
      if (!changed) continue;
      const nextArticle = ArticleSchema.parse({ ...row.article, bodyMarkdown: body });
      const published = await adapter.update(nextArticle, row.adapterRef, site, creds);
      const contentHash = createHash("sha256").update(body).digest("hex");
      await updatePublishedArticle(db, row.id, { article: nextArticle, url: published.url, contentHash });
      updated++;
      await run.log("info", "linked post", { slug: row.slug });
    }

    await run.finishOk({ updated, scanned: rows.length });
    return { status: "ok", summary: { updated, scanned: rows.length } };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await run.log("error", "maintain-links failed", { message });
    await run.finishFailed(message);
    return { status: "failed", error: message };
  }
}
```

- [ ] **Step 4: Register it in `src/jobs/index.ts`**

Add the import and registry entry:

```ts
import { runMaintainLinks } from "./maintain-links.js";
```
and in the `runners` object add:
```ts
  "maintain-links": runMaintainLinks,
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/jobs-maintain-links.test.ts`
Expected: PASS (1 passed).

- [ ] **Step 6: Full suite + typecheck**

Run: `npx vitest run && npm run typecheck`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add src/jobs/maintain-links.ts src/jobs/index.ts tests/jobs-maintain-links.test.ts
git commit -m "feat: maintain-links job (internal-link backfill via adapter.update)"
```

---

### Task 7: `refresh` job

**Files:**
- Create: `src/jobs/refresh.ts`
- Modify: `src/jobs/index.ts` (register `refresh`)
- Test: `tests/jobs-refresh.test.ts`

- [ ] **Step 1: Write the failing test — `tests/jobs-refresh.test.ts`**

```ts
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
    ] as never[];
    const picked = selectStale(rows, now, 60, 1);
    expect(picked.map((r) => (r as { id: string }).id)).toEqual(["old1"]);
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
    expect(old.slug).toBe("old"); // slug preserved
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/jobs-refresh.test.ts`
Expected: FAIL ("Cannot find module ... refresh.js").

- [ ] **Step 3: Implement `src/jobs/refresh.ts`**

```ts
import { createHash } from "node:crypto";
import type { DB } from "../db/client.js";
import type { JobArgs, JobResult } from "./types.js";
import { getSite } from "../service/sites.js";
import { getBrand } from "../service/brands.js";
import { getCredential } from "../service/credentials.js";
import { getPublishedForSite, updatePublishedArticle, type PublishedRow } from "../service/published.js";
import { startRun } from "../service/runs.js";
import { getPublishAdapter } from "../adapters/publish/index.js";
import { getLLMProvider } from "../providers/llm/index.js";
import { ArticleSchema, type Article } from "../domain/article.js";
import { validateArticle } from "../domain/validators.js";

interface HasDate { publishedAt: Date | null; }

/** Rows older than maxAgeDays, oldest first, capped at limit. */
export function selectStale<T extends HasDate>(rows: T[], now: Date, maxAgeDays: number, limit: number): T[] {
  const cutoff = now.getTime() - maxAgeDays * 24 * 60 * 60 * 1000;
  return rows
    .filter((r) => r.publishedAt != null && r.publishedAt.getTime() < cutoff)
    .sort((a, b) => (a.publishedAt!.getTime() - b.publishedAt!.getTime()))
    .slice(0, limit);
}

export async function runRefresh(db: DB, args: JobArgs): Promise<JobResult> {
  const run = await startRun(db, { siteId: args.siteId, jobType: "refresh" });
  try {
    const site = await getSite(db, args.siteId);
    if (!site) throw new Error(`site not found: ${args.siteId}`);
    const brand = await getBrand(db, site.brandId);
    if (!brand) throw new Error(`brand not found: ${site.brandId}`);
    const adapter = getPublishAdapter(site.adapterType);
    if (!adapter.update) {
      await run.finishOk({ skipped: true, reason: "no update()" });
      return { status: "ok", summary: { skipped: true } };
    }
    const maxAgeDays = (args.maxAgeDays as number) ?? 90;
    const limit = (args.limit as number) ?? 3;
    const now = args.now ? new Date(args.now as string) : new Date();
    const llm = getLLMProvider((args.llmProvider as string) ?? "claude");
    const creds = (await getCredential<Record<string, unknown>>(db, args.siteId, site.adapterType)) ?? {};

    const all = (await getPublishedForSite(db, args.siteId)).filter((r): r is PublishedRow & { article: Article } => !!r.article && !!r.url);
    const stale = selectStale(all, now, maxAgeDays, limit);

    let refreshed = 0;
    for (const row of stale) {
      const prompt = `Improve and update this existing article for freshness and accuracy in 2026. Keep the SAME slug "${row.article.slug}". Return the full JSON Article object (same schema) with an improved bodyMarkdown, refreshed data points, and an updated title/excerpt if warranted. Current article JSON:\n${JSON.stringify(row.article)}`;
      const next = await llm.generateJson({ prompt, schema: ArticleSchema });
      const fixed = ArticleSchema.parse({ ...next, slug: row.article.slug }); // enforce slug stability
      const v = validateArticle(fixed);
      if (!v.ok) {
        await run.log("warn", "refresh produced invalid article; skipping", { slug: row.article.slug, errors: v.errors });
        continue;
      }
      const published = await adapter.update(fixed, row.adapterRef, site, creds);
      const contentHash = createHash("sha256").update(fixed.bodyMarkdown).digest("hex");
      await updatePublishedArticle(db, row.id, { article: fixed, url: published.url, contentHash });
      refreshed++;
      await run.log("info", "refreshed post", { slug: row.article.slug });
    }

    await run.finishOk({ refreshed, candidates: stale.length });
    return { status: "ok", summary: { refreshed, candidates: stale.length } };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await run.log("error", "refresh failed", { message });
    await run.finishFailed(message);
    return { status: "failed", error: message };
  }
}
```

- [ ] **Step 4: Register it in `src/jobs/index.ts`**

```ts
import { runRefresh } from "./refresh.js";
```
and in `runners`:
```ts
  refresh: runRefresh,
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/jobs-refresh.test.ts`
Expected: PASS (2 passed).

- [ ] **Step 6: Full suite + typecheck**

Run: `npx vitest run && npm run typecheck`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add src/jobs/refresh.ts src/jobs/index.ts tests/jobs-refresh.test.ts
git commit -m "feat: refresh job (staleness select + LLM regen + update in place)"
```

---

### Task 8: Carousel renderer (Playwright) + Upload-Post delivery

**Files:**
- Create: `src/adapters/social/carousel-render.ts`, `src/adapters/social/upload-post.ts`
- Test: `tests/social-carousel-render.test.ts`, `tests/social-upload-post.test.ts`

#### 8a — Carousel renderer (`src/adapters/social/carousel-render.ts`)

The renderer turns slide data + brand into branded 1080×1350 PNG buffers. The Playwright call is
isolated behind an injectable `RenderFn` so unit tests cover the HTML template + the orchestration
without launching a browser.

- [ ] **Step 1: Write the failing test — `tests/social-carousel-render.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { slideHtml, renderCarousel, type SlideInput, type BrandStyle } from "../src/adapters/social/carousel-render.js";

const brand: BrandStyle = {
  name: "Ladya",
  palette: { bg: "#0a0a0a", card: "#18181b", accent: "#dc2626", text: "#fafafa", muted: "#a1a1aa" },
  handle: "getladya",
};

const slides: SlideInput[] = [
  { type: "hook", text: "Wasting ad spend on Blinkit?" },
  { type: "insight", text: "18-30% of spend goes to dark hours." },
  { type: "cta", text: "Follow @getladya" },
];

describe("slideHtml", () => {
  it("renders a full HTML doc with the slide text and brand colors", () => {
    const html = slideHtml(slides[1]!, 1, slides.length, brand);
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("18-30%");
    expect(html).toContain("#0a0a0a");
    expect(html).toContain("getladya");
  });
});

describe("renderCarousel", () => {
  it("calls the injected render fn once per slide and returns the buffers in order", async () => {
    const seen: string[] = [];
    const fakeRender = async (html: string) => {
      seen.push(html);
      return Buffer.from(`png:${seen.length}`);
    };
    const buffers = await renderCarousel(slides, brand, fakeRender);
    expect(buffers).toHaveLength(3);
    expect(buffers[0]!.toString()).toBe("png:1");
    expect(buffers[2]!.toString()).toBe("png:3");
    expect(seen[0]).toContain("Wasting ad spend");
    expect(seen[2]).toContain("Follow @getladya");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/social-carousel-render.test.ts`
Expected: FAIL ("Cannot find module ... carousel-render.js").

- [ ] **Step 3: Implement `src/adapters/social/carousel-render.ts`**

```ts
export interface SlideInput {
  type: "hook" | "insight" | "stat" | "cta";
  text: string;
}

export interface BrandStyle {
  name: string;
  palette: { bg: string; card: string; accent: string; text: string; muted: string };
  handle: string;
}

/** A function that turns one slide's HTML into a PNG buffer. Real impl uses Playwright; tests inject a fake. */
export type RenderFn = (html: string) => Promise<Buffer>;

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Full standalone HTML document for one 1080x1350 slide. */
export function slideHtml(slide: SlideInput, index: number, total: number, brand: BrandStyle): string {
  const p = brand.palette;
  const isCover = slide.type === "hook";
  const isCta = slide.type === "cta";
  const accentBar = `<div style="width:80px;height:8px;background:${p.accent};border-radius:4px;margin-bottom:40px;"></div>`;
  const counter = `<div style="position:absolute;top:48px;right:56px;color:${p.muted};font-size:28px;">${index + 1}/${total}</div>`;
  const footer = `<div style="position:absolute;bottom:48px;left:56px;color:${p.muted};font-size:30px;">@${escapeHtml(brand.handle)}</div>`;
  const fontSize = isCover ? 84 : 60;
  const weight = isCover || isCta ? 800 : 600;
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8" />
<style>
  * { margin:0; padding:0; box-sizing:border-box; font-family: Inter, Arial, sans-serif; }
  body { width:1080px; height:1350px; background:${p.bg}; color:${p.text}; }
  .slide { position:relative; width:1080px; height:1350px; padding:120px 56px; display:flex; flex-direction:column; justify-content:center; }
  .card { background:${p.card}; border-radius:32px; padding:64px; }
  .text { font-size:${fontSize}px; font-weight:${weight}; line-height:1.2; }
  .cta { color:${p.accent}; }
</style></head>
<body><div class="slide">
  ${counter}
  ${accentBar}
  <div class="card"><div class="text ${isCta ? "cta" : ""}">${escapeHtml(slide.text)}</div></div>
  ${footer}
</div></body></html>`;
}

/** Render each slide to a PNG buffer via the provided render function (defaults to Playwright). */
export async function renderCarousel(
  slides: SlideInput[],
  brand: BrandStyle,
  render: RenderFn = playwrightRender,
): Promise<Buffer[]> {
  const buffers: Buffer[] = [];
  for (let i = 0; i < slides.length; i++) {
    buffers.push(await render(slideHtml(slides[i]!, i, slides.length, brand)));
  }
  return buffers;
}

/** Real renderer: launches Chromium, sets the HTML, screenshots a 1080x1350 viewport. */
export const playwrightRender: RenderFn = async (html: string): Promise<Buffer> => {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 2 });
    await page.setContent(html, { waitUntil: "networkidle" });
    const png = await page.screenshot({ type: "png" });
    return Buffer.from(png);
  } finally {
    await browser.close();
  }
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/social-carousel-render.test.ts`
Expected: PASS (2 passed). (No browser launched — tests use `slideHtml` and an injected fake `RenderFn`.)

- [ ] **Step 5: Commit**

```bash
git add src/adapters/social/carousel-render.ts tests/social-carousel-render.test.ts
git commit -m "feat: carousel renderer (slide HTML template + injectable Playwright render)"
```

#### 8b — Upload-Post delivery (`src/adapters/social/upload-post.ts`)

Posts rendered PNG buffers to Instagram via the Upload-Post API.

- [ ] **Step 1: Write the failing test — `tests/social-upload-post.test.ts`** (mocks `fetch`)

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { deliverCarousel } from "../src/adapters/social/upload-post.js";

beforeEach(() => vi.unstubAllGlobals());

const images = [Buffer.from("png-a"), Buffer.from("png-b")];
const caption = "How to cut Blinkit ad waste";
const hashtags = ["#blinkit", "#qcommerce"];

describe("deliverCarousel", () => {
  it("skips when no creds", async () => {
    const out = await deliverCarousel(null, images, caption, hashtags);
    expect(out).toEqual({ delivered: false, skipped: true });
  });

  it("returns delivered:false (not thrown) when there are no images", async () => {
    const out = await deliverCarousel({ apiKey: "K", user: "ladya" }, [], caption, hashtags);
    expect(out).toEqual({ delivered: false, skipped: false, reason: "no images to post" });
  });

  it("posts PNG buffers to Upload-Post with the apikey header and combined description", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: true, request_id: "rq" }) });
    vi.stubGlobal("fetch", fetchMock);
    const out = await deliverCarousel({ apiKey: "K", user: "ladya" }, images, caption, hashtags);
    expect(out).toMatchObject({ delivered: true, skipped: false, requestId: "rq" });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.upload-post.com/api/upload_photos");
    expect((init as RequestInit).headers).toMatchObject({ Authorization: "Apikey K" });
    expect((init as RequestInit).body).toBeInstanceOf(FormData);
    const form = (init as RequestInit).body as FormData;
    expect(form.getAll("photos[]")).toHaveLength(2);
    expect(form.get("user")).toBe("ladya");
    expect((form.get("description") as string)).toContain("#blinkit");
  });

  it("throws on a non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => "boom" }));
    await expect(deliverCarousel({ apiKey: "K", user: "ladya" }, images, caption, hashtags)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/social-upload-post.test.ts`
Expected: FAIL ("Cannot find module ... upload-post.js").

- [ ] **Step 3: Implement `src/adapters/social/upload-post.ts`**

```ts
export interface UploadPostCreds {
  apiKey: string;
  user: string; // upload-post profile (e.g. "ladya")
}

export interface DeliveryResult {
  delivered: boolean;
  skipped: boolean;
  reason?: string;
  requestId?: string;
}

const UPLOAD_POST_URL = "https://api.upload-post.com/api/upload_photos";

/**
 * Post rendered carousel PNGs to Instagram via Upload-Post.
 * No-ops (skipped:true) when creds are absent; delivered:false when there are no images.
 */
export async function deliverCarousel(
  creds: UploadPostCreds | null | undefined,
  images: Buffer[],
  caption: string,
  hashtags: string[],
): Promise<DeliveryResult> {
  if (!creds || !creds.apiKey || !creds.user) return { delivered: false, skipped: true };
  if (images.length === 0) return { delivered: false, skipped: false, reason: "no images to post" };

  const description = `${caption}\n\n${hashtags.join(" ")}`.trim();
  const form = new FormData();
  images.forEach((buf, i) => {
    form.append("photos[]", new Blob([buf], { type: "image/png" }), `slide-${i + 1}.png`);
  });
  form.append("platform[]", "instagram");
  form.append("user", creds.user);
  form.append("description", description);

  const res = await fetch(UPLOAD_POST_URL, {
    method: "POST",
    headers: { Authorization: `Apikey ${creds.apiKey}` },
    body: form,
  });
  if (!res.ok) throw new Error(`upload-post failed: ${res.status} ${await res.text().catch(() => "")}`);
  const body = (await res.json().catch(() => ({}))) as { request_id?: string };
  return { delivered: true, skipped: false, requestId: body.request_id };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/social-upload-post.test.ts`
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
git add src/adapters/social/upload-post.ts tests/social-upload-post.test.ts
git commit -m "feat: Upload-Post carousel delivery (PNG buffers -> Instagram)"
```

---

### Task 9: `distribute-social` job

**Files:**
- Create: `src/jobs/distribute-social.ts`
- Modify: `src/jobs/index.ts` (register `distribute-social`)
- Test: `tests/jobs-distribute-social.test.ts`

The job: pick unposted published content → LLM generates slide copy → `renderCarousel` produces PNG
buffers → `deliverCarousel` posts to Upload-Post → mark `social_posted`. The job test injects a fake
`RenderFn` (via the job's `render` option) so no browser launches in tests.

- [ ] **Step 1: Write the failing test — `tests/jobs-distribute-social.test.ts`**

```ts
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

    // Inject a fake renderer so no browser launches; count slides rendered.
    const fakeRender = async (_html: string) => { renderedSlides++; return Buffer.from("png"); };

    const result = await runDistributeSocial(db, { siteId, llmProvider: "fakeSlides", render: fakeRender });
    expect(result.status).toBe("ok");
    expect(result.summary?.posted).toBe(1);
    expect(uploadCalled).toBe(true);
    expect(renderedSlides).toBe(2); // two slides from fakeSlides provider

    const rows = await getPublishedForSite(db, siteId);
    expect(rows.find((r) => r.slug === "p1")!.socialPosted).toBe(1);
  });

  it("is a no-op ok when there is no unposted content", async () => {
    const db = makeDb(URL);
    const fakeRender = async (_html: string) => Buffer.from("png");
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) } as Response)) as never);
    // everything already posted from the previous test
    const result = await runDistributeSocial(db, { siteId, llmProvider: "fakeSlides", render: fakeRender });
    expect(result.status).toBe("ok");
    expect(result.summary?.posted).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/jobs-distribute-social.test.ts`
Expected: FAIL ("Cannot find module ... distribute-social.js").

- [ ] **Step 3: Implement `src/jobs/distribute-social.ts`**

```ts
import { z } from "zod";
import type { DB } from "../db/client.js";
import type { JobArgs, JobResult } from "./types.js";
import { getSite } from "../service/sites.js";
import { getBrand } from "../service/brands.js";
import { getCredential } from "../service/credentials.js";
import { getPublishedForSite, markSocialPosted, type PublishedRow } from "../service/published.js";
import { startRun } from "../service/runs.js";
import { getLLMProvider } from "../providers/llm/index.js";
import { deliverCarousel, type UploadPostCreds } from "../adapters/social/upload-post.js";
import { renderCarousel, playwrightRender, type BrandStyle, type RenderFn } from "../adapters/social/carousel-render.js";
import type { Article } from "../domain/article.js";

const SlidesSchema = z.object({
  caption: z.string().min(1),
  hashtags: z.array(z.string()).default([]),
  slides: z.array(z.object({ type: z.enum(["hook", "insight", "stat", "cta"]), text: z.string().min(1) })).min(2),
});

const DEFAULT_PALETTE = { bg: "#0a0a0a", card: "#18181b", accent: "#dc2626", text: "#fafafa", muted: "#a1a1aa" };

function brandStyle(brand: { name: string; palette?: unknown; social?: unknown }): BrandStyle {
  const p = (brand.palette as Partial<BrandStyle["palette"]> | null) ?? {};
  const handle = ((brand.social as Record<string, unknown> | null)?.instagram as string | undefined) ?? brand.name;
  return {
    name: brand.name,
    palette: {
      bg: p.bg ?? DEFAULT_PALETTE.bg,
      card: p.card ?? DEFAULT_PALETTE.card,
      accent: p.accent ?? DEFAULT_PALETTE.accent,
      text: p.text ?? DEFAULT_PALETTE.text,
      muted: p.muted ?? DEFAULT_PALETTE.muted,
    },
    handle,
  };
}

export async function runDistributeSocial(db: DB, args: JobArgs): Promise<JobResult> {
  const run = await startRun(db, { siteId: args.siteId, jobType: "distribute-social" });
  try {
    const site = await getSite(db, args.siteId);
    if (!site) throw new Error(`site not found: ${args.siteId}`);
    const brand = await getBrand(db, site.brandId);
    if (!brand) throw new Error(`brand not found: ${site.brandId}`);

    const creds = await getCredential<UploadPostCreds>(db, args.siteId, "upload-post");
    const llm = getLLMProvider((args.llmProvider as string) ?? "claude");
    const render: RenderFn = (args.render as RenderFn | undefined) ?? playwrightRender;
    const style = brandStyle(brand);

    const rows = (await getPublishedForSite(db, args.siteId)).filter(
      (r): r is PublishedRow & { article: Article } => !!r.article && r.socialPosted === 0,
    );
    const limit = (args.limit as number) ?? 1;
    const batch = rows.slice(0, limit);

    let posted = 0;
    for (const row of batch) {
      const prompt = `Write an Instagram carousel for this article. Return JSON {caption, hashtags[], slides[]} where slides is 4-6 items each {type: "hook"|"insight"|"stat"|"cta", text} (<=25 words each), opening with a hook and ending with a CTA to follow @${style.handle}. Article: ${JSON.stringify({ title: row.article.title, tldr: row.article.tldr, takeaways: row.article.takeaways })}`;
      const slides = await llm.generateJson({ prompt, schema: SlidesSchema });
      const hashtags = slides.hashtags.length ? slides.hashtags : ((brand.hashtags as string[] | null) ?? []);
      const images = await renderCarousel(slides.slides, style, render);
      const result = await deliverCarousel(creds, images, slides.caption, hashtags);
      if (result.delivered) {
        await markSocialPosted(db, row.id);
        posted++;
        await run.log("info", "social delivered", { slug: row.slug, requestId: result.requestId });
      } else {
        await run.log("info", "social not delivered", { slug: row.slug, reason: result.reason ?? (result.skipped ? "no creds" : "unknown") });
      }
    }

    await run.finishOk({ posted, candidates: batch.length });
    return { status: "ok", summary: { posted, candidates: batch.length } };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await run.log("error", "distribute-social failed", { message });
    await run.finishFailed(message);
    return { status: "failed", error: message };
  }
}
```

- [ ] **Step 4: Register it in `src/jobs/index.ts`**

```ts
import { runDistributeSocial } from "./distribute-social.js";
```
and in `runners`:
```ts
  "distribute-social": runDistributeSocial,
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/jobs-distribute-social.test.ts`
Expected: PASS (2 passed).

- [ ] **Step 6: Full suite + typecheck**

Run: `npx vitest run && npm run typecheck`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add src/jobs/distribute-social.ts src/jobs/index.ts tests/jobs-distribute-social.test.ts
git commit -m "feat: distribute-social job (LLM slide data + carousel delivery)"
```

---

### Task 10: Wire the dispatcher into the scheduler + CLI

**Files:**
- Modify: `src/scheduler/worker.ts`, `src/cli/index.ts`
- Test: `tests/jobs-dispatch.test.ts`

- [ ] **Step 1: Write the failing test — `tests/jobs-dispatch.test.ts`**

```ts
import { describe, it, expect, beforeAll, vi } from "vitest";
import { randomUUID, randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMigrations } from "../src/db/migrate.js";
import { makeDb } from "../src/db/client.js";
import { brands, sites, schedules } from "../src/db/schema.js";
import { eq } from "drizzle-orm";
import { tick } from "../src/scheduler/worker.js";
import { registerJob, knownJobTypes } from "../src/jobs/index.js";

const URL = `file:${join(tmpdir(), `qcontent-dispatch-test-${randomUUID()}.db`)}`;
let siteId: string;
beforeAll(async () => {
  process.env.QCONTENT_MASTER_KEY = randomBytes(32).toString("base64");
  await runMigrations(URL);
  const db = makeDb(URL);
  const bid = randomUUID();
  siteId = randomUUID();
  await db.insert(brands).values({ id: bid, name: "B", slug: "b-disp" });
  await db.insert(sites).values({ id: siteId, brandId: bid, name: "S", slug: "s-disp", adapterType: "webhook" });
});

describe("dispatcher + scheduler", () => {
  it("knows all Phase 4 job types", () => {
    const types = knownJobTypes();
    for (const t of ["generate", "reindex", "maintain-links", "refresh", "distribute-social"]) {
      expect(types).toContain(t);
    }
  });

  it("tick dispatches a due schedule of an arbitrary job type via runJob", async () => {
    const db = makeDb(URL);
    let called: { jobType: string; siteId: string } | null = null;
    registerJob("test-job", async (_db, a) => { called = { jobType: "test-job", siteId: a.siteId }; return { status: "ok" }; });
    await db.insert(schedules).values({ id: randomUUID(), siteId, jobType: "test-job", cron: "0 9 * * *", enabled: 1, nextRunAt: new Date(Date.now() - 60000) });

    await tick(db, new Date());
    expect(called).not.toBeNull();
    expect(called!.jobType).toBe("test-job");

    const rows = await db.select().from(schedules).where(eq(schedules.jobType, "test-job"));
    expect(rows[0]!.nextRunAt).not.toBeNull(); // nextRunAt advanced
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/jobs-dispatch.test.ts`
Expected: FAIL (tick still hard-codes `generate`; `test-job` never called).

- [ ] **Step 3: Update `src/scheduler/worker.ts`**

Replace the `generate`-only dispatch in `tick` with the generic dispatcher. Change the import block and the loop body:

```ts
import { Cron } from "croner";
import { and, eq, lte, or, isNull } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { db as defaultDb } from "../db/client.js";
import { schedules } from "../db/schema.js";
import { runJob } from "../jobs/index.js";

export type Schedule = typeof schedules.$inferSelect;

export async function dueSchedules(db: DB, now: Date): Promise<Schedule[]> {
  return db
    .select()
    .from(schedules)
    .where(and(eq(schedules.enabled, 1), or(isNull(schedules.nextRunAt), lte(schedules.nextRunAt, now))));
}

function computeNextRun(cron: string, from: Date): Date | null {
  const next = new Cron(cron).nextRun(from);
  return next ?? null;
}

export async function tick(db: DB, now = new Date()): Promise<void> {
  const due = await dueSchedules(db, now);
  for (const s of due) {
    try {
      await runJob(db, s.jobType, { siteId: s.siteId });
    } catch {
      // a dispatch error must not stop the loop; the job recorder logs its own failures
    }
    await db
      .update(schedules)
      .set({ lastRunAt: now, nextRunAt: computeNextRun(s.cron, now) })
      .where(eq(schedules.id, s.id));
  }
}

export async function startWorker(intervalMs = 60_000): Promise<void> {
  console.log(`qcontent worker started; polling every ${intervalMs}ms`);
  const loop = async () => {
    try {
      await tick(defaultDb);
    } catch (err) {
      console.error("worker tick error:", err);
    }
  };
  await loop();
  setInterval(loop, intervalMs);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startWorker();
}
```

- [ ] **Step 4: Update `src/cli/index.ts` `run` command to route through `runJob`**

Add the import near the top (with the other imports):

```ts
import { runJob, knownJobTypes } from "../jobs/index.js";
```

Replace the existing `run` command's `.action` body with a dispatcher-backed version that supports any registered job type and forwards extra options:

```ts
program
  .command("run")
  .description("run a job now")
  .requiredOption("--site <slug>")
  .option("--job <type>", "job type", "generate")
  .option("--llm <provider>", "llm provider", "claude")
  .option("--type <contentType>", "content type", "guides")
  .option("--max-age-days <n>", "refresh: only posts older than N days")
  .option("--limit <n>", "max items to process")
  .action(async (o) => {
    const site = await getSiteBySlug(db, o.site);
    if (!site) throw new Error(`site not found: ${o.site}`);
    if (!knownJobTypes().includes(o.job)) throw new Error(`unknown job type '${o.job}'. Known: ${knownJobTypes().join(", ")}`);
    const result = await runJob(db, o.job, {
      siteId: site.id,
      llmProvider: o.llm,
      contentType: o.type,
      ...(o.maxAgeDays ? { maxAgeDays: Number(o.maxAgeDays) } : {}),
      ...(o.limit ? { limit: Number(o.limit) } : {}),
    });
    console.log(JSON.stringify(result, null, 2));
    if (result.status === "failed") process.exit(1);
  });
```

Also ensure all job modules are registered for the CLI by adding their side-effect (the `jobs/index.js` import already imports every runner, so importing `runJob` from it transitively registers them; no extra imports needed).

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/jobs-dispatch.test.ts`
Expected: PASS (2 passed).

- [ ] **Step 6: Typecheck + smoke + full suite**

Run: `npm run typecheck`
Expected: clean.

Run: `npx tsx src/cli/index.ts run --help`
Expected: shows `--job`, `--max-age-days`, `--limit` options.

Run: `npx vitest run`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add src/scheduler/worker.ts src/cli/index.ts tests/jobs-dispatch.test.ts
git commit -m "feat: dispatch any job type via runJob in scheduler + CLI"
```

---

### Task 11: Docs — README Phase 4

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update `README.md`**

Add a section after the Phase 3 section and update the Roadmap. Insert:

```markdown
## Phase 4 (done): Maintenance jobs + Social distribution

Beyond `generate`, the engine runs four more job types (each recorded as a run):

- **`reindex`** — resubmit every published URL for a site to Google Indexing + ping the sitemap
  (derived from `published_content`, not a hard-coded list).
- **`maintain-links`** — scan the site's published corpus and add internal links between posts,
  re-publishing changed posts via the adapter's `update()`.
- **`refresh`** — pick posts older than `--max-age-days`, regenerate/improve them with the LLM,
  and update them in place (slug preserved).
- **`distribute-social`** — generate Instagram carousel slide copy (LLM) from a published post,
  render branded 1080×1350 PNGs with Playwright/Chromium, and post them to Instagram via Upload-Post,
  then mark the post as socially distributed.

Run any job:
```bash
npm run cli -- run --site <slug> --job reindex
npm run cli -- run --site <slug> --job maintain-links --limit 50
npm run cli -- run --site <slug> --job refresh --max-age-days 90 --limit 3
npm run cli -- run --site <slug> --job distribute-social --limit 1
```

`distribute-social` needs an `upload-post` credential and the Chromium browser binary:
```bash
npx playwright install chromium
npm run cli -- creds:set --site <siteId> --integration upload-post --json '{"apiKey":"...","user":"ladya"}'
```

Schedule them by inserting rows into the `schedules` table (`job_type` = any of the above); the
worker dispatches due schedules of every job type.
```

Then change the Roadmap to:
```markdown
## Roadmap
Phase 5: HTTP API + dashboard.
```

(Render real backtick fences in the file.)

- [ ] **Step 2: Full suite + typecheck (docs sanity)**

Run: `npx vitest run && npm run typecheck`
Expected: all green.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document Phase 4 maintenance jobs + social distribution"
```

---

## Self-Review (against the spec)

**Spec coverage (Phase 4, §10 + §6):**
- `reindex` (sitemap + Google Indexing, derived from data) → Task 4. ✓
- `maintain-links` (internal-link backfill) → Tasks 5 (pure fn) + 6 (job). ✓
- `refresh` (revisit stale posts, update in place) → Task 7. ✓
- `distribute-social` (LLM slide copy → Playwright PNG render → Instagram via Upload-Post) → Tasks 8 (renderer + delivery) + 9 (job). ✓
- Adapter `update()` for all four adapters → Tasks 2 + 3. ✓
- Full-article snapshot enabling adapter-agnostic read-back → Task 1. ✓
- Job dispatcher + scheduler dispatches every job type + CLI runs any job → Tasks 4 + 10. ✓
- Docs → Task 11. ✓

**Placeholder scan:** No TBD/TODO/"add error handling"-style steps; every code step shows full code.

**Type consistency:** `JobResult`/`JobArgs`/`JobRunner` (Task 4) are used by every job and the dispatcher. `runReindex`/`runMaintainLinks`/`runRefresh`/`runDistributeSocial` all share the `(db, args)→Promise<JobResult>` shape and the start/finish run pattern. `getPublishedForSite`→`PublishedRow[]` and `updatePublishedArticle`/`markSocialPosted` (Task 1) are used consistently by the maintenance/social jobs. `adapter.update?(article, ref, site, creds)` (Task 2) is called by maintain-links and refresh with the stored `adapterRef` as `ref`. `deliverCarousel(creds, payload, config)` and `CarouselPayload`/`UploadPostCreds` (Task 8) match the social job's call. `runJob(db, jobType, args)` (Task 4) matches the scheduler + CLI call sites (Task 10).

**Decisions captured (from brainstorming):** All four jobs in scope; optional `update()` added to the adapter interface (jobs skip adapters lacking it); content read-back via a full-Article snapshot column on `published_content` ("snapshot now, fetch later" — one guarded migration, per-adapter fetch deferred); social = **full Playwright build** — LLM slide copy → Playwright/Chromium PNG render → Upload-Post. The Playwright screenshot is isolated behind an injectable `RenderFn` so jobs/templates are unit-tested without a browser; Chromium binary install is an operational step (README), with the caveat that this sandbox may not run it (Task 1 + header).

**Type consistency (social, revised):** `renderCarousel(slides, brand, render?)→Buffer[]`, `slideHtml(...)→string`, `RenderFn = (html)→Promise<Buffer>`, `playwrightRender: RenderFn` (Task 8a) are used by `runDistributeSocial` (Task 9), which passes an injectable `render` arg (defaulting to `playwrightRender`). `deliverCarousel(creds, images: Buffer[], caption, hashtags)→DeliveryResult` (Task 8b) matches the job's call. `distribute-social` no longer uses a `renderWebhook`; the CLI `--render-webhook` option is therefore dropped from Task 10's `run` command (use `--limit` for social).

**Note on `update()` optionality:** maintain-links and refresh check `adapter.update` and no-op (`skipped:true`) when an adapter doesn't implement it — but all four built-in adapters do, so in practice every target type is covered. The optionality keeps future adapters from being forced to implement update before they can publish.
