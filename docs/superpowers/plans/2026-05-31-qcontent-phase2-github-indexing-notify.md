# qcontent Phase 2 (GitHub-MDX adapter + Indexing + Notify) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the engine publish real content to GitHub-hosted MDX sites (commit `.mdx` + frontmatter + a `content/manifest.json` via the GitHub Contents API, visuals inlined as `<svg>`), submit published URLs to Google Indexing, and send Telegram notifications on success/failure — all wired into the existing `generate` orchestrator behind the established adapter seams.

**Architecture:** Three new edge integrations behind the Phase 1 interfaces. A **GitHub-MDX publish adapter** (registered as `github-mdx`) converts the canonical `Article` to frontmatter-MDX and writes files through a thin **GitHub Contents API client**; it supports direct-commit (default) or PR mode per site. Two new **post-publish side-effects** — a **Google Indexing** submitter and a **Telegram** notifier — are invoked by the orchestrator after a successful publish (and Telegram on failure). All three read secrets from the encrypted `credentials` table and config from `sites`/global.

**Tech Stack:** Existing (TS ESM, Drizzle/Turso, zod, vitest). New deps: `jose` (Google service-account JWT), `yaml` (frontmatter serialization).

**Spec:** `docs/superpowers/specs/2026-05-31-qcontent-multisite-engine-design.md` — Phase 2 in §10; adapter model §4; integrations §7.3/§7.5.

**Builds on Phase 1 (already merged to master).** Key existing exports this plan uses:
- `Article`, `Visual` (`src/domain/article.js`)
- `Site` (`src/service/sites.js`), `getCredential` (`src/service/credentials.js`)
- `PublishAdapter`, `PublishResult`, `registerPublishAdapter`, `getPublishAdapter` (`src/adapters/publish/index.js`)
- `runGenerate` orchestrator (`src/generation/orchestrator.js`) — to be extended
- `RunHandle` from `startRun` (`src/service/runs.js`)

**Conventions (carry over from Phase 1):**
- ESM/NodeNext: project imports use the `.js` extension; tests import from `../src/...js`.
- Tests that need a DB use a temp-file libSQL URL: `file:${join(tmpdir(), \`qcontent-<name>-test-${randomUUID()}.db\`)}` (the `file::memory:?cache=shared` form does NOT share across `@libsql/client` connections).
- Installed majors: zod v3, drizzle-orm ^0.38, @libsql/client, @anthropic-ai/sdk ^0.40, commander ^13, croner ^9.
- `noUncheckedIndexedAccess` is on — guard indexed access with `!`/`??`.
- Built-in adapters self-register via a side-effect import at the bottom of their module; the orchestrator must import them (see Task 8).

---

## File Structure (Phase 2)

```
src/
  github/
    client.ts            # thin GitHub REST client (Contents API + branch/PR), token auth
  adapters/
    publish/
      mdx-format.ts       # Article -> frontmatter MDX string (+ inline SVG); manifest entry builder
      github-mdx.ts       # PublishAdapter 'github-mdx' (uses client + mdx-format)
    index/
      google-indexing.ts  # submitUrlToGoogle + pingSitemaps (jose JWT); runIndexing(site, url, creds)
    notify/
      telegram.ts         # sendTelegram(creds, message); notifyPublished / notifyFailure helpers
  generation/
    orchestrator.ts       # MODIFY: after publish -> indexing + telegram; on failure -> telegram
tests/
  mdx-format.test.ts
  github-client.test.ts
  github-mdx.test.ts
  google-indexing.test.ts
  telegram.test.ts
  orchestrator-notify.test.ts
```

Repo root: `/Users/vishalkumar/Downloads/qcontent`. Work on a feature branch `phase2-github-indexing-notify` (the controller creates it before Task 1).

---

### Task 1: Add dependencies (`jose`, `yaml`)

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install the two runtime deps**

Run: `npm install jose@^5 yaml@^2`
Expected: installs succeed; `package.json` `dependencies` now include `jose` and `yaml`. (If `npm install` needs it, the project already uses `--ignore-scripts` in this environment; if a plain install fails on a postinstall binary, re-run with `npm install --ignore-scripts jose@^5 yaml@^2`.)

- [ ] **Step 2: Verify the full suite still passes**

Run: `npx vitest run`
Expected: 15 files / 29 tests pass (unchanged).

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add jose + yaml deps for Phase 2"
```

---

### Task 2: MDX formatter (canonical Article → frontmatter MDX + manifest entry)

**Files:**
- Create: `src/adapters/publish/mdx-format.ts`
- Test: `tests/mdx-format.test.ts`

- [ ] **Step 1: Write the failing test — `tests/mdx-format.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { articleToMdx, manifestEntry } from "../src/adapters/publish/mdx-format.js";
import type { Article } from "../src/domain/article.js";

const article: Article = {
  title: "How to Cut Blinkit Ad Waste in 2026: A Practical Guide",
  slug: "cut-blinkit-ad-waste-2026",
  excerpt: "A specific, concrete meta description about reducing Blinkit ad waste with steps, benchmarks, and data points worth citing here.",
  category: "Guides",
  tags: ["blinkit", "ad-waste"],
  date: "2026-05-31",
  bodyMarkdown: "Reducing waste starts with dayparting.\n\n## What is ad waste?\n\nSee {{visual:waste-bars}} for the breakdown.",
  tldr: "Pause dark hours and tighten match types; brands save 18-30%.",
  faqs: [
    { question: "What is ad waste?", answer: "Spend with no measurable return." },
    { question: "How much can I save?", answer: "Typically 18-30%." },
    { question: "Where do I start?", answer: "Dayparting." },
  ],
  takeaways: ["Pause dark hours", "Tighten match types", "Cap CPCs", "Review weekly"],
  relatedSlugs: ["acos", "dayparting"],
  visuals: [{ token: "waste-bars", kind: "svg", code: "<svg viewBox=\"0 0 400 200\"><rect/></svg>", alt: "waste chart" }],
  seoHints: { jsonldType: "Article", mentions: ["Blinkit"], speakableSelectors: ["h1", ".tldr-box"] },
};

describe("articleToMdx", () => {
  it("emits YAML frontmatter then the body with visuals inlined", () => {
    const mdx = articleToMdx(article);
    // frontmatter delimiters
    expect(mdx.startsWith("---\n")).toBe(true);
    expect(mdx).toContain("\n---\n");
    // key frontmatter fields present
    expect(mdx).toContain('title: ');
    expect(mdx).toContain("slug: cut-blinkit-ad-waste-2026");
    expect(mdx).toContain("tldr:");
    // visual token replaced by the raw svg, token removed
    expect(mdx).toContain("<svg viewBox=");
    expect(mdx).not.toContain("{{visual:waste-bars}}");
    // body heading survives
    expect(mdx).toContain("## What is ad waste?");
  });

  it("inlines an image visual as a markdown image when kind is image", () => {
    const withImg: Article = {
      ...article,
      bodyMarkdown: "Intro.\n\n{{visual:pic}}",
      visuals: [{ token: "pic", kind: "image", url: "https://cdn.test/p.png", alt: "a pic" }],
    };
    const mdx = articleToMdx(withImg);
    expect(mdx).toContain("![a pic](https://cdn.test/p.png)");
    expect(mdx).not.toContain("{{visual:pic}}");
  });
});

describe("manifestEntry", () => {
  it("builds a manifest record keyed by slug with routing fields", () => {
    const entry = manifestEntry(article, "guides");
    expect(entry).toMatchObject({
      slug: "cut-blinkit-ad-waste-2026",
      type: "guides",
      title: article.title,
      date: "2026-05-31",
      path: "content/guides/cut-blinkit-ad-waste-2026.mdx",
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/mdx-format.test.ts`
Expected: FAIL ("Cannot find module ... mdx-format.js").

- [ ] **Step 3: Implement `src/adapters/publish/mdx-format.ts`**

```ts
import { stringify as yamlStringify } from "yaml";
import type { Article, Visual } from "../../domain/article.js";

const TOKEN_RE = /\{\{visual:([a-z0-9-]+)\}\}/g;

/** Inline a visual where its token appears in the body. */
function renderVisual(v: Visual): string {
  if (v.kind === "image" && v.url) return `![${v.alt}](${v.url})`;
  if (v.kind === "svg" && v.code) return v.code;
  return ""; // unknown/empty visual collapses to nothing
}

/** Replace every {{visual:token}} in the body with its inlined visual. */
export function inlineVisuals(article: Article): string {
  const byToken = new Map(article.visuals.map((v) => [v.token, v]));
  return article.bodyMarkdown.replace(TOKEN_RE, (_m, token: string) => {
    const v = byToken.get(token);
    return v ? renderVisual(v) : "";
  });
}

/** Frontmatter fields written to the MDX (provider-agnostic, portable). */
function frontmatter(article: Article): Record<string, unknown> {
  return {
    title: article.title,
    slug: article.slug,
    excerpt: article.excerpt,
    category: article.category,
    tags: article.tags,
    date: article.date,
    ...(article.publishDate ? { publishDate: article.publishDate } : {}),
    tldr: article.tldr,
    faqs: article.faqs,
    takeaways: article.takeaways,
    relatedSlugs: article.relatedSlugs,
    jsonldType: article.seoHints.jsonldType,
    mentions: article.seoHints.mentions,
  };
}

/** Canonical Article -> a full MDX document string (YAML frontmatter + body). */
export function articleToMdx(article: Article): string {
  const fm = yamlStringify(frontmatter(article)).trimEnd();
  const body = inlineVisuals(article).trim();
  return `---\n${fm}\n---\n\n${body}\n`;
}

export interface ManifestEntry {
  slug: string;
  type: string;
  title: string;
  excerpt: string;
  date: string;
  path: string;
}

export function mdxPath(slug: string, type: string, basePath = "content"): string {
  return `${basePath}/${type}/${slug}.mdx`;
}

export function manifestEntry(article: Article, type: string, basePath = "content"): ManifestEntry {
  return {
    slug: article.slug,
    type,
    title: article.title,
    excerpt: article.excerpt,
    date: article.date,
    path: mdxPath(article.slug, type, basePath),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/mdx-format.test.ts`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
git add src/adapters/publish/mdx-format.ts tests/mdx-format.test.ts
git commit -m "feat: Article -> frontmatter MDX formatter + manifest entry"
```

---

### Task 3: GitHub Contents API client

**Files:**
- Create: `src/github/client.ts`
- Test: `tests/github-client.test.ts`

- [ ] **Step 1: Write the failing test — `tests/github-client.test.ts`** (mocks `fetch`)

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { GitHubClient } from "../src/github/client.js";

beforeEach(() => vi.unstubAllGlobals());

describe("GitHubClient.getFile", () => {
  it("returns content + sha when the file exists", async () => {
    const body = { sha: "abc123", content: Buffer.from("hello", "utf8").toString("base64"), encoding: "base64" };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body }));
    const gh = new GitHubClient("tok");
    const out = await gh.getFile("o", "r", "content/manifest.json", "main");
    expect(out).toEqual({ sha: "abc123", content: "hello" });
  });

  it("returns null on 404", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404, text: async () => "Not Found" }));
    const gh = new GitHubClient("tok");
    expect(await gh.getFile("o", "r", "missing.json", "main")).toBeNull();
  });
});

describe("GitHubClient.putFile", () => {
  it("PUTs base64 content with the auth header and returns the commit sha", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 201, json: async () => ({ commit: { sha: "deadbeef" }, content: { sha: "blobsha" } }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const gh = new GitHubClient("tok");
    const res = await gh.putFile({
      owner: "o", repo: "r", path: "content/guides/x.mdx", message: "add x",
      content: "# hi", branch: "main",
    });
    expect(res).toEqual({ commitSha: "deadbeef", contentSha: "blobsha" });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.github.com/repos/o/r/contents/content/guides/x.mdx");
    expect((init as RequestInit).method).toBe("PUT");
    expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer tok" });
    const sent = JSON.parse((init as RequestInit).body as string);
    expect(Buffer.from(sent.content, "base64").toString("utf8")).toBe("# hi");
    expect(sent.branch).toBe("main");
  });

  it("includes the existing sha when updating", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ commit: { sha: "c2" }, content: { sha: "b2" } }) });
    vi.stubGlobal("fetch", fetchMock);
    const gh = new GitHubClient("tok");
    await gh.putFile({ owner: "o", repo: "r", path: "p", message: "m", content: "c", branch: "main", sha: "old" });
    const sent = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(sent.sha).toBe("old");
  });

  it("throws on a non-ok PUT", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 422, text: async () => "bad" }));
    const gh = new GitHubClient("tok");
    await expect(
      gh.putFile({ owner: "o", repo: "r", path: "p", message: "m", content: "c", branch: "main" }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/github-client.test.ts`
Expected: FAIL ("Cannot find module ... client.js").

- [ ] **Step 3: Implement `src/github/client.ts`**

```ts
const API = "https://api.github.com";

export interface PutFileArgs {
  owner: string;
  repo: string;
  path: string;
  message: string;
  content: string; // raw UTF-8; encoded to base64 internally
  branch: string;
  sha?: string; // required by GitHub when updating an existing file
}

export interface PutFileResult {
  commitSha: string;
  contentSha: string;
}

export interface GetFileResult {
  sha: string;
  content: string; // decoded UTF-8
}

export class GitHubClient {
  constructor(private token: string) {}

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      "User-Agent": "qcontent",
    };
  }

  /** Returns the file's decoded content + blob sha, or null if it doesn't exist (404). */
  async getFile(owner: string, repo: string, path: string, ref: string): Promise<GetFileResult | null> {
    const url = `${API}/repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(ref)}`;
    const res = await fetch(url, { headers: this.headers() });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`github getFile ${res.status}: ${await res.text().catch(() => "")}`);
    const body = (await res.json()) as { sha: string; content: string; encoding: string };
    const content = Buffer.from(body.content, "base64").toString("utf8");
    return { sha: body.sha, content };
  }

  /** Creates or updates a file via the Contents API. Pass `sha` to update an existing file. */
  async putFile(args: PutFileArgs): Promise<PutFileResult> {
    const url = `${API}/repos/${args.owner}/${args.repo}/contents/${args.path}`;
    const payload: Record<string, unknown> = {
      message: args.message,
      content: Buffer.from(args.content, "utf8").toString("base64"),
      branch: args.branch,
    };
    if (args.sha) payload.sha = args.sha;
    const res = await fetch(url, { method: "PUT", headers: this.headers(), body: JSON.stringify(payload) });
    if (!res.ok) throw new Error(`github putFile ${res.status}: ${await res.text().catch(() => "")}`);
    const body = (await res.json()) as { commit: { sha: string }; content: { sha: string } };
    return { commitSha: body.commit.sha, contentSha: body.content.sha };
  }

  /** Returns the sha of a branch's HEAD commit (used to branch off for PR mode). */
  async getBranchHeadSha(owner: string, repo: string, branch: string): Promise<string> {
    const url = `${API}/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`;
    const res = await fetch(url, { headers: this.headers() });
    if (!res.ok) throw new Error(`github getRef ${res.status}: ${await res.text().catch(() => "")}`);
    const body = (await res.json()) as { object: { sha: string } };
    return body.object.sha;
  }

  /** Creates a new branch ref pointing at fromSha. */
  async createBranch(owner: string, repo: string, branch: string, fromSha: string): Promise<void> {
    const url = `${API}/repos/${owner}/${repo}/git/refs`;
    const res = await fetch(url, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: fromSha }),
    });
    if (!res.ok) throw new Error(`github createBranch ${res.status}: ${await res.text().catch(() => "")}`);
  }

  /** Opens a PR and returns its html_url. */
  async openPullRequest(args: {
    owner: string; repo: string; head: string; base: string; title: string; body: string;
  }): Promise<string> {
    const url = `${API}/repos/${args.owner}/${args.repo}/pulls`;
    const res = await fetch(url, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ title: args.title, head: args.head, base: args.base, body: args.body }),
    });
    if (!res.ok) throw new Error(`github openPR ${res.status}: ${await res.text().catch(() => "")}`);
    const body = (await res.json()) as { html_url: string };
    return body.html_url;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/github-client.test.ts`
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
git add src/github/client.ts tests/github-client.test.ts
git commit -m "feat: GitHub Contents API client (get/put file, branch, PR)"
```

---

### Task 4: GitHub-MDX publish adapter

**Files:**
- Create: `src/adapters/publish/github-mdx.ts`
- Test: `tests/github-mdx.test.ts`

Behavior: convert the Article to MDX (Task 2), write `content/<type>/<slug>.mdx`, then read-merge-write `content/manifest.json` (an object keyed by slug). Direct-commit to `branch` by default; if `adapterConfig.prMode` is true, create a branch off the base and open a PR. `adapterConfig`: `{ owner, repo, branch?, basePath?, prMode?, type? }`. `creds`: `{ token }`. The content type comes from `adapterConfig.type` or defaults to `"guides"` (the orchestrator passes the real type via adapterConfig at call time — see Task 8 note; for Phase 2 the adapter reads `site.adapterConfig.type` if present, else `"guides"`).

> Note: `PublishAdapter.publish(article, site, creds)` has no contentType param. To keep the Phase 1 interface stable, the adapter derives the type from `article.category` is NOT reliable; instead the orchestrator writes the resolved content type into a per-call field. Phase 2 keeps it simple: the adapter uses `(site.adapterConfig.type as string) ?? "guides"`. (A future refactor can thread contentType through the interface; out of scope here.)

- [ ] **Step 1: Write the failing test — `tests/github-mdx.test.ts`** (mocks `fetch`; asserts the two writes + returned url)

```ts
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
  // Sequence: GET manifest (404 -> none), PUT mdx, PUT manifest
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

    // mdx body had its visual token inlined
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
    expect(sent.sha).toBe("manifestSha"); // update path includes prior sha
    const merged = JSON.parse(Buffer.from(sent.content, "base64").toString("utf8"));
    expect(Object.keys(merged).sort()).toEqual(["cut-blinkit-ad-waste-2026", "old-slug"]);
  });

  it("throws when token is missing", async () => {
    const adapter = new GitHubMdxAdapter();
    await expect(adapter.publish(article, site, {})).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/github-mdx.test.ts`
Expected: FAIL ("Cannot find module ... github-mdx.js").

- [ ] **Step 3: Implement `src/adapters/publish/github-mdx.ts`**

```ts
import type { Article } from "../../domain/article.js";
import type { Site } from "../../service/sites.js";
import type { PublishAdapter, PublishResult } from "./index.js";
import { registerPublishAdapter } from "./index.js";
import { GitHubClient } from "../../github/client.js";
import { articleToMdx, manifestEntry, mdxPath } from "./mdx-format.js";

interface GitHubMdxConfig {
  owner?: string;
  repo?: string;
  branch?: string;
  basePath?: string;
  type?: string;
  prMode?: boolean;
}

export class GitHubMdxAdapter implements PublishAdapter {
  readonly type = "github-mdx";

  async publish(article: Article, site: Site, creds: Record<string, unknown>): Promise<PublishResult> {
    const token = creds.token as string | undefined;
    if (!token) throw new Error("github-mdx adapter: missing 'token' credential");

    const cfg = (site.adapterConfig ?? {}) as GitHubMdxConfig;
    if (!cfg.owner || !cfg.repo) throw new Error("github-mdx adapter: adapterConfig.owner and .repo are required");
    const branch = cfg.branch ?? "main";
    const basePath = cfg.basePath ?? "content";
    const type = cfg.type ?? "guides";
    const gh = new GitHubClient(token);

    const mdx = articleToMdx(article);
    const filePath = mdxPath(article.slug, type, basePath);
    const manifestPath = `${basePath}/manifest.json`;

    // Direct-commit mode (default). PR mode writes to a fresh branch and opens a PR.
    let targetBranch = branch;
    let prUrl: string | undefined;
    if (cfg.prMode) {
      const headSha = await gh.getBranchHeadSha(cfg.owner, cfg.repo, branch);
      targetBranch = `qcontent/${article.slug}`;
      await gh.createBranch(cfg.owner, cfg.repo, targetBranch, headSha);
    }

    // 1. Write the MDX file.
    const mdxRes = await gh.putFile({
      owner: cfg.owner, repo: cfg.repo, path: filePath,
      message: `content: add "${article.title}"`, content: mdx, branch: targetBranch,
    });

    // 2. Read-merge-write the manifest (keyed by slug).
    const existing = await gh.getFile(cfg.owner, cfg.repo, manifestPath, targetBranch);
    const manifest: Record<string, unknown> = existing ? safeParse(existing.content) : {};
    manifest[article.slug] = manifestEntry(article, type, basePath);
    await gh.putFile({
      owner: cfg.owner, repo: cfg.repo, path: manifestPath,
      message: `content: register "${article.slug}" in manifest`,
      content: JSON.stringify(manifest, null, 2) + "\n",
      branch: targetBranch,
      ...(existing ? { sha: existing.sha } : {}),
    });

    // 3. PR mode: open the PR.
    if (cfg.prMode) {
      prUrl = await gh.openPullRequest({
        owner: cfg.owner, repo: cfg.repo, head: targetBranch, base: branch,
        title: `content: add "${article.title}"`,
        body: `Automated content addition for \`${article.slug}\`.`,
      });
    }

    const url = site.baseUrl
      ? `${site.baseUrl.replace(/\/$/, "")}/${type}/${article.slug}`
      : article.slug;
    return { url, ref: { commitSha: mdxRes.commitSha, path: filePath, branch: targetBranch, prUrl } };
  }
}

function safeParse(s: string): Record<string, unknown> {
  try {
    const v = JSON.parse(s);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

registerPublishAdapter("github-mdx", () => new GitHubMdxAdapter());
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/github-mdx.test.ts`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
git add src/adapters/publish/github-mdx.ts tests/github-mdx.test.ts
git commit -m "feat: github-mdx publish adapter (Contents API, manifest, PR mode)"
```

---

### Task 5: Google Indexing adapter

**Files:**
- Create: `src/adapters/index/google-indexing.ts`
- Test: `tests/google-indexing.test.ts`

Behavior: mint a service-account JWT with `jose`, exchange for an access token, POST the URL to the Indexing API, and ping sitemaps. `runIndexing(creds, url, sitemapUrl?)` is the entry point the orchestrator calls; it no-ops (returns `{skipped:true}`) if creds are absent.

- [ ] **Step 1: Write the failing test — `tests/google-indexing.test.ts`** (mocks `jose` + `fetch`)

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("jose", () => ({
  importPKCS8: vi.fn().mockResolvedValue({ fake: "key" }),
  SignJWT: class {
    setProtectedHeader() { return this; }
    setIssuedAt() { return this; }
    setIssuer() { return this; }
    setSubject() { return this; }
    setAudience() { return this; }
    setExpirationTime() { return this; }
    setClaim() { return this; }
    async sign() { return "signed.jwt.token"; }
  },
}));

import { runIndexing } from "../src/adapters/index/google-indexing.js";

const creds = {
  client_email: "svc@proj.iam.gserviceaccount.com",
  private_key: "-----BEGIN PRIVATE KEY-----\nMIIfake\n-----END PRIVATE KEY-----\n",
};

beforeEach(() => vi.unstubAllGlobals());

describe("runIndexing", () => {
  it("skips when creds are null", async () => {
    const out = await runIndexing(null, "https://x/y");
    expect(out).toEqual({ skipped: true });
  });

  it("gets a token then publishes the URL, then pings the sitemap", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ access_token: "at-123" }) }) // token
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ urlNotificationMetadata: {} }) }) // publish
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => "OK" }); // sitemap ping
    vi.stubGlobal("fetch", fetchMock);

    const out = await runIndexing(creds, "https://x/y", "https://x/sitemap.xml");
    expect(out).toMatchObject({ skipped: false, submitted: true });

    // token request
    expect(fetchMock.mock.calls[0]![0]).toBe("https://oauth2.googleapis.com/token");
    // publish request carries the bearer token + URL_UPDATED
    const [pubUrl, pubInit] = fetchMock.mock.calls[1]!;
    expect(pubUrl).toBe("https://indexing.googleapis.com/v3/urlNotifications:publish");
    expect((pubInit as RequestInit).headers).toMatchObject({ Authorization: "Bearer at-123" });
    expect(JSON.parse((pubInit as RequestInit).body as string)).toEqual({ url: "https://x/y", type: "URL_UPDATED" });
  });

  it("does not throw if the publish call fails (returns submitted:false)", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ access_token: "at" }) })
      .mockResolvedValueOnce({ ok: false, status: 403, text: async () => "denied" });
    vi.stubGlobal("fetch", fetchMock);
    const out = await runIndexing(creds, "https://x/y");
    expect(out).toMatchObject({ skipped: false, submitted: false });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/google-indexing.test.ts`
Expected: FAIL ("Cannot find module ... google-indexing.js").

- [ ] **Step 3: Implement `src/adapters/index/google-indexing.ts`**

```ts
import { importPKCS8, SignJWT } from "jose";

export interface ServiceAccount {
  client_email: string;
  private_key: string;
}

export interface IndexingResult {
  skipped: boolean;
  submitted?: boolean;
  pinged?: boolean;
}

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const PUBLISH_URL = "https://indexing.googleapis.com/v3/urlNotifications:publish";
const SCOPE = "https://www.googleapis.com/auth/indexing";

async function getAccessToken(sa: ServiceAccount): Promise<string> {
  const key = await importPKCS8(sa.private_key, "RS256");
  const assertion = await new SignJWT({ scope: SCOPE })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuedAt()
    .setIssuer(sa.client_email)
    .setSubject(sa.client_email)
    .setAudience(TOKEN_URL)
    .setExpirationTime("1h")
    .sign(key);

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }).toString(),
  });
  if (!res.ok) throw new Error(`google token ${res.status}: ${await res.text().catch(() => "")}`);
  const body = (await res.json()) as { access_token: string };
  return body.access_token;
}

/**
 * Submit a URL to the Google Indexing API and (optionally) ping the sitemap.
 * No-ops when creds are absent. Never throws on submission failure — returns submitted:false.
 */
export async function runIndexing(
  sa: ServiceAccount | null | undefined,
  url: string,
  sitemapUrl?: string,
): Promise<IndexingResult> {
  if (!sa || !sa.client_email || !sa.private_key) return { skipped: true };
  const token = await getAccessToken(sa);

  let submitted = false;
  try {
    const res = await fetch(PUBLISH_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ url, type: "URL_UPDATED" }),
    });
    submitted = res.ok;
  } catch {
    submitted = false;
  }

  let pinged = false;
  if (sitemapUrl) {
    try {
      const ping = `https://www.google.com/ping?sitemap=${encodeURIComponent(sitemapUrl)}`;
      const res = await fetch(ping);
      pinged = res.ok;
    } catch {
      pinged = false;
    }
  }

  return { skipped: false, submitted, pinged };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/google-indexing.test.ts`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
git add src/adapters/index/google-indexing.ts tests/google-indexing.test.ts
git commit -m "feat: Google Indexing adapter (service-account JWT, submit + ping)"
```

---

### Task 6: Telegram notifier

**Files:**
- Create: `src/adapters/notify/telegram.ts`
- Test: `tests/telegram.test.ts`

Behavior: `sendTelegram(creds, html)` POSTs to the Bot API; `notifyPublished`/`notifyFailure` build the message. No-ops if creds absent. Never throws (notification failure must not fail a run).

- [ ] **Step 1: Write the failing test — `tests/telegram.test.ts`** (mocks `fetch`)

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { sendTelegram, notifyPublished, notifyFailure } from "../src/adapters/notify/telegram.js";

beforeEach(() => vi.unstubAllGlobals());

const creds = { botToken: "BOT", chatId: "123" };

describe("sendTelegram", () => {
  it("skips when creds are absent", async () => {
    const out = await sendTelegram(null, "hi");
    expect(out).toEqual({ sent: false, skipped: true });
  });

  it("POSTs to the bot sendMessage endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);
    const out = await sendTelegram(creds, "<b>hello</b>");
    expect(out).toEqual({ sent: true, skipped: false });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.telegram.org/botBOT/sendMessage");
    const sent = JSON.parse((init as RequestInit).body as string);
    expect(sent).toMatchObject({ chat_id: "123", text: "<b>hello</b>", parse_mode: "HTML" });
  });

  it("never throws when the network call fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));
    const out = await sendTelegram(creds, "x");
    expect(out).toEqual({ sent: false, skipped: false });
  });
});

describe("message builders", () => {
  it("notifyPublished includes title and url", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);
    await notifyPublished(creds, { title: "My Post", url: "https://x/y", type: "guides" });
    const text = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string).text as string;
    expect(text).toContain("My Post");
    expect(text).toContain("https://x/y");
  });

  it("notifyFailure includes the error", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);
    await notifyFailure(creds, { site: "ladya", jobType: "generate", error: "boom" });
    const text = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string).text as string;
    expect(text).toContain("boom");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/telegram.test.ts`
Expected: FAIL ("Cannot find module ... telegram.js").

- [ ] **Step 3: Implement `src/adapters/notify/telegram.ts`**

```ts
export interface TelegramCreds {
  botToken: string;
  chatId: string;
}

export interface NotifyResult {
  sent: boolean;
  skipped: boolean;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** POST a message to Telegram. No-ops when creds absent; never throws. */
export async function sendTelegram(
  creds: TelegramCreds | null | undefined,
  html: string,
): Promise<NotifyResult> {
  if (!creds || !creds.botToken || !creds.chatId) return { sent: false, skipped: true };
  try {
    const res = await fetch(`https://api.telegram.org/bot${creds.botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: creds.chatId, text: html, parse_mode: "HTML", disable_web_page_preview: false }),
    });
    return { sent: res.ok, skipped: false };
  } catch {
    return { sent: false, skipped: false };
  }
}

export function notifyPublished(
  creds: TelegramCreds | null | undefined,
  p: { title: string; url: string; type: string },
): Promise<NotifyResult> {
  const msg = `✅ <b>Published</b> (${escapeHtml(p.type)})\n${escapeHtml(p.title)}\n${escapeHtml(p.url)}`;
  return sendTelegram(creds, msg);
}

export function notifyFailure(
  creds: TelegramCreds | null | undefined,
  p: { site: string; jobType: string; error: string },
): Promise<NotifyResult> {
  const msg = `❌ <b>${escapeHtml(p.jobType)} failed</b> — ${escapeHtml(p.site)}\n${escapeHtml(p.error)}`;
  return sendTelegram(creds, msg);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/telegram.test.ts`
Expected: PASS (5 passed).

- [ ] **Step 5: Commit**

```bash
git add src/adapters/notify/telegram.ts tests/telegram.test.ts
git commit -m "feat: Telegram notifier (publish + failure messages)"
```

---

### Task 7: Wire indexing + notifications into the orchestrator

**Files:**
- Modify: `src/generation/orchestrator.ts`
- Test: `tests/orchestrator-notify.test.ts`

Behavior: after a successful publish + record, the orchestrator (a) submits the URL to Google Indexing when a `google-indexing` credential exists for the site, using `site.indexing.sitemapUrl` if present, and (b) sends a Telegram "published" notification when a `telegram` credential exists. On any failure that reaches the catch block, it sends a Telegram failure notification. All of these are best-effort: they are logged to the run but never change the run's ok/failed status or throw.

- [ ] **Step 1: Write the failing test — `tests/orchestrator-notify.test.ts`**

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
import { addTopic } from "../src/service/topics.js";
import { runGenerate } from "../src/generation/orchestrator.js";
import { registerLLMProvider } from "../src/providers/llm/index.js";

const URL = `file:${join(tmpdir(), `qcontent-notify-test-${randomUUID()}.db`)}`;

const fakeArticle = {
  title: "How to Cut Blinkit Ad Waste in 2026: A Practical Guide",
  slug: "notify-cut-waste",
  excerpt: "A specific, concrete meta description about reducing Blinkit ad waste with steps, benchmarks, and data points to cite.",
  category: "Guides", tags: ["blinkit"], date: "2026-05-31",
  bodyMarkdown: "Lead.\n\n## What is ad waste?\n\nSee {{visual:v}}.",
  tldr: "Pause dark hours; save 18-30%.",
  faqs: [{ question: "a?", answer: "b" }, { question: "c?", answer: "d" }, { question: "e?", answer: "f" }],
  takeaways: ["Pause dark hours", "Tighten match", "Cap CPC", "Review weekly"],
  relatedSlugs: [], visuals: [{ token: "v", kind: "svg", code: "<svg/>", alt: "chart" }],
  seoHints: { jsonldType: "Article", mentions: ["Blinkit"], speakableSelectors: ["h1"] },
};

let siteId: string;
beforeAll(async () => {
  process.env.QCONTENT_MASTER_KEY = randomBytes(32).toString("base64");
  await runMigrations(URL);
  const db = makeDb(URL);
  const brand = await createBrand(db, { name: "Ladya", slug: "ladya-notify", seedKeywords: ["blinkit ads"] });
  const site = await createSite(db, {
    brandId: brand.id, name: "Ladya", slug: "ladya-notify-site", adapterType: "webhook",
    baseUrl: "https://ladya.in", contentTypes: { guides: {} },
    indexing: { sitemapUrl: "https://ladya.in/sitemap.xml" },
  });
  siteId = site.id;
  await saveCredential(db, { siteId, integration: "webhook", secret: { url: "https://hook.test/in", token: "t" } });
  await saveCredential(db, { siteId, integration: "telegram", secret: { botToken: "BOT", chatId: "1" } });
  await addTopic(db, { siteId, title: "How to reduce Blinkit ad waste?", source: "manual", status: "approved", priority: 5 });

  registerLLMProvider("fake", () => ({ name: "fake", async generateJson() { return fakeArticle as never; } }));
});

describe("orchestrator notifications", () => {
  it("sends a telegram 'published' message after a successful publish", async () => {
    const db = makeDb(URL);
    const tgCalls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (typeof url === "string" && url.includes("api.telegram.org")) tgCalls.push(url);
      return { ok: true, status: 200, json: async () => ({ ok: true, id: "wh" }), text: async () => "ok" } as Response;
    }) as never);

    const result = await runGenerate(db, { siteId, llmProvider: "fake", contentType: "guides" });
    expect(result.status).toBe("ok");
    expect(tgCalls.length).toBeGreaterThanOrEqual(1); // a published notification went out
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/orchestrator-notify.test.ts`
Expected: FAIL — the run succeeds but no Telegram call is made yet (`tgCalls.length` is 0), so the assertion fails.

- [ ] **Step 3: Modify `src/generation/orchestrator.ts`**

Add side-effect imports for the new built-ins near the existing ones at the top:

```ts
import "../adapters/publish/github-mdx.js";
```

Add these imports alongside the existing service/provider imports:

```ts
import { runIndexing, type ServiceAccount } from "../adapters/index/google-indexing.js";
import { notifyPublished, notifyFailure, type TelegramCreds } from "../adapters/notify/telegram.js";
```

Then, inside `runGenerate`, AFTER the existing `await recordPublished({...})` and BEFORE `await run.finishOk({...})`, insert the best-effort post-publish side effects:

```ts
    // Best-effort: Google Indexing (only if a service-account credential exists for the site).
    try {
      const sa = await getCredential<ServiceAccount>(db, args.siteId, "google-indexing");
      const sitemapUrl = (site.indexing as Record<string, unknown> | null)?.sitemapUrl as string | undefined;
      const idx = await runIndexing(sa, published.url, sitemapUrl);
      await run.log("info", "indexing", idx as Record<string, unknown>);
    } catch (e) {
      await run.log("warn", "indexing error", { message: e instanceof Error ? e.message : String(e) });
    }

    // Best-effort: Telegram publish notification.
    try {
      const tg = await getCredential<TelegramCreds>(db, args.siteId, "telegram");
      await notifyPublished(tg, { title: article.title, url: published.url, type: contentType });
    } catch (e) {
      await run.log("warn", "notify error", { message: e instanceof Error ? e.message : String(e) });
    }
```

And in the existing `catch (err)` block, AFTER `await run.finishFailed(message);` and BEFORE `return { status: "failed", error: message };`, add a best-effort failure notification:

```ts
    try {
      const tg = await getCredential<TelegramCreds>(db, args.siteId, "telegram");
      await notifyFailure(tg, { site: args.siteId, jobType: "generate", error: message });
    } catch {
      // swallow — never let a notification failure mask the original error
    }
```

> Note: `getCredential`, `site`, `published`, `article`, `contentType`, `run`, and `message` are all already in scope at these points from Phase 1's `runGenerate`. Do not change the function signature or the ok/failed return semantics.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/orchestrator-notify.test.ts`
Expected: PASS (1 passed).

- [ ] **Step 5: Run the full suite + typecheck**

Run: `npx vitest run && npm run typecheck`
Expected: all test files pass (Phase 1 + Phase 2); no type errors. The Phase 1 `orchestrator.test.ts` and `e2e.test.ts` still pass because their `fetch` stubs return ok for any URL (including any telegram/indexing calls), and those sites have no telegram/google-indexing credentials so the notifier/indexer no-op.

- [ ] **Step 6: Commit**

```bash
git add src/generation/orchestrator.ts tests/orchestrator-notify.test.ts
git commit -m "feat: wire Google Indexing + Telegram into the generate orchestrator"
```

---

### Task 8: CLI — allow github-mdx + indexing/telegram credentials, register adapter

**Files:**
- Modify: `src/cli/index.ts`

Behavior: ensure the github-mdx adapter is registered for CLI runs, and document the new credential integrations. The CLI already has generic `creds:set --integration <name>` and `site:add --adapter <type>`, so no new commands are strictly required; we only add the side-effect import so `--adapter github-mdx` works from the CLI, and add `--config <json>` support to `site:add` so adapterConfig (owner/repo/branch/type) can be set.

- [ ] **Step 1: Add the github-mdx side-effect import**

In `src/cli/index.ts`, add to the existing side-effect import block:

```ts
import "../adapters/publish/github-mdx.js";
```

- [ ] **Step 2: Add `--config` to `site:add`**

Modify the `site:add` command to accept an optional `--config <json>` and pass it as `adapterConfig`:

```ts
program
  .command("site:add")
  .requiredOption("--brand <brandId>")
  .requiredOption("--name <name>")
  .requiredOption("--slug <slug>")
  .requiredOption("--adapter <type>")
  .option("--base-url <url>")
  .option("--config <json>", "adapter config as JSON (e.g. github owner/repo/branch/type)")
  .action(async (o) => {
    const site = await createSite(db, {
      brandId: o.brand, name: o.name, slug: o.slug, adapterType: o.adapter, baseUrl: o.baseUrl,
      ...(o.config ? { adapterConfig: JSON.parse(o.config) } : {}),
    });
    console.log("site created:", site.id);
  });
```

- [ ] **Step 3: Typecheck + smoke run**

Run: `npm run typecheck`
Expected: clean.

Run: `npx tsx src/cli/index.ts --help`
Expected: command list prints (unchanged set; `site:add` now accepts `--config`).

- [ ] **Step 4: Full suite**

Run: `npx vitest run`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add src/cli/index.ts
git commit -m "feat: CLI registers github-mdx + site:add --config for adapterConfig"
```

---

### Task 9: README + .env.example updates

**Files:**
- Modify: `README.md`, `.env.example`

- [ ] **Step 1: Update `.env.example`**

Append the Phase 2 vars (Google Indexing + Telegram are stored as per-site credentials via the DB, not env, so document that). Add to `.env.example`:

```bash
# --- Phase 2 integrations are stored per-site via `creds:set` (encrypted in the DB), e.g.:
#   github-mdx token:   qcontent creds:set --site <id> --integration github-mdx --json '{"token":"ghp_..."}'
#   telegram:           qcontent creds:set --site <id> --integration telegram --json '{"botToken":"...","chatId":"..."}'
#   google-indexing:    qcontent creds:set --site <id> --integration google-indexing --json '{"client_email":"...","private_key":"..."}'
# No additional .env vars are required for Phase 2.
```

- [ ] **Step 2: Update `README.md`**

Replace the Roadmap line for Phase 2 with a "Phase 2 (done)" subsection documenting the github-mdx adapter convention. Add this block under the existing `## Phase 1 (this build)` section:

```markdown
## Phase 2 (done): GitHub-MDX adapter + Indexing + Notify

Publish to GitHub-hosted MDX sites via the GitHub Contents API. The engine writes
`content/<type>/<slug>.mdx` (YAML frontmatter + body, visuals inlined as `<svg>` / markdown
images) and upserts `content/manifest.json` (keyed by slug) — your site reads the manifest, no
directory globbing required. Direct-commit by default; set `adapterConfig.prMode: true` for PRs.

Set up a github-mdx site:
\`\`\`bash
qcontent site:add --brand <brandId> --name "My Blog" --slug myblog --adapter github-mdx \
  --base-url https://myblog.com \
  --config '{"owner":"me","repo":"myblog","branch":"main","type":"guides"}'
qcontent creds:set --site <siteId> --integration github-mdx --json '{"token":"ghp_xxx"}'
# optional:
qcontent creds:set --site <siteId> --integration telegram --json '{"botToken":"...","chatId":"..."}'
qcontent creds:set --site <siteId> --integration google-indexing --json '{"client_email":"...","private_key":"..."}'
\`\`\`
```

(Render real backtick fences in the file.)

- [ ] **Step 3: Full suite + typecheck (docs-only, just confirm nothing broke)**

Run: `npx vitest run && npm run typecheck`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add README.md .env.example
git commit -m "docs: document Phase 2 github-mdx adapter + per-site credentials"
```

---

## Self-Review (against the spec)

**Spec coverage (Phase 2, §10 + §4 + §7):**
- GitHub-MDX adapter, drop-in convention (frontmatter MDX + manifest), no source string-surgery → Tasks 2, 3, 4. ✓
- Direct-commit + PR-optional per site → Task 4 (`prMode`). ✓
- Visuals inlined (svg/image) per the canonical model → Task 2. ✓
- Google Indexing (submit URL + sitemap ping, service-account) → Task 5; wired in Task 7. ✓
- Telegram notify (publish + failure), never masks run status → Task 6; wired in Task 7. ✓
- Best-effort, credential-gated, per-site → Task 7 (reads `google-indexing`/`telegram` creds; no-ops when absent). ✓
- CLI usable for github-mdx sites + adapterConfig → Task 8. ✓
- Docs/convention published for target sites → Task 9. ✓

**Placeholder scan:** No TBD/TODO/"add error handling"-style steps; every code step shows full code.

**Type consistency:** `GitHubClient` methods (`getFile`→`{sha,content}|null`, `putFile`→`{commitSha,contentSha}`, `getBranchHeadSha`, `createBranch`, `openPullRequest`) are used exactly as defined by `GitHubMdxAdapter`. `articleToMdx`/`manifestEntry`/`mdxPath` signatures match their call sites. `runIndexing(sa, url, sitemapUrl?)` and `ServiceAccount` match Task 7's usage. `sendTelegram`/`notifyPublished`/`notifyFailure`/`TelegramCreds` match Task 7's usage. The adapter is registered as `github-mdx` matching `site.adapterType`. `PublishResult.ref` shape (`{commitSha, path, branch, prUrl?}`) is free-form `unknown` per the Phase 1 interface, so no contract break.

**Known limitation (documented, in-scope):** the `PublishAdapter.publish` interface has no `contentType` parameter, so the github-mdx adapter reads the type from `adapterConfig.type` (defaulting to `"guides"`). Threading `contentType` through the adapter interface is deferred to a later refactor and noted in Task 4.
