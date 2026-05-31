# qcontent Phase 5 (HTTP API + Dashboard) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose the existing service + jobs layer over a small bearer-authenticated JSON HTTP API (built on `node:http`, no web framework), and serve a single static HTML dashboard that lists brands/sites/runs, shows run logs, queues topics, and triggers jobs.

**Architecture:** A dependency-free **tiny router** maps `METHOD /path/:param` to async handlers; an **app factory** `createApp(db, token)` returns a pure `handle(method, path, headers, bodyText)` function (unit-testable with no sockets), and `startServer` wraps it in `node:http`. Every `/api/*` route requires `Authorization: Bearer <QCONTENT_API_TOKEN>`. Handlers call the existing service functions (`listBrands`, `listSites`, `addTopic`, …), a new **runs read-service** (`listRuns`/`getRun`/`getRunLogs`), and the **`runJob` dispatcher**. The dashboard is one static HTML+vanilla-JS file served at `/`.

**Tech Stack:** Existing (TS ESM, Drizzle/Turso, zod, vitest, commander). New deps: none — uses `node:http` and the global `fetch` for tests.

**Spec:** `docs/superpowers/specs/2026-05-31-qcontent-multisite-engine-design.md` — Phase 5 in §10 (HTTP API + dashboard on the existing service layer).

**Builds on Phases 1–4 (merged to master).** Exact existing exports this plan uses:
- `src/env.ts` — `env` object (extend with `apiToken`).
- `src/db/client.ts` — `makeDb`, `db`, type `DB`. `src/db/migrate.ts` — `runMigrations`.
- `src/service/brands.ts` — `createBrand(db, {name, slug, ...})`, `getBrand`, `listBrands`, type `Brand`.
- `src/service/sites.ts` — `createSite(db, {brandId, name, slug, adapterType, ...})`, `getSite`, `getSiteBySlug`, `listSites`, type `Site`.
- `src/service/topics.ts` — `addTopic(db, {siteId, title, source, ...})`, type `Topic`.
- `src/service/credentials.ts` — `saveCredential(db, {siteId?, integration, secret})`.
- `src/service/published.ts` — `getPublishedForSite(db, siteId)`, type `PublishedRow`.
- `src/jobs/index.ts` — `runJob(db, jobType, args)`, `knownJobTypes()`.
- `src/db/schema.ts` — `runs`, `runLogs` tables (read in the new runs read-service).

**Conventions (carry over):**
- ESM/NodeNext: project imports use `.js`; tests import `../src/...js`.
- `noUncheckedIndexedAccess` on — guard indexed access with `!`/`??`.
- DB tests use a temp-file libSQL URL: `file:${join(tmpdir(), \`qcontent-<name>-test-${randomUUID()}.db\`)}`.
- **Run the FULL suite + typecheck before every commit** (`npx vitest run && npx tsc --noEmit -p tsconfig.json`), not just the new test file — and confirm each `Edit` actually applied (watch for "String to replace not found"; the codebase uses 2-space indentation).
- Node 26 global `fetch`. Phase 4 left the suite at 34 files / 92 tests green.

---

## File Structure (Phase 5)

```
src/
  env.ts               # MODIFY: add apiToken (QCONTENT_API_TOKEN)
  service/
    runs.ts            # MODIFY: add listRuns / getRun / getRunLogs read helpers
  api/
    router.ts          # NEW: tiny method+path router with :params
    json.ts            # NEW: json() / error() response helpers + readBody
    app.ts             # NEW: createApp(db, token) -> handle(method, path, headers, bodyText)
    server.ts          # NEW: startServer(opts) wraps createApp in node:http
    dashboard.html     # NEW: single static page (served at /)
  cli/
    index.ts           # MODIFY: add `serve` command
tests/
  api-router.test.ts
  api-app.test.ts
  api-server.test.ts
```

Repo root: `/Users/vishalkumar/Downloads/qcontent`. Controller creates branch `phase5-http-api-dashboard` before Task 1.

---

### Task 1: Add `apiToken` to env + runs read-service

**Files:**
- Modify: `src/env.ts`, `src/service/runs.ts`
- Test: `tests/api-app.test.ts` will exercise the runs read-service later; add a focused runs test here in `tests/runs.test.ts` (existing file) — but to avoid editing the existing test file's structure, create the read functions and verify them via a small new test block appended to `tests/runs.test.ts`.

- [ ] **Step 1: Add `apiToken` to `src/env.ts`**

Add the field to the `env` object:

```ts
export const env = {
  masterKey: opt("QCONTENT_MASTER_KEY"),
  tursoUrl: opt("TURSO_DATABASE_URL") ?? "file:local.db",
  tursoToken: opt("TURSO_AUTH_TOKEN"),
  anthropicKey: opt("ANTHROPIC_API_KEY"),
  dataforseoLogin: opt("DATAFORSEO_LOGIN"),
  dataforseoPassword: opt("DATAFORSEO_PASSWORD"),
  apiToken: opt("QCONTENT_API_TOKEN"),
};
```

- [ ] **Step 2: Write the failing test — append to `tests/runs.test.ts`**

Open `tests/runs.test.ts` and add these imports at the top (alongside existing ones) and a new `describe` at the end. (The file already sets `QCONTENT_MASTER_KEY`, runs migrations on a temp-file URL, and inserts a brand + site in `beforeAll`; reuse its `URL` and `siteId`.)

Add to imports:
```ts
import { listRuns, getRun, getRunLogs } from "../src/service/runs.js";
```

Append at the end of the file:
```ts
describe("runs read-service", () => {
  it("lists runs for a site (newest first) and fetches one with its logs", async () => {
    const db = makeDb(URL);
    const run = await startRun(db, { siteId, jobType: "generate" });
    await run.log("info", "hello", { a: 1 });
    await run.finishOk({ ok: true });

    const list = await listRuns(db, { siteId });
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(list[0]!.jobType).toBe("generate");
    expect(list[0]!.status).toBe("ok");

    const got = await getRun(db, run.id);
    expect(got?.id).toBe(run.id);

    const logs = await getRunLogs(db, run.id);
    expect(logs.length).toBeGreaterThanOrEqual(1);
    expect(logs.some((l) => l.message === "hello")).toBe(true);
  });

  it("listRuns without siteId returns all runs, capped by limit", async () => {
    const db = makeDb(URL);
    const all = await listRuns(db, { limit: 1 });
    expect(all.length).toBe(1);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/runs.test.ts`
Expected: FAIL (`listRuns`/`getRun`/`getRunLogs` not exported).

- [ ] **Step 4: Implement the read-service — append to `src/service/runs.ts`**

Add these imports at the top of `src/service/runs.ts` if not present (it already imports `eq` and the tables); ensure `desc` and `and` are imported from `drizzle-orm`:

```ts
import { and, desc, eq } from "drizzle-orm";
```

Append at the end of the file:
```ts
export type RunRow = typeof runs.$inferSelect;
export type RunLogRow = typeof runLogs.$inferSelect;

/** List runs, newest first, optionally filtered by site, capped by limit (default 50). */
export async function listRuns(
  db: DB,
  opts: { siteId?: string; limit?: number } = {},
): Promise<RunRow[]> {
  const limit = opts.limit ?? 50;
  const base = db.select().from(runs);
  const rows = opts.siteId
    ? await base.where(eq(runs.siteId, opts.siteId)).orderBy(desc(runs.startedAt)).limit(limit)
    : await base.orderBy(desc(runs.startedAt)).limit(limit);
  return rows;
}

export async function getRun(db: DB, id: string): Promise<RunRow | null> {
  const rows = await db.select().from(runs).where(eq(runs.id, id)).limit(1);
  return rows[0] ?? null;
}

/** Logs for a run, oldest first. */
export async function getRunLogs(db: DB, runId: string): Promise<RunLogRow[]> {
  return db.select().from(runLogs).where(eq(runLogs.runId, runId)).orderBy(runLogs.ts);
}
```

> Note: `runs` and `runLogs` are already imported in `runs.ts` (used by `startRun`). If only `runs` is imported, add `runLogs` to that import. `and` may be unused — include it only if your final code uses it; otherwise import just `desc, eq`. Keep the existing `startRun`/`RunHandle` exports unchanged.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/runs.test.ts`
Expected: PASS (existing runs tests + 2 new).

- [ ] **Step 6: Full suite + typecheck**

Run: `npx vitest run && npx tsc --noEmit -p tsconfig.json`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add src/env.ts src/service/runs.ts tests/runs.test.ts
git commit -m "feat: QCONTENT_API_TOKEN env + runs read-service (listRuns/getRun/getRunLogs)"
```

---

### Task 2: Tiny router + JSON helpers

**Files:**
- Create: `src/api/router.ts`, `src/api/json.ts`
- Test: `tests/api-router.test.ts`

- [ ] **Step 1: Write the failing test — `tests/api-router.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { Router } from "../src/api/router.js";

describe("Router", () => {
  it("matches a static route and returns its handler result", async () => {
    const r = new Router();
    r.add("GET", "/api/sites", async () => ({ status: 200, body: { ok: true } }));
    const m = r.match("GET", "/api/sites");
    expect(m).not.toBeNull();
    const res = await m!.handler({}, m!.params, "");
    expect(res).toEqual({ status: 200, body: { ok: true } });
  });

  it("extracts path params", async () => {
    const r = new Router();
    r.add("GET", "/api/sites/:id/runs", async () => ({ status: 200, body: {} }));
    const m = r.match("GET", "/api/sites/abc123/runs");
    expect(m).not.toBeNull();
    expect(m!.params).toEqual({ id: "abc123" });
  });

  it("does not match a different method", () => {
    const r = new Router();
    r.add("POST", "/api/topics", async () => ({ status: 201, body: {} }));
    expect(r.match("GET", "/api/topics")).toBeNull();
  });

  it("does not match a different path shape", () => {
    const r = new Router();
    r.add("GET", "/api/sites/:id", async () => ({ status: 200, body: {} }));
    expect(r.match("GET", "/api/sites/abc/extra")).toBeNull();
  });

  it("ignores a trailing slash and query string when matching", () => {
    const r = new Router();
    r.add("GET", "/api/runs", async () => ({ status: 200, body: {} }));
    expect(r.match("GET", "/api/runs/")).not.toBeNull();
    expect(r.match("GET", "/api/runs?limit=10")).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/api-router.test.ts`
Expected: FAIL ("Cannot find module ... router.js").

- [ ] **Step 3: Implement `src/api/json.ts`**

```ts
import type { IncomingMessage } from "node:http";

export interface ApiResponse {
  status: number;
  body: unknown;
}

export function json(status: number, body: unknown): ApiResponse {
  return { status, body };
}

export function error(status: number, message: string): ApiResponse {
  return { status, body: { error: message } };
}

/** Read a request body stream to a string (utf8). */
export function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}
```

- [ ] **Step 4: Implement `src/api/router.ts`**

```ts
import type { ApiResponse } from "./json.js";

export type RouteHandler = (
  headers: Record<string, string | undefined>,
  params: Record<string, string>,
  bodyText: string,
) => Promise<ApiResponse>;

interface Route {
  method: string;
  segments: string[]; // path split on "/", entries beginning ":" are params
  handler: RouteHandler;
}

export interface RouteMatch {
  handler: RouteHandler;
  params: Record<string, string>;
}

function splitPath(path: string): string[] {
  const noQuery = path.split("?")[0]!;
  return noQuery.split("/").filter((s) => s.length > 0);
}

export class Router {
  private routes: Route[] = [];

  add(method: string, pattern: string, handler: RouteHandler): void {
    this.routes.push({ method: method.toUpperCase(), segments: splitPath(pattern), handler });
  }

  match(method: string, path: string): RouteMatch | null {
    const reqSegments = splitPath(path);
    for (const route of this.routes) {
      if (route.method !== method.toUpperCase()) continue;
      if (route.segments.length !== reqSegments.length) continue;
      const params: Record<string, string> = {};
      let ok = true;
      for (let i = 0; i < route.segments.length; i++) {
        const rs = route.segments[i]!;
        const ps = reqSegments[i]!;
        if (rs.startsWith(":")) {
          params[rs.slice(1)] = decodeURIComponent(ps);
        } else if (rs !== ps) {
          ok = false;
          break;
        }
      }
      if (ok) return { handler: route.handler, params };
    }
    return null;
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/api-router.test.ts`
Expected: PASS (5 passed).

- [ ] **Step 6: Full suite + typecheck**

Run: `npx vitest run && npx tsc --noEmit -p tsconfig.json`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add src/api/router.ts src/api/json.ts tests/api-router.test.ts
git commit -m "feat: tiny HTTP router + JSON response helpers"
```

---

### Task 3: App factory — routes + bearer auth

**Files:**
- Create: `src/api/app.ts`
- Test: `tests/api-app.test.ts`

The app exposes:
- `GET  /api/health` → `{ ok: true }` (no auth)
- `GET  /api/brands` → list brands
- `POST /api/brands` → create brand `{ name, slug, seedKeywords? }`
- `GET  /api/sites` → list sites
- `POST /api/sites` → create site `{ brandId, name, slug, adapterType, baseUrl?, adapterConfig? }`
- `GET  /api/sites/:id/published` → published rows for a site
- `POST /api/sites/:id/topics` → queue a topic `{ title, contentType?, approve?, priority? }`
- `POST /api/sites/:id/credentials` → `{ integration, secret }`
- `POST /api/sites/:id/run` → trigger a job `{ job, llmProvider?, contentType?, maxAgeDays?, limit? }` → `runJob` result
- `GET  /api/runs` → list runs (optional `?siteId=` `?limit=`)
- `GET  /api/runs/:id` → run + its logs `{ run, logs }`

All `/api/*` except `/api/health` require `Authorization: Bearer <token>`.

- [ ] **Step 1: Write the failing test — `tests/api-app.test.ts`**

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { randomUUID, randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMigrations } from "../src/db/migrate.js";
import { makeDb } from "../src/db/client.js";
import { createApp } from "../src/api/app.js";

const URL = `file:${join(tmpdir(), `qcontent-api-test-${randomUUID()}.db`)}`;
const TOKEN = "test-token-123";
let app: ReturnType<typeof createApp>;

const auth = { authorization: `Bearer ${TOKEN}` };

beforeAll(async () => {
  process.env.QCONTENT_MASTER_KEY = randomBytes(32).toString("base64");
  await runMigrations(URL);
  app = createApp(makeDb(URL), TOKEN);
});

describe("createApp auth", () => {
  it("health needs no auth", async () => {
    const res = await app.handle("GET", "/api/health", {}, "");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true });
  });

  it("rejects missing/wrong bearer token with 401", async () => {
    expect((await app.handle("GET", "/api/brands", {}, "")).status).toBe(401);
    expect((await app.handle("GET", "/api/brands", { authorization: "Bearer nope" }, "")).status).toBe(401);
  });

  it("returns 404 for an unknown route", async () => {
    expect((await app.handle("GET", "/api/nope", auth, "")).status).toBe(404);
  });
});

describe("createApp CRUD + run", () => {
  it("creates a brand and a site, queues a topic, lists them", async () => {
    const b = await app.handle("POST", "/api/brands", auth, JSON.stringify({ name: "Ladya", slug: "ladya-api", seedKeywords: ["blinkit ads"] }));
    expect(b.status).toBe(201);
    const brandId = (b.body as { id: string }).id;
    expect(brandId).toBeTruthy();

    const s = await app.handle("POST", "/api/sites", auth, JSON.stringify({ brandId, name: "Ladya", slug: "ladya-api-site", adapterType: "webhook", baseUrl: "https://ladya.in" }));
    expect(s.status).toBe(201);
    const siteId = (s.body as { id: string }).id;

    const brands = await app.handle("GET", "/api/brands", auth, "");
    expect((brands.body as unknown[]).length).toBeGreaterThanOrEqual(1);

    const sites = await app.handle("GET", "/api/sites", auth, "");
    expect((sites.body as unknown[]).length).toBeGreaterThanOrEqual(1);

    const t = await app.handle("POST", `/api/sites/${siteId}/topics`, auth, JSON.stringify({ title: "How to reduce Blinkit ad waste?", approve: true, priority: 5 }));
    expect(t.status).toBe(201);
  });

  it("rejects a malformed create with 400", async () => {
    const res = await app.handle("POST", "/api/brands", auth, "{ not json");
    expect(res.status).toBe(400);
  });

  it("triggers a job via runJob and records a run retrievable through the API", async () => {
    // Set up a site with a fake LLM + webhook so the generate job succeeds without network/LLM.
    const { createBrand } = await import("../src/service/brands.js");
    const { createSite } = await import("../src/service/sites.js");
    const { saveCredential } = await import("../src/service/credentials.js");
    const { addTopic } = await import("../src/service/topics.js");
    const { registerLLMProvider } = await import("../src/providers/llm/index.js");
    const db = makeDb(URL);
    const brand = await createBrand(db, { name: "RunBrand", slug: "run-brand", seedKeywords: ["x"] });
    const site = await createSite(db, { brandId: brand.id, name: "RunSite", slug: "run-site", adapterType: "webhook", baseUrl: "https://run.test", contentTypes: { guides: {} } });
    await saveCredential(db, { siteId: site.id, integration: "webhook", secret: { url: "https://hook/in" } });
    await addTopic(db, { siteId: site.id, title: "How to reduce Blinkit ad waste fast?", source: "manual", status: "approved", priority: 5 });
    registerLLMProvider("fakeApi", () => ({
      name: "fakeApi",
      async generateJson() {
        return {
          title: "How to Cut Blinkit Ad Waste in 2026: A Practical Guide",
          slug: "api-run-slug",
          excerpt: "A specific, concrete meta description about reducing Blinkit ad waste with concrete steps, India benchmarks, and citable data points here.",
          category: "Guides", tags: ["blinkit"], date: "2026-05-31",
          bodyMarkdown: "Lead.\n\n## What is ad waste?\n\nBody.",
          tldr: "Pause dark hours.", faqs: [{ question: "a?", answer: "b" }, { question: "c?", answer: "d" }, { question: "e?", answer: "f" }],
          takeaways: ["one", "two", "three", "four"], relatedSlugs: [], visuals: [],
          seoHints: { jsonldType: "Article", mentions: [], speakableSelectors: [] },
        } as never;
      },
    }));
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async () => ({ ok: true, status: 200, json: async () => ({ id: "wh" }), text: async () => "ok" })) as never;
    try {
      const run = await app.handle("POST", `/api/sites/${site.id}/run`, auth, JSON.stringify({ job: "generate", llmProvider: "fakeApi", contentType: "guides" }));
      expect(run.status).toBe(200);
      expect((run.body as { status: string }).status).toBe("ok");

      const runs = await app.handle("GET", `/api/runs?siteId=${site.id}`, auth, "");
      expect((runs.body as unknown[]).length).toBeGreaterThanOrEqual(1);
      const runId = (runs.body as Array<{ id: string }>)[0]!.id;
      const detail = await app.handle("GET", `/api/runs/${runId}`, auth, "");
      expect(detail.status).toBe(200);
      expect((detail.body as { run: unknown; logs: unknown[] }).logs.length).toBeGreaterThanOrEqual(1);
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/api-app.test.ts`
Expected: FAIL ("Cannot find module ... app.js").

- [ ] **Step 3: Implement `src/api/app.ts`**

```ts
import "../adapters/publish/webhook.js";
import "../adapters/publish/github-mdx.js";
import "../adapters/publish/wordpress.js";
import "../adapters/publish/payload.js";

import type { DB } from "../db/client.js";
import { Router } from "./router.js";
import { json, error, type ApiResponse } from "./json.js";
import { createBrand, listBrands } from "../service/brands.js";
import { createSite, listSites, getSite } from "../service/sites.js";
import { addTopic } from "../service/topics.js";
import { saveCredential } from "../service/credentials.js";
import { getPublishedForSite } from "../service/published.js";
import { listRuns, getRun, getRunLogs } from "../service/runs.js";
import { runJob, knownJobTypes } from "../jobs/index.js";

export interface App {
  handle(
    method: string,
    path: string,
    headers: Record<string, string | undefined>,
    bodyText: string,
  ): Promise<ApiResponse>;
}

function parseJson(bodyText: string): Record<string, unknown> {
  if (!bodyText.trim()) return {};
  return JSON.parse(bodyText) as Record<string, unknown>;
}

export function createApp(db: DB, token: string | undefined): App {
  const router = new Router();

  router.add("GET", "/api/health", async () => json(200, { ok: true }));

  router.add("GET", "/api/brands", async () => json(200, await listBrands(db)));
  router.add("POST", "/api/brands", async (_h, _p, body) => {
    const b = parseJson(body);
    if (!b.name || !b.slug) return error(400, "name and slug are required");
    const brand = await createBrand(db, {
      name: String(b.name), slug: String(b.slug),
      seedKeywords: Array.isArray(b.seedKeywords) ? (b.seedKeywords as string[]) : [],
    });
    return json(201, brand);
  });

  router.add("GET", "/api/sites", async () => json(200, await listSites(db)));
  router.add("POST", "/api/sites", async (_h, _p, body) => {
    const b = parseJson(body);
    if (!b.brandId || !b.name || !b.slug || !b.adapterType) {
      return error(400, "brandId, name, slug, adapterType are required");
    }
    const site = await createSite(db, {
      brandId: String(b.brandId), name: String(b.name), slug: String(b.slug),
      adapterType: String(b.adapterType),
      baseUrl: b.baseUrl ? String(b.baseUrl) : undefined,
      ...(b.adapterConfig ? { adapterConfig: b.adapterConfig as Record<string, unknown> } : {}),
      ...(b.contentTypes ? { contentTypes: b.contentTypes as Record<string, unknown> } : {}),
    });
    return json(201, site);
  });

  router.add("GET", "/api/sites/:id/published", async (_h, p) => {
    const site = await getSite(db, p.id!);
    if (!site) return error(404, "site not found");
    return json(200, await getPublishedForSite(db, p.id!));
  });

  router.add("POST", "/api/sites/:id/topics", async (_h, p, body) => {
    const site = await getSite(db, p.id!);
    if (!site) return error(404, "site not found");
    const b = parseJson(body);
    if (!b.title) return error(400, "title is required");
    const topic = await addTopic(db, {
      siteId: p.id!, title: String(b.title), source: "manual",
      contentType: b.contentType ? String(b.contentType) : undefined,
      status: b.approve ? "approved" : "pending",
      priority: typeof b.priority === "number" ? b.priority : 0,
    });
    return json(201, topic);
  });

  router.add("POST", "/api/sites/:id/credentials", async (_h, p, body) => {
    const site = await getSite(db, p.id!);
    if (!site) return error(404, "site not found");
    const b = parseJson(body);
    if (!b.integration || !b.secret) return error(400, "integration and secret are required");
    await saveCredential(db, { siteId: p.id!, integration: String(b.integration), secret: b.secret });
    return json(201, { ok: true });
  });

  router.add("POST", "/api/sites/:id/run", async (_h, p, body) => {
    const site = await getSite(db, p.id!);
    if (!site) return error(404, "site not found");
    const b = parseJson(body);
    const jobType = b.job ? String(b.job) : "generate";
    if (!knownJobTypes().includes(jobType)) return error(400, `unknown job '${jobType}'`);
    const result = await runJob(db, jobType, {
      siteId: p.id!,
      ...(b.llmProvider ? { llmProvider: String(b.llmProvider) } : {}),
      ...(b.contentType ? { contentType: String(b.contentType) } : {}),
      ...(typeof b.maxAgeDays === "number" ? { maxAgeDays: b.maxAgeDays } : {}),
      ...(typeof b.limit === "number" ? { limit: b.limit } : {}),
    });
    return json(200, result);
  });

  router.add("GET", "/api/runs", async (_h, _p, _body) => json(200, await listRuns(db, {})));
  // siteId/limit query handled in handle() since router strips the query; see below.

  router.add("GET", "/api/runs/:id", async (_h, p) => {
    const run = await getRun(db, p.id!);
    if (!run) return error(404, "run not found");
    const logs = await getRunLogs(db, p.id!);
    return json(200, { run, logs });
  });

  async function handle(
    method: string,
    path: string,
    headers: Record<string, string | undefined>,
    bodyText: string,
  ): Promise<ApiResponse> {
    try {
      const isApi = path.startsWith("/api/");
      const isHealth = path.split("?")[0] === "/api/health" || path.split("?")[0] === "/api/health/";
      if (isApi && !isHealth) {
        const provided = (headers.authorization ?? headers.Authorization ?? "").replace(/^Bearer\s+/i, "");
        if (!token || provided !== token) return error(401, "unauthorized");
      }

      // Special-case GET /api/runs query params (router strips the query string).
      const pathOnly = path.split("?")[0]!;
      if (method.toUpperCase() === "GET" && (pathOnly === "/api/runs" || pathOnly === "/api/runs/")) {
        const qs = new URLSearchParams(path.includes("?") ? path.slice(path.indexOf("?") + 1) : "");
        const siteId = qs.get("siteId") ?? undefined;
        const limit = qs.get("limit") ? Number(qs.get("limit")) : undefined;
        return json(200, await listRuns(db, { siteId, ...(limit ? { limit } : {}) }));
      }

      const m = router.match(method, path);
      if (!m) return error(404, "not found");
      return await m.handler(headers, m.params, bodyText);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (err instanceof SyntaxError) return error(400, `invalid JSON: ${message}`);
      return error(500, message);
    }
  }

  return { handle };
}
```

> Note: the `GET /api/runs` router entry is a fallback; the query-aware branch in `handle()` runs first for that exact path. Both call `listRuns`. Keeping the router entry means `match` still recognizes the path shape if the special-case is ever removed.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/api-app.test.ts`
Expected: PASS (6 passed).

- [ ] **Step 5: Full suite + typecheck**

Run: `npx vitest run && npx tsc --noEmit -p tsconfig.json`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/api/app.ts tests/api-app.test.ts
git commit -m "feat: HTTP app factory (brands/sites/topics/creds/run/runs + bearer auth)"
```

---

### Task 4: node:http server + static dashboard

**Files:**
- Create: `src/api/server.ts`, `src/api/dashboard.html`
- Test: `tests/api-server.test.ts`

- [ ] **Step 1: Write the failing test — `tests/api-server.test.ts`** (binds a real port, uses global fetch)

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID, randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import { runMigrations } from "../src/db/migrate.js";
import { makeDb } from "../src/db/client.js";
import { startServer } from "../src/api/server.js";

const URL = `file:${join(tmpdir(), `qcontent-server-test-${randomUUID()}.db`)}`;
const TOKEN = "srv-token";
let server: Server;
let port: number;

beforeAll(async () => {
  process.env.QCONTENT_MASTER_KEY = randomBytes(32).toString("base64");
  await runMigrations(URL);
  const started = await startServer({ db: makeDb(URL), token: TOKEN, port: 0 });
  server = started.server;
  port = started.port;
});

afterAll(() => {
  server.close();
});

describe("startServer", () => {
  it("serves the dashboard HTML at /", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("<!DOCTYPE html>");
    expect(html.toLowerCase()).toContain("qcontent");
  });

  it("serves health without auth and rejects unauthorized API calls", async () => {
    const h = await fetch(`http://127.0.0.1:${port}/api/health`);
    expect(h.status).toBe(200);
    const unauth = await fetch(`http://127.0.0.1:${port}/api/brands`);
    expect(unauth.status).toBe(401);
  });

  it("accepts an authorized POST and returns JSON", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/brands`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Srv", slug: "srv-brand" }),
    });
    expect(res.status).toBe(201);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = await res.json();
    expect(body.slug).toBe("srv-brand");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/api-server.test.ts`
Expected: FAIL ("Cannot find module ... server.js").

- [ ] **Step 3: Create `src/api/dashboard.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>qcontent control</title>
  <style>
    :root { --bg:#0a0a0a; --card:#18181b; --line:#27272a; --text:#fafafa; --muted:#a1a1aa; --accent:#dc2626; }
    * { box-sizing:border-box; } body { margin:0; background:var(--bg); color:var(--text); font:15px/1.5 system-ui, sans-serif; }
    header { padding:16px 24px; border-bottom:1px solid var(--line); display:flex; gap:12px; align-items:center; }
    header h1 { font-size:18px; margin:0; } header input { margin-left:auto; background:var(--card); border:1px solid var(--line); color:var(--text); padding:8px 10px; border-radius:8px; width:280px; }
    main { padding:24px; display:grid; gap:24px; grid-template-columns:1fr 1fr; max-width:1200px; }
    .card { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:16px; }
    .card h2 { font-size:14px; margin:0 0 12px; color:var(--muted); text-transform:uppercase; letter-spacing:.04em; }
    table { width:100%; border-collapse:collapse; font-size:13px; } td, th { text-align:left; padding:6px 8px; border-bottom:1px solid var(--line); }
    button { background:var(--accent); color:#fff; border:0; padding:8px 12px; border-radius:8px; cursor:pointer; font-size:13px; }
    select, .card input { background:var(--bg); border:1px solid var(--line); color:var(--text); padding:7px 9px; border-radius:8px; }
    .row { display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin-bottom:8px; }
    .full { grid-column:1 / -1; } pre { white-space:pre-wrap; word-break:break-word; font-size:12px; color:var(--muted); }
    .ok { color:#4ade80; } .failed { color:var(--accent); } .running { color:#d4a853; }
  </style>
</head>
<body>
  <header>
    <h1>qcontent</h1>
    <input id="token" type="password" placeholder="API token (Bearer)" />
  </header>
  <main>
    <section class="card"><h2>Sites</h2><table id="sites"><tbody></tbody></table></section>
    <section class="card"><h2>Brands</h2><table id="brands"><tbody></tbody></table></section>
    <section class="card full"><h2>Run a job</h2>
      <div class="row">
        <select id="run-site"></select>
        <select id="run-job">
          <option>generate</option><option>reindex</option><option>maintain-links</option>
          <option>refresh</option><option>distribute-social</option>
        </select>
        <button id="run-btn">Run now</button>
        <span id="run-out" class="muted"></span>
      </div>
    </section>
    <section class="card full"><h2>Queue a topic</h2>
      <div class="row">
        <select id="topic-site"></select>
        <input id="topic-title" placeholder="Topic / question" style="flex:1; min-width:240px;" />
        <button id="topic-btn">Queue (approved)</button>
        <span id="topic-out" class="muted"></span>
      </div>
    </section>
    <section class="card full"><h2>Recent runs</h2><table id="runs"><tbody></tbody></table></section>
    <section class="card full"><h2>Run detail</h2><pre id="run-detail">Click a run above.</pre></section>
  </main>
  <script>
    const $ = (id) => document.getElementById(id);
    const tokenBox = $("token");
    tokenBox.value = localStorage.getItem("qc_token") || "";
    tokenBox.addEventListener("change", () => { localStorage.setItem("qc_token", tokenBox.value); refresh(); });
    const api = async (method, path, body) => {
      const res = await fetch(path, {
        method,
        headers: { Authorization: "Bearer " + tokenBox.value, "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.status);
      return res.json();
    };
    function siteOptions(sel, sites) {
      sel.innerHTML = sites.map((s) => `<option value="${s.id}">${s.slug}</option>`).join("");
    }
    async function refresh() {
      try {
        const [sites, brands, runs] = await Promise.all([
          api("GET", "/api/sites"), api("GET", "/api/brands"), api("GET", "/api/runs?limit=25"),
        ]);
        $("sites").querySelector("tbody").innerHTML = sites.map((s) => `<tr><td>${s.slug}</td><td>${s.adapterType}</td><td>${s.baseUrl || ""}</td></tr>`).join("") || "<tr><td>none</td></tr>";
        $("brands").querySelector("tbody").innerHTML = brands.map((b) => `<tr><td>${b.slug}</td><td>${b.name}</td></tr>`).join("") || "<tr><td>none</td></tr>";
        siteOptions($("run-site"), sites); siteOptions($("topic-site"), sites);
        $("runs").querySelector("tbody").innerHTML = runs.map((r) => `<tr data-id="${r.id}" style="cursor:pointer"><td>${r.jobType}</td><td class="${r.status}">${r.status}</td><td>${new Date(r.startedAt).toLocaleString()}</td></tr>`).join("") || "<tr><td>none</td></tr>";
        $("runs").querySelectorAll("tr[data-id]").forEach((tr) => tr.addEventListener("click", () => showRun(tr.dataset.id)));
      } catch (e) { /* token likely missing/invalid */ }
    }
    async function showRun(id) {
      const d = await api("GET", "/api/runs/" + id);
      $("run-detail").textContent = JSON.stringify(d, null, 2);
    }
    $("run-btn").addEventListener("click", async () => {
      $("run-out").textContent = "running...";
      try { const r = await api("POST", `/api/sites/${$("run-site").value}/run`, { job: $("run-job").value }); $("run-out").textContent = JSON.stringify(r); refresh(); }
      catch (e) { $("run-out").textContent = "error: " + e.message; }
    });
    $("topic-btn").addEventListener("click", async () => {
      $("topic-out").textContent = "...";
      try { await api("POST", `/api/sites/${$("topic-site").value}/topics`, { title: $("topic-title").value, approve: true, priority: 5 }); $("topic-out").textContent = "queued"; $("topic-title").value = ""; }
      catch (e) { $("topic-out").textContent = "error: " + e.message; }
    });
    refresh();
  </script>
</body>
</html>
```

- [ ] **Step 4: Implement `src/api/server.ts`**

```ts
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { DB } from "../db/client.js";
import { createApp } from "./app.js";
import { readBody } from "./json.js";

const HERE = dirname(fileURLToPath(import.meta.url));

export interface StartServerOpts {
  db: DB;
  token: string | undefined;
  port?: number;
  host?: string;
}

export interface StartedServer {
  server: Server;
  port: number;
}

export async function startServer(opts: StartServerOpts): Promise<StartedServer> {
  const app = createApp(opts.db, opts.token);
  const dashboard = await readFile(join(HERE, "dashboard.html"), "utf8");

  const server = createServer(async (req, res) => {
    const url = req.url ?? "/";
    const method = req.method ?? "GET";
    const pathOnly = url.split("?")[0];

    if (method === "GET" && (pathOnly === "/" || pathOnly === "/index.html")) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(dashboard);
      return;
    }

    const bodyText = method === "GET" || method === "HEAD" ? "" : await readBody(req);
    const headers: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(req.headers)) headers[k] = Array.isArray(v) ? v[0] : v;

    const result = await app.handle(method, url, headers, bodyText);
    res.writeHead(result.status, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(result.body));
  });

  const port = await new Promise<number>((resolve) => {
    server.listen(opts.port ?? 8787, opts.host ?? "127.0.0.1", () => {
      const addr = server.address();
      resolve(typeof addr === "object" && addr ? addr.port : (opts.port ?? 8787));
    });
  });

  return { server, port };
}
```

> Note: `dashboard.html` is read at runtime relative to the compiled file's dir. Because the project runs via `tsx` (no build copy step), `import.meta.url` resolves to `src/api/server.ts` and the sibling `dashboard.html` is found. Add a `files`/copy step only if a `tsc` dist build is later used to run the server.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/api-server.test.ts`
Expected: PASS (3 passed).

- [ ] **Step 6: Full suite + typecheck**

Run: `npx vitest run && npx tsc --noEmit -p tsconfig.json`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add src/api/server.ts src/api/dashboard.html tests/api-server.test.ts
git commit -m "feat: node:http server + static dashboard"
```

---

### Task 5: CLI `serve` command + docs

**Files:**
- Modify: `src/cli/index.ts`, `package.json` (add a `serve` script), `README.md`, `.env.example`

- [ ] **Step 1: Add the `serve` command to `src/cli/index.ts`**

Add the import near the other imports:
```ts
import { startServer } from "../api/server.js";
import { env } from "../env.js";
```

Add the command before the final `program.parseAsync();` line:
```ts
program
  .command("serve")
  .description("start the HTTP API + dashboard")
  .option("--port <n>", "port", "8787")
  .option("--host <host>", "host", "127.0.0.1")
  .action(async (o) => {
    if (!env.apiToken) {
      console.error("QCONTENT_API_TOKEN is required to serve the API");
      process.exit(1);
    }
    const { port } = await startServer({ db, token: env.apiToken, port: Number(o.port), host: o.host });
    console.log(`qcontent API + dashboard on http://${o.host}:${port}`);
  });
```

- [ ] **Step 2: Add a `serve` script to `package.json`**

In the `scripts` block add:
```json
    "serve": "tsx src/cli/index.ts serve",
```

- [ ] **Step 3: Typecheck + smoke**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: clean.

Run: `npx tsx src/cli/index.ts --help`
Expected: the command list now includes `serve`.

- [ ] **Step 4: Update `.env.example`**

Add:
```bash
# HTTP API + dashboard (Phase 5). Required to run `qcontent serve`.
QCONTENT_API_TOKEN=
```

- [ ] **Step 5: Update `README.md`**

Add a section after the Phase 4 section and update the Roadmap. Insert:

```markdown
## Phase 5 (done): HTTP API + dashboard

A bearer-authenticated JSON API (built on `node:http`, no web framework) over the existing
service + jobs layer, plus a single static HTML dashboard.

```bash
export QCONTENT_API_TOKEN=$(node -e "console.log(require('crypto').randomBytes(24).toString('hex'))")
npm run serve              # http://127.0.0.1:8787  (dashboard at /, paste the token)
```

Endpoints (all `/api/*` except `/api/health` need `Authorization: Bearer $QCONTENT_API_TOKEN`):
`GET /api/health`, `GET|POST /api/brands`, `GET|POST /api/sites`,
`GET /api/sites/:id/published`, `POST /api/sites/:id/topics`, `POST /api/sites/:id/credentials`,
`POST /api/sites/:id/run` (`{job, ...}`), `GET /api/runs?siteId=&limit=`, `GET /api/runs/:id`.
```

Then change the Roadmap to:
```markdown
## Status
Phases 1–5 complete. The engine generates, publishes (webhook / GitHub-MDX / WordPress / Payload),
maintains (reindex / internal links / refresh), distributes to social, and is operable via CLI,
a DB-driven scheduler, and an HTTP API + dashboard.
```

(Render real backtick fences in the file.)

- [ ] **Step 6: Full suite + typecheck**

Run: `npx vitest run && npx tsc --noEmit -p tsconfig.json`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add src/cli/index.ts package.json README.md .env.example
git commit -m "feat: CLI serve command + Phase 5 docs"
```

---

## Self-Review (against the spec)

**Spec coverage (Phase 5, §10):**
- HTTP API over the existing service layer → Tasks 2 (router), 3 (app), 4 (server). ✓
- Bearer-token auth (`QCONTENT_API_TOKEN`) on all `/api/*` except health → Tasks 1 (env), 3 (auth in `handle`). ✓
- Runs observability surfaced (the scheduler/run history the dashboard reads) → Task 1 (runs read-service), 3 (`/api/runs`, `/api/runs/:id`). ✓
- Single static dashboard: list sites/brands/runs, view run logs, queue topic, trigger job → Task 4 (`dashboard.html`). ✓
- Operable: CLI `serve` → Task 5. ✓

**Placeholder scan:** No TBD/TODO/"add error handling"-style steps; every code step shows full code.

**Type consistency:** `ApiResponse {status, body}` (json.ts) flows through `RouteHandler`, `Router.match`, `createApp().handle`, and `startServer`. `createApp(db, token)` returns `{ handle }`; `startServer({db, token, port?, host?})` returns `{ server, port }` — both match their tests. Service calls use the verified signatures: `listBrands(db)`, `createBrand(db,{name,slug,seedKeywords})`, `listSites(db)`, `createSite(db,{brandId,name,slug,adapterType,baseUrl?,adapterConfig?,contentTypes?})`, `getSite(db,id)`, `addTopic(db,{siteId,title,source,contentType?,status?,priority?})`, `saveCredential(db,{siteId,integration,secret})`, `getPublishedForSite(db,siteId)`, `runJob(db,jobType,{siteId,...})`, `knownJobTypes()`, and the new `listRuns(db,{siteId?,limit?})`/`getRun(db,id)`/`getRunLogs(db,runId)`.

**Decisions captured (from brainstorming):** `node:http` + a tiny hand-rolled router (no web framework dep); static bearer API token (single-operator); one static HTML dashboard (no SPA/build step). All three are reflected in the file structure and tasks.

**Process note (carried from Phase 4 retro):** every task runs the FULL `npx vitest run` AND `npx tsc --noEmit` before committing — not just the new test file — and confirms each `Edit` applied. This is explicit in every task's verification step.
