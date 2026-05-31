# qcontent Phase 1 (MVP Spine) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the standalone `qcontent` engine spine that, for a single configured site, runs discover → generate (LLM) → validate → persist → publish-via-webhook on a DB-driven schedule, with full run history — end-to-end and tested.

**Architecture:** A central TypeScript/Node (ESM) engine with clear seams: pluggable **LLM providers** and **topic sources**, pluggable **publish adapters** (webhook only in Phase 1), a Markdown-canonical `Article` domain model, a Turso/libSQL registry (sites, brands, credentials [encrypted], topics, schedules, runs, run_logs, published_content) accessed through Drizzle, a thin **service** layer shared by the CLI and a future API, and a **scheduler/worker** that dispatches jobs and records runs.

**Tech Stack:** Node 26 + TypeScript (ESM), Drizzle ORM + `@libsql/client`, `zod`, `vitest`, `tsx`, `croner`, `@anthropic-ai/sdk`, `commander` (CLI), `node:crypto` (AES-256-GCM).

**Spec:** `docs/superpowers/specs/2026-05-31-qcontent-multisite-engine-design.md` (Phase 1 in §10).

---

## File Structure (Phase 1)

```
qcontent/
  package.json                      # deps, scripts (build/test/dev/migrate)
  tsconfig.json                     # ESM, strict, NodeNext
  vitest.config.ts                  # test config
  drizzle.config.ts                 # drizzle-kit config
  .env.example                      # documented env vars
  src/
    env.ts                          # typed env access + master key
    db/
      schema.ts                     # all Turso tables (Drizzle)
      client.ts                     # libsql client + drizzle instance
      migrate.ts                    # apply migrations
    config/
      crypto.ts                     # AES-256-GCM encrypt/decrypt
    domain/
      article.ts                    # Article/Visual/Faq types + zod schema
      validators.ts                 # validateArticle()
    service/
      brands.ts                     # brand CRUD
      sites.ts                      # site CRUD
      credentials.ts               # encrypted secret CRUD
      topics.ts                     # topic queue + popQueuedTopic
      runs.ts                       # run + run_logs recorder
      published.ts                  # published_content read/write
    providers/
      llm/
        index.ts                    # LLMProvider interface + registry
        claude.ts                   # Anthropic impl
      topics/
        index.ts                    # TopicSource interface + registry
        dataforseo.ts               # DataForSEO discovery
    generation/
      prompt-builder.ts             # builds the generation prompt
      orchestrator.ts               # the `generate` pipeline
    adapters/
      publish/
        index.ts                    # PublishAdapter interface + registry
        webhook.ts                  # webhook adapter
    scheduler/
      worker.ts                     # poll schedules, dispatch due jobs
    cli/
      index.ts                      # commander CLI entry
  tests/
    crypto.test.ts
    article.test.ts
    db.test.ts
    credentials.test.ts
    topics.test.ts
    llm-claude.test.ts
    dataforseo.test.ts
    prompt-builder.test.ts
    webhook.test.ts
    orchestrator.test.ts
    scheduler.test.ts
    e2e.test.ts
```

**Convention for all tasks:** the worktree root is `/Users/vishalkumar/Downloads/qcontent`. All paths below are relative to it. Tests use a local libSQL file DB (`file::memory:` or a temp file) — no remote Turso needed for tests.

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `src/env.ts`, `tests/sanity.test.ts`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "qcontent",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22" },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "dev": "tsx src/cli/index.ts",
    "cli": "tsx src/cli/index.ts",
    "migrate": "tsx src/db/migrate.ts",
    "worker": "tsx src/scheduler/worker.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit -p tsconfig.json"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.40.0",
    "@libsql/client": "^0.14.0",
    "commander": "^13.0.0",
    "croner": "^9.0.0",
    "dotenv": "^17.0.0",
    "drizzle-orm": "^0.38.0",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "drizzle-kit": "^0.30.0",
    "tsx": "^4.19.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2023"],
    "outDir": "dist",
    "rootDir": ".",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": false,
    "noUncheckedIndexedAccess": true
  },
  "include": ["src/**/*.ts", "tests/**/*.ts"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 20000,
  },
});
```

- [ ] **Step 4: Create `src/env.ts`**

```ts
import "dotenv/config";

function opt(name: string): string | undefined {
  const v = process.env[name];
  return v && v.length > 0 ? v : undefined;
}

export const env = {
  masterKey: opt("QCONTENT_MASTER_KEY"),
  tursoUrl: opt("TURSO_DATABASE_URL") ?? "file:local.db",
  tursoToken: opt("TURSO_AUTH_TOKEN"),
  anthropicKey: opt("ANTHROPIC_API_KEY"),
  dataforseoLogin: opt("DATAFORSEO_LOGIN"),
  dataforseoPassword: opt("DATAFORSEO_PASSWORD"),
};

export function requireMasterKey(): Buffer {
  if (!env.masterKey) throw new Error("QCONTENT_MASTER_KEY is required");
  const buf = Buffer.from(env.masterKey, "base64");
  if (buf.length !== 32) throw new Error("QCONTENT_MASTER_KEY must be base64 of 32 bytes (AES-256)");
  return buf;
}
```

- [ ] **Step 5: Create `tests/sanity.test.ts`**

```ts
import { describe, it, expect } from "vitest";

describe("sanity", () => {
  it("runs", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 6: Install deps and run the sanity test**

Run: `npm install && npm test`
Expected: install succeeds; `sanity.test.ts` PASSES (1 passed).

- [ ] **Step 7: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts src/env.ts tests/sanity.test.ts package-lock.json
git commit -m "chore: scaffold qcontent project (ts, vitest, env)"
```

---

### Task 2: Secrets crypto (AES-256-GCM)

**Files:**
- Create: `src/config/crypto.ts`, `tests/crypto.test.ts`

- [ ] **Step 1: Write the failing test — `tests/crypto.test.ts`**

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { randomBytes } from "node:crypto";
import { encryptSecret, decryptSecret } from "../src/config/crypto.js";

beforeAll(() => {
  process.env.QCONTENT_MASTER_KEY = randomBytes(32).toString("base64");
});

describe("crypto", () => {
  it("round-trips a JSON payload", () => {
    const payload = { apiKey: "sk-test-123", nested: { a: 1 } };
    const blob = encryptSecret(payload);
    expect(blob.ciphertext).toBeTypeOf("string");
    expect(blob.iv).toBeTypeOf("string");
    expect(blob.authTag).toBeTypeOf("string");
    const out = decryptSecret(blob);
    expect(out).toEqual(payload);
  });

  it("fails to decrypt tampered ciphertext", () => {
    const blob = encryptSecret({ x: 1 });
    const tampered = { ...blob, ciphertext: Buffer.from("garbage").toString("base64") };
    expect(() => decryptSecret(tampered)).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/crypto.test.ts`
Expected: FAIL ("Cannot find module ... crypto.js").

- [ ] **Step 3: Implement `src/config/crypto.ts`**

```ts
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { requireMasterKey } from "../env.js";

export interface EncryptedBlob {
  ciphertext: string; // base64
  iv: string; // base64
  authTag: string; // base64
}

export function encryptSecret(payload: unknown): EncryptedBlob {
  const key = requireMasterKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
  };
}

export function decryptSecret<T = unknown>(blob: EncryptedBlob): T {
  const key = requireMasterKey();
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(blob.iv, "base64"));
  decipher.setAuthTag(Buffer.from(blob.authTag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(blob.ciphertext, "base64")),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString("utf8")) as T;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/crypto.test.ts`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add src/config/crypto.ts tests/crypto.test.ts
git commit -m "feat: AES-256-GCM secret encryption"
```

---

### Task 3: Canonical Article model + validation

**Files:**
- Create: `src/domain/article.ts`, `src/domain/validators.ts`, `tests/article.test.ts`

- [ ] **Step 1: Write the failing test — `tests/article.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { ArticleSchema } from "../src/domain/article.js";
import { validateArticle } from "../src/domain/validators.js";

const good = {
  title: "How to Cut Blinkit Ad Waste in 2026",
  slug: "cut-blinkit-ad-waste-2026",
  excerpt: "A short, specific meta description about reducing Blinkit ad waste with concrete steps.",
  category: "Guides",
  tags: ["blinkit", "ad-waste"],
  date: "2026-05-31",
  bodyMarkdown: "Reducing waste starts with dayparting.\n\n## What is ad waste?\n\nSpend with no return. See {{visual:waste-bars}}.",
  tldr: "Cut waste by pausing dark hours and tightening match types; brands save 18-30%.",
  faqs: [
    { question: "What is ad waste?", answer: "Spend that yields no measurable return." },
    { question: "How much can I save?", answer: "Typically 18-30%." },
    { question: "Where to start?", answer: "Dayparting." },
  ],
  takeaways: ["Pause dark hours", "Tighten match types", "Cap CPCs", "Review weekly"],
  relatedSlugs: ["acos", "dayparting"],
  visuals: [{ token: "waste-bars", kind: "svg", code: "<svg/>", alt: "waste chart" }],
  seoHints: { jsonldType: "Article", mentions: ["Blinkit"], speakableSelectors: ["h1", ".tldr-box"] },
};

describe("ArticleSchema", () => {
  it("accepts a valid article", () => {
    expect(() => ArticleSchema.parse(good)).not.toThrow();
  });
  it("rejects an article with too few faqs", () => {
    expect(() => ArticleSchema.parse({ ...good, faqs: [good.faqs[0]] })).toThrow();
  });
});

describe("validateArticle", () => {
  it("flags a visual token in body with no matching visual", () => {
    const bad = { ...good, bodyMarkdown: good.bodyMarkdown + " {{visual:missing}}" };
    const result = validateArticle(ArticleSchema.parse(bad));
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain("missing");
  });
  it("passes a consistent article", () => {
    const result = validateArticle(ArticleSchema.parse(good));
    expect(result.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/article.test.ts`
Expected: FAIL ("Cannot find module ... article.js").

- [ ] **Step 3: Implement `src/domain/article.ts`**

```ts
import { z } from "zod";

export const VisualSchema = z.object({
  token: z.string().min(1),
  kind: z.enum(["svg", "image"]),
  code: z.string().optional(),
  url: z.string().url().optional(),
  alt: z.string().min(1),
});

export const FaqSchema = z.object({
  question: z.string().min(1),
  answer: z.string().min(1),
});

export const ArticleSchema = z.object({
  title: z.string().min(10).max(120),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  excerpt: z.string().min(40).max(200),
  category: z.string().min(1),
  tags: z.array(z.string()).default([]),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  publishDate: z.string().optional(),
  bodyMarkdown: z.string().min(1),
  tldr: z.string().min(1),
  faqs: z.array(FaqSchema).min(3),
  takeaways: z.array(z.string().min(1)).min(3),
  relatedSlugs: z.array(z.string()).default([]),
  visuals: z.array(VisualSchema).default([]),
  seoHints: z.object({
    jsonldType: z.enum(["Article", "HowTo", "DefinedTerm"]),
    mentions: z.array(z.string()).default([]),
    speakableSelectors: z.array(z.string()).default([]),
  }),
});

export type Article = z.infer<typeof ArticleSchema>;
export type Visual = z.infer<typeof VisualSchema>;
export type Faq = z.infer<typeof FaqSchema>;
```

- [ ] **Step 4: Implement `src/domain/validators.ts`**

```ts
import type { Article } from "./article.js";

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

const TOKEN_RE = /\{\{visual:([a-z0-9-]+)\}\}/g;

export function validateArticle(article: Article): ValidationResult {
  const errors: string[] = [];

  // Every visual token referenced in the body must have a matching visual.
  const declared = new Set(article.visuals.map((v) => v.token));
  const referenced = new Set<string>();
  for (const m of article.bodyMarkdown.matchAll(TOKEN_RE)) referenced.add(m[1]!);
  for (const token of referenced) {
    if (!declared.has(token)) errors.push(`body references undeclared visual token: ${token}`);
  }

  // svg visuals must carry code; image visuals must carry url.
  for (const v of article.visuals) {
    if (v.kind === "svg" && !v.code) errors.push(`svg visual ${v.token} missing code`);
    if (v.kind === "image" && !v.url) errors.push(`image visual ${v.token} missing url`);
  }

  return { ok: errors.length === 0, errors };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/article.test.ts`
Expected: PASS (4 passed).

- [ ] **Step 6: Commit**

```bash
git add src/domain/article.ts src/domain/validators.ts tests/article.test.ts
git commit -m "feat: canonical Article model + validation"
```

---

### Task 4: Database schema + client + migrate

**Files:**
- Create: `src/db/schema.ts`, `src/db/client.ts`, `src/db/migrate.ts`, `drizzle.config.ts`, `tests/db.test.ts`

- [ ] **Step 1: Implement `src/db/schema.ts`**

```ts
import { sqliteTable, text, integer, blob } from "drizzle-orm/sqlite-core";

const id = () => text("id").primaryKey();
const now = () => integer("created_at", { mode: "timestamp_ms" }).$defaultFn(() => new Date());

export const brands = sqliteTable("brands", {
  id: id(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  voice: text("voice", { mode: "json" }).$type<Record<string, unknown>>().default({}),
  palette: text("palette", { mode: "json" }).$type<Record<string, unknown>>().default({}),
  fonts: text("fonts", { mode: "json" }).$type<Record<string, unknown>>().default({}),
  assets: text("assets", { mode: "json" }).$type<Record<string, unknown>>().default({}),
  social: text("social", { mode: "json" }).$type<Record<string, unknown>>().default({}),
  hashtags: text("hashtags", { mode: "json" }).$type<string[]>().default([]),
  cta: text("cta", { mode: "json" }).$type<Record<string, unknown>>().default({}),
  seedKeywords: text("seed_keywords", { mode: "json" }).$type<string[]>().default([]),
  createdAt: now(),
});

export const sites = sqliteTable("sites", {
  id: id(),
  brandId: text("brand_id").notNull().references(() => brands.id),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  adapterType: text("adapter_type").notNull(), // 'webhook' | 'github-mdx' | 'wordpress' | 'payload'
  adapterConfig: text("adapter_config", { mode: "json" }).$type<Record<string, unknown>>().default({}),
  baseUrl: text("base_url"),
  contentTypes: text("content_types", { mode: "json" }).$type<Record<string, unknown>>().default({}),
  indexing: text("indexing", { mode: "json" }).$type<Record<string, unknown>>().default({}),
  enabled: integer("enabled").notNull().default(1),
  createdAt: now(),
});

export const credentials = sqliteTable("credentials", {
  id: id(),
  siteId: text("site_id").references(() => sites.id), // nullable = global
  integration: text("integration").notNull(),
  ciphertext: text("ciphertext").notNull(),
  iv: text("iv").notNull(),
  authTag: text("auth_tag").notNull(),
  createdAt: now(),
});

export const topics = sqliteTable("topics", {
  id: id(),
  siteId: text("site_id").notNull().references(() => sites.id),
  title: text("title").notNull(),
  description: text("description"),
  contentType: text("content_type"),
  source: text("source").notNull(), // 'manual' | 'dataforseo' | 'rss'
  status: text("status").notNull().default("pending"), // pending|approved|used|rejected
  priority: integer("priority").notNull().default(0),
  createdAt: now(),
  usedAt: integer("used_at", { mode: "timestamp_ms" }),
});

export const schedules = sqliteTable("schedules", {
  id: id(),
  siteId: text("site_id").notNull().references(() => sites.id),
  jobType: text("job_type").notNull(),
  cron: text("cron").notNull(),
  enabled: integer("enabled").notNull().default(1),
  lastRunAt: integer("last_run_at", { mode: "timestamp_ms" }),
  nextRunAt: integer("next_run_at", { mode: "timestamp_ms" }),
  createdAt: now(),
});

export const runs = sqliteTable("runs", {
  id: id(),
  siteId: text("site_id").references(() => sites.id),
  jobType: text("job_type").notNull(),
  status: text("status").notNull().default("running"), // running|ok|failed
  startedAt: integer("started_at", { mode: "timestamp_ms" }).$defaultFn(() => new Date()),
  finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
  summary: text("summary", { mode: "json" }).$type<Record<string, unknown>>(),
  error: text("error"),
});

export const runLogs = sqliteTable("run_logs", {
  id: id(),
  runId: text("run_id").notNull().references(() => runs.id),
  ts: integer("ts", { mode: "timestamp_ms" }).$defaultFn(() => new Date()),
  level: text("level").notNull().default("info"),
  message: text("message").notNull(),
  data: text("data", { mode: "json" }).$type<Record<string, unknown>>(),
});

export const publishedContent = sqliteTable("published_content", {
  id: id(),
  siteId: text("site_id").notNull().references(() => sites.id),
  slug: text("slug").notNull(),
  url: text("url"),
  contentType: text("content_type"),
  title: text("title"),
  adapterRef: text("adapter_ref", { mode: "json" }).$type<Record<string, unknown>>(),
  contentHash: text("content_hash"),
  socialPosted: integer("social_posted").notNull().default(0),
  publishedAt: integer("published_at", { mode: "timestamp_ms" }).$defaultFn(() => new Date()),
});
```

- [ ] **Step 2: Implement `src/db/client.ts`**

```ts
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { env } from "../env.js";
import * as schema from "./schema.js";

export function makeDb(url = env.tursoUrl, authToken = env.tursoToken) {
  const client = createClient({ url, authToken });
  return drizzle(client, { schema });
}

export const db = makeDb();
export type DB = ReturnType<typeof makeDb>;
```

- [ ] **Step 3: Implement `src/db/migrate.ts` (raw DDL — no external migration files needed for Phase 1)**

```ts
import { createClient } from "@libsql/client";
import { env } from "../env.js";

const DDL = `
CREATE TABLE IF NOT EXISTS brands (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE,
  voice TEXT DEFAULT '{}', palette TEXT DEFAULT '{}', fonts TEXT DEFAULT '{}',
  assets TEXT DEFAULT '{}', social TEXT DEFAULT '{}', hashtags TEXT DEFAULT '[]',
  cta TEXT DEFAULT '{}', seed_keywords TEXT DEFAULT '[]', created_at INTEGER
);
CREATE TABLE IF NOT EXISTS sites (
  id TEXT PRIMARY KEY, brand_id TEXT NOT NULL REFERENCES brands(id), name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE, adapter_type TEXT NOT NULL, adapter_config TEXT DEFAULT '{}',
  base_url TEXT, content_types TEXT DEFAULT '{}', indexing TEXT DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1, created_at INTEGER
);
CREATE TABLE IF NOT EXISTS credentials (
  id TEXT PRIMARY KEY, site_id TEXT REFERENCES sites(id), integration TEXT NOT NULL,
  ciphertext TEXT NOT NULL, iv TEXT NOT NULL, auth_tag TEXT NOT NULL, created_at INTEGER
);
CREATE TABLE IF NOT EXISTS topics (
  id TEXT PRIMARY KEY, site_id TEXT NOT NULL REFERENCES sites(id), title TEXT NOT NULL,
  description TEXT, content_type TEXT, source TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
  priority INTEGER NOT NULL DEFAULT 0, created_at INTEGER, used_at INTEGER
);
CREATE TABLE IF NOT EXISTS schedules (
  id TEXT PRIMARY KEY, site_id TEXT NOT NULL REFERENCES sites(id), job_type TEXT NOT NULL,
  cron TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, last_run_at INTEGER,
  next_run_at INTEGER, created_at INTEGER
);
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY, site_id TEXT REFERENCES sites(id), job_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running', started_at INTEGER, finished_at INTEGER,
  summary TEXT, error TEXT
);
CREATE TABLE IF NOT EXISTS run_logs (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id), ts INTEGER,
  level TEXT NOT NULL DEFAULT 'info', message TEXT NOT NULL, data TEXT
);
CREATE TABLE IF NOT EXISTS published_content (
  id TEXT PRIMARY KEY, site_id TEXT NOT NULL REFERENCES sites(id), slug TEXT NOT NULL,
  url TEXT, content_type TEXT, title TEXT, adapter_ref TEXT, content_hash TEXT,
  social_posted INTEGER NOT NULL DEFAULT 0, published_at INTEGER
);
`;

export async function runMigrations(url = env.tursoUrl, authToken = env.tursoToken): Promise<void> {
  const client = createClient({ url, authToken });
  for (const stmt of DDL.split(";").map((s) => s.trim()).filter(Boolean)) {
    await client.execute(stmt);
  }
  client.close();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runMigrations().then(() => {
    console.log("migrations applied");
    process.exit(0);
  });
}
```

- [ ] **Step 4: Implement `drizzle.config.ts`**

```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "turso",
  dbCredentials: {
    url: process.env.TURSO_DATABASE_URL ?? "file:local.db",
    authToken: process.env.TURSO_AUTH_TOKEN,
  },
});
```

- [ ] **Step 5: Write the test — `tests/db.test.ts`**

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { randomUUID, randomBytes } from "node:crypto";
import { runMigrations } from "../src/db/migrate.js";
import { makeDb } from "../src/db/client.js";
import { brands } from "../src/db/schema.js";
import { eq } from "drizzle-orm";

const URL = "file::memory:?cache=shared";

beforeAll(async () => {
  process.env.QCONTENT_MASTER_KEY = randomBytes(32).toString("base64");
  await runMigrations(URL);
});

describe("db", () => {
  it("inserts and reads a brand", async () => {
    const db = makeDb(URL);
    const bid = randomUUID();
    await db.insert(brands).values({ id: bid, name: "Ladya", slug: "ladya" });
    const rows = await db.select().from(brands).where(eq(brands.id, bid));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.slug).toBe("ladya");
  });
});
```

> Note: `file::memory:?cache=shared` keeps one shared in-memory DB for the test process so
> `runMigrations` and `makeDb` see the same tables.

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/db.test.ts`
Expected: PASS (1 passed).

- [ ] **Step 7: Commit**

```bash
git add src/db/schema.ts src/db/client.ts src/db/migrate.ts drizzle.config.ts tests/db.test.ts
git commit -m "feat: Turso schema, client, and migrations"
```

---

### Task 5: Credentials service (encrypt-on-write, decrypt-on-read)

**Files:**
- Create: `src/service/credentials.ts`, `tests/credentials.test.ts`

- [ ] **Step 1: Write the failing test — `tests/credentials.test.ts`**

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { randomUUID, randomBytes } from "node:crypto";
import { runMigrations } from "../src/db/migrate.js";
import { makeDb } from "../src/db/client.js";
import { brands, sites } from "../src/db/schema.js";
import { saveCredential, getCredential } from "../src/service/credentials.js";

const URL = "file::memory:?cache=shared";
let siteId: string;

beforeAll(async () => {
  process.env.QCONTENT_MASTER_KEY = randomBytes(32).toString("base64");
  await runMigrations(URL);
  const db = makeDb(URL);
  const bid = randomUUID();
  siteId = randomUUID();
  await db.insert(brands).values({ id: bid, name: "B", slug: "b-creds" });
  await db.insert(sites).values({ id: siteId, brandId: bid, name: "S", slug: "s-creds", adapterType: "webhook" });
});

describe("credentials service", () => {
  it("stores encrypted and returns decrypted", async () => {
    const db = makeDb(URL);
    await saveCredential(db, { siteId, integration: "webhook", secret: { url: "https://x", token: "t" } });
    const got = await getCredential<{ url: string; token: string }>(db, siteId, "webhook");
    expect(got).toEqual({ url: "https://x", token: "t" });
  });

  it("returns null when missing", async () => {
    const db = makeDb(URL);
    const got = await getCredential(db, siteId, "nope");
    expect(got).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/credentials.test.ts`
Expected: FAIL ("Cannot find module ... credentials.js").

- [ ] **Step 3: Implement `src/service/credentials.ts`**

```ts
import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { credentials } from "../db/schema.js";
import { encryptSecret, decryptSecret } from "../config/crypto.js";

export async function saveCredential(
  db: DB,
  args: { siteId?: string | null; integration: string; secret: unknown },
): Promise<void> {
  const blob = encryptSecret(args.secret);
  await db.insert(credentials).values({
    id: randomUUID(),
    siteId: args.siteId ?? null,
    integration: args.integration,
    ciphertext: blob.ciphertext,
    iv: blob.iv,
    authTag: blob.authTag,
  });
}

export async function getCredential<T = unknown>(
  db: DB,
  siteId: string | null,
  integration: string,
): Promise<T | null> {
  const where = siteId
    ? and(eq(credentials.siteId, siteId), eq(credentials.integration, integration))
    : and(isNull(credentials.siteId), eq(credentials.integration, integration));
  const rows = await db.select().from(credentials).where(where).limit(1);
  const row = rows[0];
  if (!row) return null;
  return decryptSecret<T>({ ciphertext: row.ciphertext, iv: row.iv, authTag: row.authTag });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/credentials.test.ts`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add src/service/credentials.ts tests/credentials.test.ts
git commit -m "feat: credentials service with at-rest encryption"
```

---

### Task 6: Brands & sites service

**Files:**
- Create: `src/service/brands.ts`, `src/service/sites.ts` (no new test file — exercised via Task 7/12 tests and a quick assertion here)
- Test: `tests/topics.test.ts` (created in Task 7) will rely on these; add a focused test in `tests/db.test.ts`? No — create `tests/services.test.ts`.
- Create: `tests/services.test.ts`

- [ ] **Step 1: Write the failing test — `tests/services.test.ts`**

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { randomBytes } from "node:crypto";
import { runMigrations } from "../src/db/migrate.js";
import { makeDb } from "../src/db/client.js";
import { createBrand } from "../src/service/brands.js";
import { createSite, getSite, getSiteBySlug } from "../src/service/sites.js";

const URL = "file::memory:?cache=shared";
beforeAll(async () => {
  process.env.QCONTENT_MASTER_KEY = randomBytes(32).toString("base64");
  await runMigrations(URL);
});

describe("brands & sites services", () => {
  it("creates a brand and a site and fetches the site", async () => {
    const db = makeDb(URL);
    const brand = await createBrand(db, { name: "Ladya", slug: "ladya-svc", seedKeywords: ["blinkit ads"] });
    const site = await createSite(db, {
      brandId: brand.id, name: "Ladya Site", slug: "ladya-site-svc",
      adapterType: "webhook", baseUrl: "https://ladya.in",
      contentTypes: { guides: { minWords: 1000 } },
    });
    expect(await getSite(db, site.id)).toMatchObject({ slug: "ladya-site-svc" });
    expect(await getSiteBySlug(db, "ladya-site-svc")).toMatchObject({ id: site.id });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/services.test.ts`
Expected: FAIL ("Cannot find module ... brands.js").

- [ ] **Step 3: Implement `src/service/brands.ts`**

```ts
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { brands } from "../db/schema.js";

export type Brand = typeof brands.$inferSelect;

export async function createBrand(
  db: DB,
  args: { name: string; slug: string } & Partial<Omit<Brand, "id" | "name" | "slug" | "createdAt">>,
): Promise<Brand> {
  const id = randomUUID();
  await db.insert(brands).values({ id, ...args });
  const rows = await db.select().from(brands).where(eq(brands.id, id));
  return rows[0]!;
}

export async function getBrand(db: DB, id: string): Promise<Brand | null> {
  const rows = await db.select().from(brands).where(eq(brands.id, id)).limit(1);
  return rows[0] ?? null;
}
```

- [ ] **Step 4: Implement `src/service/sites.ts`**

```ts
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { sites } from "../db/schema.js";

export type Site = typeof sites.$inferSelect;

export async function createSite(
  db: DB,
  args: { brandId: string; name: string; slug: string; adapterType: string } & Partial<
    Omit<Site, "id" | "brandId" | "name" | "slug" | "adapterType" | "createdAt">
  >,
): Promise<Site> {
  const id = randomUUID();
  await db.insert(sites).values({ id, ...args });
  return (await db.select().from(sites).where(eq(sites.id, id)))[0]!;
}

export async function getSite(db: DB, id: string): Promise<Site | null> {
  const rows = await db.select().from(sites).where(eq(sites.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function getSiteBySlug(db: DB, slug: string): Promise<Site | null> {
  const rows = await db.select().from(sites).where(eq(sites.slug, slug)).limit(1);
  return rows[0] ?? null;
}

export async function listSites(db: DB): Promise<Site[]> {
  return db.select().from(sites);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/services.test.ts`
Expected: PASS (1 passed).

- [ ] **Step 6: Commit**

```bash
git add src/service/brands.ts src/service/sites.ts tests/services.test.ts
git commit -m "feat: brands & sites services"
```

---

### Task 7: Topics service (queue + popQueuedTopic)

**Files:**
- Create: `src/service/topics.ts`, `tests/topics.test.ts`

- [ ] **Step 1: Write the failing test — `tests/topics.test.ts`**

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { randomUUID, randomBytes } from "node:crypto";
import { runMigrations } from "../src/db/migrate.js";
import { makeDb } from "../src/db/client.js";
import { brands, sites } from "../src/db/schema.js";
import { addTopic, popQueuedTopic } from "../src/service/topics.js";

const URL = "file::memory:?cache=shared";
let siteId: string;

beforeAll(async () => {
  process.env.QCONTENT_MASTER_KEY = randomBytes(32).toString("base64");
  await runMigrations(URL);
  const db = makeDb(URL);
  const bid = randomUUID();
  siteId = randomUUID();
  await db.insert(brands).values({ id: bid, name: "B", slug: "b-topics" });
  await db.insert(sites).values({ id: siteId, brandId: bid, name: "S", slug: "s-topics", adapterType: "webhook" });
});

describe("topics service", () => {
  it("pops the highest-priority approved topic and marks it used", async () => {
    const db = makeDb(URL);
    await addTopic(db, { siteId, title: "low", source: "manual", status: "approved", priority: 1 });
    await addTopic(db, { siteId, title: "high", source: "manual", status: "approved", priority: 5 });
    await addTopic(db, { siteId, title: "pending", source: "manual", status: "pending", priority: 9 });

    const t1 = await popQueuedTopic(db, siteId);
    expect(t1?.title).toBe("high");
    const t2 = await popQueuedTopic(db, siteId);
    expect(t2?.title).toBe("low");
    const t3 = await popQueuedTopic(db, siteId);
    expect(t3).toBeNull(); // 'pending' is not eligible
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/topics.test.ts`
Expected: FAIL ("Cannot find module ... topics.js").

- [ ] **Step 3: Implement `src/service/topics.ts`**

```ts
import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { topics } from "../db/schema.js";

export type Topic = typeof topics.$inferSelect;

export async function addTopic(
  db: DB,
  args: { siteId: string; title: string; source: string } & Partial<
    Pick<Topic, "description" | "contentType" | "status" | "priority">
  >,
): Promise<Topic> {
  const id = randomUUID();
  await db.insert(topics).values({ id, ...args });
  return (await db.select().from(topics).where(eq(topics.id, id)))[0]!;
}

/** Pops the highest-priority 'approved' topic for a site, marking it 'used'. */
export async function popQueuedTopic(db: DB, siteId: string): Promise<Topic | null> {
  const rows = await db
    .select()
    .from(topics)
    .where(and(eq(topics.siteId, siteId), eq(topics.status, "approved")))
    .orderBy(desc(topics.priority))
    .limit(1);
  const topic = rows[0];
  if (!topic) return null;
  await db.update(topics).set({ status: "used", usedAt: new Date() }).where(eq(topics.id, topic.id));
  return topic;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/topics.test.ts`
Expected: PASS (1 passed).

- [ ] **Step 5: Commit**

```bash
git add src/service/topics.ts tests/topics.test.ts
git commit -m "feat: topics queue service"
```

---

### Task 8: Runs service (run recorder) + published_content service

**Files:**
- Create: `src/service/runs.ts`, `src/service/published.ts`, `tests/runs.test.ts`

- [ ] **Step 1: Write the failing test — `tests/runs.test.ts`**

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { randomUUID, randomBytes } from "node:crypto";
import { runMigrations } from "../src/db/migrate.js";
import { makeDb } from "../src/db/client.js";
import { brands, sites, runLogs } from "../src/db/schema.js";
import { startRun } from "../src/service/runs.js";
import { recordPublished, slugExists } from "../src/service/published.js";
import { eq } from "drizzle-orm";

const URL = "file::memory:?cache=shared";
let siteId: string;
beforeAll(async () => {
  process.env.QCONTENT_MASTER_KEY = randomBytes(32).toString("base64");
  await runMigrations(URL);
  const db = makeDb(URL);
  const bid = randomUUID();
  siteId = randomUUID();
  await db.insert(brands).values({ id: bid, name: "B", slug: "b-runs" });
  await db.insert(sites).values({ id: siteId, brandId: bid, name: "S", slug: "s-runs", adapterType: "webhook" });
});

describe("runs + published", () => {
  it("records a run with logs and finishes ok", async () => {
    const db = makeDb(URL);
    const run = await startRun(db, { siteId, jobType: "generate" });
    await run.log("info", "started", { foo: 1 });
    await run.finishOk({ slug: "x" });
    const logs = await db.select().from(runLogs).where(eq(runLogs.runId, run.id));
    expect(logs.length).toBeGreaterThanOrEqual(1);
  });

  it("records published content and detects existing slug", async () => {
    const db = makeDb(URL);
    expect(await slugExists(db, siteId, "my-post")).toBe(false);
    await recordPublished(db, { siteId, slug: "my-post", url: "https://x/my-post", title: "My Post" });
    expect(await slugExists(db, siteId, "my-post")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/runs.test.ts`
Expected: FAIL ("Cannot find module ... runs.js").

- [ ] **Step 3: Implement `src/service/runs.ts`**

```ts
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { runs, runLogs } from "../db/schema.js";

export interface RunHandle {
  id: string;
  log(level: "info" | "warn" | "error", message: string, data?: Record<string, unknown>): Promise<void>;
  finishOk(summary?: Record<string, unknown>): Promise<void>;
  finishFailed(error: string, summary?: Record<string, unknown>): Promise<void>;
}

export async function startRun(
  db: DB,
  args: { siteId?: string | null; jobType: string },
): Promise<RunHandle> {
  const id = randomUUID();
  await db.insert(runs).values({ id, siteId: args.siteId ?? null, jobType: args.jobType, status: "running" });
  return {
    id,
    async log(level, message, data) {
      await db.insert(runLogs).values({ id: randomUUID(), runId: id, level, message, data });
    },
    async finishOk(summary) {
      await db.update(runs).set({ status: "ok", finishedAt: new Date(), summary }).where(eq(runs.id, id));
    },
    async finishFailed(error, summary) {
      await db.update(runs).set({ status: "failed", finishedAt: new Date(), error, summary }).where(eq(runs.id, id));
    },
  };
}
```

- [ ] **Step 4: Implement `src/service/published.ts`**

```ts
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { publishedContent } from "../db/schema.js";

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
    adapterRef?: Record<string, unknown>; contentHash?: string;
  },
): Promise<void> {
  await db.insert(publishedContent).values({ id: randomUUID(), ...args });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/runs.test.ts`
Expected: PASS (2 passed).

- [ ] **Step 6: Commit**

```bash
git add src/service/runs.ts src/service/published.ts tests/runs.test.ts
git commit -m "feat: run recorder + published_content services"
```

---

### Task 9: LLM provider interface + Claude implementation

**Files:**
- Create: `src/providers/llm/index.ts`, `src/providers/llm/claude.ts`, `tests/llm-claude.test.ts`

- [ ] **Step 1: Write the failing test — `tests/llm-claude.test.ts`** (mocks the Anthropic SDK)

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";

const createMock = vi.fn();
vi.mock("@anthropic-ai/sdk", () => {
  return {
    default: class {
      messages = { create: createMock };
    },
  };
});

import { ClaudeProvider } from "../src/providers/llm/claude.js";

beforeEach(() => {
  createMock.mockReset();
  process.env.ANTHROPIC_API_KEY = "sk-test";
});

describe("ClaudeProvider", () => {
  it("parses a valid JSON response against a schema", async () => {
    createMock.mockResolvedValue({ content: [{ type: "text", text: '{"slug":"abc","n":3}' }] });
    const provider = new ClaudeProvider();
    const schema = z.object({ slug: z.string(), n: z.number() });
    const out = await provider.generateJson({ prompt: "make json", schema });
    expect(out).toEqual({ slug: "abc", n: 3 });
  });

  it("retries on malformed JSON then succeeds", async () => {
    createMock
      .mockResolvedValueOnce({ content: [{ type: "text", text: "not json" }] })
      .mockResolvedValueOnce({ content: [{ type: "text", text: '```json\n{"slug":"ok","n":1}\n```' }] });
    const provider = new ClaudeProvider();
    const schema = z.object({ slug: z.string(), n: z.number() });
    const out = await provider.generateJson({ prompt: "x", schema, maxRetries: 2 });
    expect(out.slug).toBe("ok");
    expect(createMock).toHaveBeenCalledTimes(2);
  });

  it("throws after exhausting retries", async () => {
    createMock.mockResolvedValue({ content: [{ type: "text", text: "still not json" }] });
    const provider = new ClaudeProvider();
    const schema = z.object({ slug: z.string() });
    await expect(provider.generateJson({ prompt: "x", schema, maxRetries: 2 })).rejects.toThrow();
    expect(createMock).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/llm-claude.test.ts`
Expected: FAIL ("Cannot find module ... claude.js").

- [ ] **Step 3: Implement `src/providers/llm/index.ts`**

```ts
import type { ZodSchema } from "zod";

export interface GenerateJsonOpts<T> {
  prompt: string;
  schema: ZodSchema<T>;
  model?: string;
  maxRetries?: number;
  system?: string;
}

export interface LLMProvider {
  readonly name: string;
  generateJson<T>(opts: GenerateJsonOpts<T>): Promise<T>;
}

const registry = new Map<string, () => LLMProvider>();

export function registerLLMProvider(name: string, factory: () => LLMProvider): void {
  registry.set(name, factory);
}

export function getLLMProvider(name: string): LLMProvider {
  const factory = registry.get(name);
  if (!factory) throw new Error(`unknown LLM provider: ${name}`);
  return factory();
}

/** Strips ```json fences and parses. Throws if not valid JSON. */
export function parseJsonLoose(text: string): unknown {
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1]!.trim();
  return JSON.parse(t);
}
```

- [ ] **Step 4: Implement `src/providers/llm/claude.ts`**

```ts
import Anthropic from "@anthropic-ai/sdk";
import type { GenerateJsonOpts, LLMProvider } from "./index.js";
import { parseJsonLoose, registerLLMProvider } from "./index.js";
import { env } from "../../env.js";

export class ClaudeProvider implements LLMProvider {
  readonly name = "claude";
  private client: Anthropic;
  private defaultModel: string;

  constructor(model = "claude-sonnet-4-6") {
    this.client = new Anthropic({ apiKey: env.anthropicKey ?? "" });
    this.defaultModel = model;
  }

  async generateJson<T>(opts: GenerateJsonOpts<T>): Promise<T> {
    const maxRetries = opts.maxRetries ?? 3;
    let lastErr: unknown;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const res = await this.client.messages.create({
          model: opts.model ?? this.defaultModel,
          max_tokens: 8000,
          system: opts.system ?? "You output only valid JSON matching the requested schema. No prose.",
          messages: [{ role: "user", content: opts.prompt }],
        });
        const block = (res.content ?? []).find((b: { type: string }) => b.type === "text") as
          | { type: "text"; text: string }
          | undefined;
        if (!block) throw new Error("no text block in response");
        const parsed = parseJsonLoose(block.text);
        return opts.schema.parse(parsed);
      } catch (err) {
        lastErr = err;
        if (attempt < maxRetries) await sleep(500 * attempt);
      }
    }
    throw new Error(`ClaudeProvider.generateJson failed after ${maxRetries} attempts: ${String(lastErr)}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

registerLLMProvider("claude", () => new ClaudeProvider());
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/llm-claude.test.ts`
Expected: PASS (3 passed).

- [ ] **Step 6: Commit**

```bash
git add src/providers/llm/index.ts src/providers/llm/claude.ts tests/llm-claude.test.ts
git commit -m "feat: LLM provider interface + Claude (JSON mode, retries)"
```

---

### Task 10: DataForSEO topic source

**Files:**
- Create: `src/providers/topics/index.ts`, `src/providers/topics/dataforseo.ts`, `tests/dataforseo.test.ts`

- [ ] **Step 1: Write the failing test — `tests/dataforseo.test.ts`** (mocks `fetch`)

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { DataForSeoSource } from "../src/providers/topics/dataforseo.js";

beforeEach(() => {
  process.env.DATAFORSEO_LOGIN = "u";
  process.env.DATAFORSEO_PASSWORD = "p";
});

describe("DataForSeoSource", () => {
  it("returns a PAA question from the SERP response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        tasks: [{ result: [{ items: [
          { type: "people_also_ask", title: "How to reduce Blinkit ad waste?" },
        ] }] }],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const src = new DataForSeoSource(() => "blinkit ads", () => 0.0); // force PAA branch
    const out = await src.discover(
      { id: "s", brandId: "b", name: "S", slug: "s", adapterType: "webhook" } as never,
      { id: "b", name: "B", slug: "b", seedKeywords: ["blinkit ads"] } as never,
    );
    expect(out.topic).toContain("Blinkit");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/dataforseo.test.ts`
Expected: FAIL ("Cannot find module ... dataforseo.js").

- [ ] **Step 3: Implement `src/providers/topics/index.ts`**

```ts
import type { Brand } from "../../service/brands.js";
import type { Site } from "../../service/sites.js";

export interface DiscoveredTopic {
  topic: string;
  contentType?: string;
}

export interface TopicSource {
  readonly name: string;
  discover(site: Site, brand: Brand): Promise<DiscoveredTopic>;
}

const registry = new Map<string, () => TopicSource>();
export function registerTopicSource(name: string, factory: () => TopicSource): void {
  registry.set(name, factory);
}
export function getTopicSource(name: string): TopicSource {
  const factory = registry.get(name);
  if (!factory) throw new Error(`unknown topic source: ${name}`);
  return factory();
}
```

- [ ] **Step 4: Implement `src/providers/topics/dataforseo.ts`**

```ts
import type { Brand } from "../../service/brands.js";
import type { Site } from "../../service/sites.js";
import type { DiscoveredTopic, TopicSource } from "./index.js";
import { registerTopicSource } from "./index.js";
import { env } from "../../env.js";

const BASE = "https://api.dataforseo.com/v3";

export class DataForSeoSource implements TopicSource {
  readonly name = "dataforseo";
  constructor(
    private pickSeed: (seeds: string[]) => string = (s) => s[Math.floor(Math.random() * s.length)] ?? "",
    private rng: () => number = Math.random,
  ) {}

  private auth(): string {
    return "Basic " + Buffer.from(`${env.dataforseoLogin}:${env.dataforseoPassword}`).toString("base64");
  }

  async discover(_site: Site, brand: Brand): Promise<DiscoveredTopic> {
    const seeds = (brand.seedKeywords as string[] | null) ?? [];
    const seed = typeof this.pickSeed === "function" ? this.pickSeed(seeds) : seeds[0] ?? "";
    if (!seed) throw new Error("no seed keywords on brand");

    if (this.rng() < 0.75) {
      const paa = await this.fetchPaa(seed);
      if (paa.length) return { topic: paa[Math.floor(this.rng() * paa.length)]! };
    }
    const kws = await this.fetchKeywords(seed);
    if (kws.length) return { topic: kws[Math.floor(this.rng() * kws.length)]! };
    return { topic: seed };
  }

  private async fetchPaa(seed: string): Promise<string[]> {
    const res = await fetch(`${BASE}/serp/google/organic/live/advanced`, {
      method: "POST",
      headers: { Authorization: this.auth(), "Content-Type": "application/json" },
      body: JSON.stringify([{ keyword: seed, location_code: 2356, language_code: "en", depth: 10 }]),
    });
    if (!res.ok) throw new Error(`dataforseo serp ${res.status}`);
    const json = (await res.json()) as DfsResponse;
    const items = json.tasks?.[0]?.result?.[0]?.items ?? [];
    return items.filter((i) => i.type === "people_also_ask" && i.title).map((i) => i.title!);
  }

  private async fetchKeywords(seed: string): Promise<string[]> {
    const res = await fetch(`${BASE}/dataforseo_labs/google/keyword_suggestions/live`, {
      method: "POST",
      headers: { Authorization: this.auth(), "Content-Type": "application/json" },
      body: JSON.stringify([{ keyword: seed, location_code: 2356, language_code: "en", limit: 20 }]),
    });
    if (!res.ok) throw new Error(`dataforseo kw ${res.status}`);
    const json = (await res.json()) as DfsResponse;
    const items = json.tasks?.[0]?.result?.[0]?.items ?? [];
    return items.map((i) => i.keyword).filter((k): k is string => !!k);
  }
}

interface DfsItem { type?: string; title?: string; keyword?: string; }
interface DfsResponse { tasks?: Array<{ result?: Array<{ items?: DfsItem[] }> }>; }

registerTopicSource("dataforseo", () => new DataForSeoSource());
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/dataforseo.test.ts`
Expected: PASS (1 passed).

- [ ] **Step 6: Commit**

```bash
git add src/providers/topics/index.ts src/providers/topics/dataforseo.ts tests/dataforseo.test.ts
git commit -m "feat: topic source interface + DataForSEO discovery"
```

---

### Task 11: Prompt builder

**Files:**
- Create: `src/generation/prompt-builder.ts`, `tests/prompt-builder.test.ts`

- [ ] **Step 1: Write the failing test — `tests/prompt-builder.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { buildGenerationPrompt } from "../src/generation/prompt-builder.js";

describe("buildGenerationPrompt", () => {
  it("embeds topic, content type, brand voice, and dedupe slugs", () => {
    const prompt = buildGenerationPrompt({
      topic: "How to reduce Blinkit ad waste?",
      contentType: "guides",
      brand: { name: "Ladya", voice: { tone: "punchy, data-led" }, seedKeywords: ["blinkit ads"] } as never,
      existingSlugs: ["acos", "dayparting"],
      contentRule: { minWords: 1000, style: "how-to with INR benchmarks" },
    });
    expect(prompt).toContain("How to reduce Blinkit ad waste?");
    expect(prompt).toContain("guides");
    expect(prompt).toContain("punchy, data-led");
    expect(prompt).toContain("acos");
    expect(prompt).toContain("{{visual:");
    expect(prompt).toContain("JSON");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/prompt-builder.test.ts`
Expected: FAIL ("Cannot find module ... prompt-builder.js").

- [ ] **Step 3: Implement `src/generation/prompt-builder.ts`**

```ts
import type { Brand } from "../service/brands.js";

export interface PromptArgs {
  topic: string;
  contentType: string;
  brand: Brand;
  existingSlugs: string[];
  contentRule?: Record<string, unknown>;
}

export function buildGenerationPrompt(args: PromptArgs): string {
  const voice = JSON.stringify(args.brand.voice ?? {});
  const rule = JSON.stringify(args.contentRule ?? {});
  const seeds = ((args.brand.seedKeywords as string[] | null) ?? []).join(", ");
  return `You are a senior content writer for the brand "${args.brand.name}".
Brand voice (JSON): ${voice}
Topic seeds: ${seeds}

Write one ${args.contentType} article about: "${args.topic}".
Content rules (JSON): ${rule}

GEO writing rules:
- The FIRST paragraph must directly answer the query in 2-3 data-rich sentences (citation-worthy).
- Every H2 must read as a natural-language search query.
- Include at least 3 specific, citable data points.
- Reference relevant real entities and metrics.
- Embed 1-2 data-visualization placeholders inline using the token form {{visual:some-token}};
  declare a matching entry in the "visuals" array with kind "svg" and complete <svg>...</svg> code.

Do NOT reuse any of these existing slugs: ${args.existingSlugs.join(", ") || "(none)"}.

Return ONLY a JSON object with EXACTLY these keys:
{
  "title": string (50-65 chars),
  "slug": string (kebab-case, unique),
  "excerpt": string (120-155 chars),
  "category": string,
  "tags": string[],
  "date": "YYYY-MM-DD",
  "bodyMarkdown": string (portable Markdown, no frontmatter, includes {{visual:...}} tokens),
  "tldr": string,
  "faqs": [{ "question": string, "answer": string }]  (at least 3),
  "takeaways": string[]  (4-6 items),
  "relatedSlugs": string[],
  "visuals": [{ "token": string, "kind": "svg", "code": string (full <svg>...</svg>), "alt": string }],
  "seoHints": { "jsonldType": "Article"|"HowTo"|"DefinedTerm", "mentions": string[], "speakableSelectors": string[] }
}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/prompt-builder.test.ts`
Expected: PASS (1 passed).

- [ ] **Step 5: Commit**

```bash
git add src/generation/prompt-builder.ts tests/prompt-builder.test.ts
git commit -m "feat: generation prompt builder"
```

---

### Task 12: Webhook publish adapter

**Files:**
- Create: `src/adapters/publish/index.ts`, `src/adapters/publish/webhook.ts`, `tests/webhook.test.ts`

- [ ] **Step 1: Write the failing test — `tests/webhook.test.ts`** (mocks `fetch`)

```ts
import { describe, it, expect, vi } from "vitest";
import { WebhookAdapter } from "../src/adapters/publish/webhook.js";
import { ArticleSchema } from "../src/domain/article.js";

const article = ArticleSchema.parse({
  title: "How to Cut Blinkit Ad Waste in 2026",
  slug: "cut-waste",
  excerpt: "A short, specific meta description about reducing Blinkit ad waste with steps and data.",
  category: "Guides", tags: [], date: "2026-05-31",
  bodyMarkdown: "Lead.\n\n## What?\n\nBody.",
  tldr: "Cut waste.", faqs: [
    { question: "a", answer: "b" }, { question: "c", answer: "d" }, { question: "e", answer: "f" },
  ],
  takeaways: ["x", "y", "z"], relatedSlugs: [], visuals: [],
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/webhook.test.ts`
Expected: FAIL ("Cannot find module ... webhook.js").

- [ ] **Step 3: Implement `src/adapters/publish/index.ts`**

```ts
import type { Article } from "../../domain/article.js";
import type { Site } from "../../service/sites.js";

export interface PublishResult {
  url: string;
  ref: unknown;
}

export interface PublishAdapter {
  readonly type: string;
  publish(article: Article, site: Site, creds: Record<string, unknown>): Promise<PublishResult>;
}

const registry = new Map<string, () => PublishAdapter>();
export function registerPublishAdapter(type: string, factory: () => PublishAdapter): void {
  registry.set(type, factory);
}
export function getPublishAdapter(type: string): PublishAdapter {
  const factory = registry.get(type);
  if (!factory) throw new Error(`unknown publish adapter: ${type}`);
  return factory();
}
```

- [ ] **Step 4: Implement `src/adapters/publish/webhook.ts`**

```ts
import type { Article } from "../../domain/article.js";
import type { Site } from "../../service/sites.js";
import type { PublishAdapter, PublishResult } from "./index.js";
import { registerPublishAdapter } from "./index.js";

export class WebhookAdapter implements PublishAdapter {
  readonly type = "webhook";

  async publish(article: Article, site: Site, creds: Record<string, unknown>): Promise<PublishResult> {
    const endpoint = (creds.url as string | undefined) ?? (site.adapterConfig?.url as string | undefined);
    if (!endpoint) throw new Error("webhook adapter: missing 'url' in credentials or adapterConfig");

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (creds.token) headers.Authorization = `Bearer ${creds.token as string}`;

    const res = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({ site: { id: site.id, baseUrl: site.baseUrl }, article }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`webhook publish failed: ${res.status} ${body}`);
    }
    const ref = await res.json().catch(() => ({}));
    const url = site.baseUrl ? `${site.baseUrl.replace(/\/$/, "")}/${article.slug}` : article.slug;
    return { url, ref };
  }
}

registerPublishAdapter("webhook", () => new WebhookAdapter());
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/webhook.test.ts`
Expected: PASS (2 passed).

- [ ] **Step 6: Commit**

```bash
git add src/adapters/publish/index.ts src/adapters/publish/webhook.ts tests/webhook.test.ts
git commit -m "feat: webhook publish adapter"
```

---

### Task 13: Generation orchestrator (the `generate` job)

**Files:**
- Create: `src/generation/orchestrator.ts`, `tests/orchestrator.test.ts`

- [ ] **Step 1: Write the failing test — `tests/orchestrator.test.ts`** (real DB, mocked LLM + fetch)

```ts
import { describe, it, expect, beforeAll, vi } from "vitest";
import { randomUUID, randomBytes } from "node:crypto";
import { runMigrations } from "../src/db/migrate.js";
import { makeDb } from "../src/db/client.js";
import { createBrand } from "../src/service/brands.js";
import { createSite } from "../src/service/sites.js";
import { saveCredential } from "../src/service/credentials.js";
import { addTopic } from "../src/service/topics.js";
import { getAllSlugs } from "../src/service/published.js";
import { runGenerate } from "../src/generation/orchestrator.js";
import { registerLLMProvider } from "../src/providers/llm/index.js";

const URL = "file::memory:?cache=shared";

const fakeArticle = {
  title: "How to Cut Blinkit Ad Waste in 2026 Fast",
  slug: "cut-blinkit-ad-waste-2026",
  excerpt: "A short, specific meta description about reducing Blinkit ad waste with steps and data points.",
  category: "Guides", tags: ["blinkit"], date: "2026-05-31",
  bodyMarkdown: "Waste starts with dark hours.\n\n## What is ad waste?\n\nSee {{visual:waste}}.",
  tldr: "Pause dark hours; save 18-30%.",
  faqs: [{ question: "a?", answer: "b" }, { question: "c?", answer: "d" }, { question: "e?", answer: "f" }],
  takeaways: ["Pause dark hours", "Tighten match", "Cap CPC", "Review weekly"],
  relatedSlugs: [], visuals: [{ token: "waste", kind: "svg", code: "<svg/>", alt: "chart" }],
  seoHints: { jsonldType: "Article", mentions: ["Blinkit"], speakableSelectors: ["h1"] },
};

let siteId: string;
beforeAll(async () => {
  process.env.QCONTENT_MASTER_KEY = randomBytes(32).toString("base64");
  await runMigrations(URL);
  const db = makeDb(URL);
  const brand = await createBrand(db, { name: "Ladya", slug: "ladya-orch", seedKeywords: ["blinkit ads"] });
  const site = await createSite(db, {
    brandId: brand.id, name: "Ladya", slug: "ladya-orch-site", adapterType: "webhook",
    baseUrl: "https://ladya.in", contentTypes: { guides: { minWords: 1000 } },
  });
  siteId = site.id;
  await saveCredential(db, { siteId, integration: "webhook", secret: { url: "https://hook.test/in", token: "t" } });
  await addTopic(db, { siteId, title: "How to reduce Blinkit ad waste?", source: "manual", status: "approved", priority: 5 });

  // Register a fake LLM provider so no network call is made.
  registerLLMProvider("fake", () => ({
    name: "fake",
    async generateJson() { return fakeArticle as never; },
  }));

  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: "wh-1" }) }));
});

describe("runGenerate", () => {
  it("runs end-to-end: topic -> llm -> validate -> publish -> record", async () => {
    const db = makeDb(URL);
    const result = await runGenerate(db, { siteId, llmProvider: "fake", contentType: "guides" });
    expect(result.status).toBe("ok");
    expect(result.url).toBe("https://ladya.in/cut-blinkit-ad-waste-2026");
    expect(await getAllSlugs(db, siteId)).toContain("cut-blinkit-ad-waste-2026");
  });

  it("fails the run when the slug already exists (dedupe) and produces no second publish", async () => {
    const db = makeDb(URL);
    const result = await runGenerate(db, { siteId, llmProvider: "fake", contentType: "guides" });
    expect(result.status).toBe("failed");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/orchestrator.test.ts`
Expected: FAIL ("Cannot find module ... orchestrator.js").

- [ ] **Step 3: Implement `src/generation/orchestrator.ts`**

```ts
import { createHash } from "node:crypto";
import type { DB } from "../db/client.js";
import { getSite } from "../service/sites.js";
import { getBrand } from "../service/brands.js";
import { getCredential } from "../service/credentials.js";
import { popQueuedTopic } from "../service/topics.js";
import { getAllSlugs, recordPublished, slugExists } from "../service/published.js";
import { startRun } from "../service/runs.js";
import { getLLMProvider } from "../providers/llm/index.js";
import { getTopicSource } from "../providers/topics/index.js";
import { getPublishAdapter } from "../adapters/publish/index.js";
import { buildGenerationPrompt } from "./prompt-builder.js";
import { ArticleSchema } from "../domain/article.js";
import { validateArticle } from "../domain/validators.js";

export interface GenerateArgs {
  siteId: string;
  llmProvider?: string;   // default 'claude'
  topicSource?: string;   // default 'dataforseo'
  contentType?: string;   // default 'guides'
  model?: string;
}

export interface GenerateResult {
  status: "ok" | "failed";
  url?: string;
  slug?: string;
  error?: string;
}

export async function runGenerate(db: DB, args: GenerateArgs): Promise<GenerateResult> {
  const run = await startRun(db, { siteId: args.siteId, jobType: "generate" });
  try {
    const site = await getSite(db, args.siteId);
    if (!site) throw new Error(`site not found: ${args.siteId}`);
    const brand = await getBrand(db, site.brandId);
    if (!brand) throw new Error(`brand not found: ${site.brandId}`);

    const contentType = args.contentType ?? "guides";

    // 1. Topic: queue first, else discovery.
    let topic: string;
    const queued = await popQueuedTopic(db, args.siteId);
    if (queued) {
      topic = queued.title;
      await run.log("info", "topic from queue", { topic });
    } else {
      const source = getTopicSource(args.topicSource ?? "dataforseo");
      const discovered = await source.discover(site, brand);
      topic = discovered.topic;
      await run.log("info", "topic discovered", { topic, source: source.name });
    }

    // 2. Generate via LLM.
    const existingSlugs = await getAllSlugs(db, args.siteId);
    const contentRule = (site.contentTypes as Record<string, Record<string, unknown>> | null)?.[contentType];
    const prompt = buildGenerationPrompt({ topic, contentType, brand, existingSlugs, contentRule });
    const llm = getLLMProvider(args.llmProvider ?? "claude");
    const article = await llm.generateJson({ prompt, schema: ArticleSchema, model: args.model });
    await run.log("info", "article generated", { slug: article.slug });

    // 3. Validate.
    const v = validateArticle(article);
    if (!v.ok) throw new Error(`validation failed: ${v.errors.join("; ")}`);

    // 4. Dedupe guard.
    if (await slugExists(db, args.siteId, article.slug)) {
      throw new Error(`slug already published: ${article.slug}`);
    }

    // 5. Publish via the site's adapter.
    const creds = (await getCredential<Record<string, unknown>>(db, args.siteId, site.adapterType)) ?? {};
    const adapter = getPublishAdapter(site.adapterType);
    const published = await adapter.publish(article, site, creds);
    await run.log("info", "published", { url: published.url });

    // 6. Record.
    const contentHash = createHash("sha256").update(article.bodyMarkdown).digest("hex");
    await recordPublished(db, {
      siteId: args.siteId, slug: article.slug, url: published.url, contentType,
      title: article.title, adapterRef: published.ref as Record<string, unknown>, contentHash,
    });

    await run.finishOk({ slug: article.slug, url: published.url });
    return { status: "ok", url: published.url, slug: article.slug };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await run.log("error", "generate failed", { message });
    await run.finishFailed(message);
    return { status: "failed", error: message };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/orchestrator.test.ts`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add src/generation/orchestrator.ts tests/orchestrator.test.ts
git commit -m "feat: generate orchestrator (topic->llm->validate->publish->record)"
```

---

### Task 14: Scheduler/worker (cron due-detection + dispatch)

**Files:**
- Create: `src/scheduler/worker.ts`, `tests/scheduler.test.ts`

- [ ] **Step 1: Write the failing test — `tests/scheduler.test.ts`**

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { randomUUID, randomBytes } from "node:crypto";
import { runMigrations } from "../src/db/migrate.js";
import { makeDb } from "../src/db/client.js";
import { brands, sites, schedules } from "../src/db/schema.js";
import { dueSchedules } from "../src/scheduler/worker.js";

const URL = "file::memory:?cache=shared";
let siteId: string;
beforeAll(async () => {
  process.env.QCONTENT_MASTER_KEY = randomBytes(32).toString("base64");
  await runMigrations(URL);
  const db = makeDb(URL);
  const bid = randomUUID();
  siteId = randomUUID();
  await db.insert(brands).values({ id: bid, name: "B", slug: "b-sched" });
  await db.insert(sites).values({ id: siteId, brandId: bid, name: "S", slug: "s-sched", adapterType: "webhook" });
});

describe("dueSchedules", () => {
  it("returns enabled schedules whose next_run_at is in the past or unset", async () => {
    const db = makeDb(URL);
    const past = new Date(Date.now() - 60_000);
    const future = new Date(Date.now() + 3_600_000);
    await db.insert(schedules).values({ id: randomUUID(), siteId, jobType: "generate", cron: "0 9 * * *", enabled: 1, nextRunAt: past });
    await db.insert(schedules).values({ id: randomUUID(), siteId, jobType: "generate", cron: "0 9 * * *", enabled: 1, nextRunAt: future });
    await db.insert(schedules).values({ id: randomUUID(), siteId, jobType: "generate", cron: "0 9 * * *", enabled: 0, nextRunAt: past });

    const due = await dueSchedules(db, new Date());
    expect(due).toHaveLength(1);
    expect(due[0]!.jobType).toBe("generate");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/scheduler.test.ts`
Expected: FAIL ("Cannot find module ... worker.js").

- [ ] **Step 3: Implement `src/scheduler/worker.ts`**

```ts
import { Cron } from "croner";
import { and, eq, lte, or, isNull } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { db as defaultDb } from "../db/client.js";
import { schedules } from "../db/schema.js";
import { runGenerate } from "../generation/orchestrator.js";

export type Schedule = typeof schedules.$inferSelect;

/** Enabled schedules whose nextRunAt is null or <= now. */
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
    if (s.jobType === "generate") {
      await runGenerate(db, { siteId: s.siteId });
    }
    // (other job types added in later phases)
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

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/scheduler.test.ts`
Expected: PASS (1 passed).

- [ ] **Step 5: Commit**

```bash
git add src/scheduler/worker.ts tests/scheduler.test.ts
git commit -m "feat: scheduler worker (due-detection + dispatch)"
```

---

### Task 15: CLI

**Files:**
- Create: `src/cli/index.ts` (no unit test — exercised by the E2E test in Task 16 and manual run)

- [ ] **Step 1: Implement `src/cli/index.ts`**

```ts
import { Command } from "commander";
import { db } from "../db/client.js";
import { runMigrations } from "../db/migrate.js";
import { createBrand } from "../service/brands.js";
import { createSite, listSites, getSiteBySlug } from "../service/sites.js";
import { saveCredential } from "../service/credentials.js";
import { addTopic } from "../service/topics.js";
import { runGenerate } from "../generation/orchestrator.js";
import { startWorker } from "../scheduler/worker.js";

// Side-effect imports register providers/adapters.
import "../providers/llm/claude.js";
import "../providers/topics/dataforseo.js";
import "../adapters/publish/webhook.js";

const program = new Command();
program.name("qcontent").description("Multi-site content & GEO engine");

program.command("migrate").description("apply DB migrations").action(async () => {
  await runMigrations();
  console.log("migrations applied");
});

program
  .command("brand:add")
  .requiredOption("--name <name>")
  .requiredOption("--slug <slug>")
  .option("--seeds <csv>", "comma-separated seed keywords", "")
  .action(async (o) => {
    const brand = await createBrand(db, {
      name: o.name, slug: o.slug,
      seedKeywords: o.seeds ? String(o.seeds).split(",").map((s: string) => s.trim()) : [],
    });
    console.log("brand created:", brand.id);
  });

program
  .command("site:add")
  .requiredOption("--brand <brandId>")
  .requiredOption("--name <name>")
  .requiredOption("--slug <slug>")
  .requiredOption("--adapter <type>")
  .option("--base-url <url>")
  .action(async (o) => {
    const site = await createSite(db, {
      brandId: o.brand, name: o.name, slug: o.slug, adapterType: o.adapter, baseUrl: o.baseUrl,
    });
    console.log("site created:", site.id);
  });

program
  .command("creds:set")
  .requiredOption("--site <siteId>")
  .requiredOption("--integration <name>")
  .requiredOption("--json <json>", "secret payload as JSON")
  .action(async (o) => {
    await saveCredential(db, { siteId: o.site, integration: o.integration, secret: JSON.parse(o.json) });
    console.log("credential saved");
  });

program
  .command("topic:add")
  .requiredOption("--site <siteId>")
  .requiredOption("--title <title>")
  .option("--type <contentType>")
  .option("--approve", "mark approved", false)
  .option("--priority <n>", "priority", "0")
  .action(async (o) => {
    await addTopic(db, {
      siteId: o.site, title: o.title, source: "manual", contentType: o.type,
      status: o.approve ? "approved" : "pending", priority: Number(o.priority),
    });
    console.log("topic added");
  });

program.command("sites:list").action(async () => {
  for (const s of await listSites(db)) console.log(`${s.slug}\t${s.adapterType}\t${s.id}`);
});

program
  .command("run")
  .description("run a job now")
  .requiredOption("--site <slug>")
  .option("--job <type>", "job type", "generate")
  .option("--llm <provider>", "llm provider", "claude")
  .option("--type <contentType>", "content type", "guides")
  .action(async (o) => {
    const site = await getSiteBySlug(db, o.site);
    if (!site) throw new Error(`site not found: ${o.site}`);
    if (o.job !== "generate") throw new Error(`Phase 1 supports only 'generate'; got ${o.job}`);
    const result = await runGenerate(db, { siteId: site.id, llmProvider: o.llm, contentType: o.type });
    console.log(JSON.stringify(result, null, 2));
    if (result.status === "failed") process.exit(1);
  });

program.command("worker").description("start the scheduler worker").action(async () => {
  await startWorker();
});

program.parseAsync();
```

- [ ] **Step 2: Typecheck the whole project**

Run: `npm run typecheck`
Expected: no type errors.

- [ ] **Step 3: Smoke-run the CLI help**

Run: `npx tsx src/cli/index.ts --help`
Expected: prints the command list including `migrate`, `brand:add`, `site:add`, `creds:set`, `topic:add`, `run`, `worker`.

- [ ] **Step 4: Commit**

```bash
git add src/cli/index.ts
git commit -m "feat: qcontent CLI"
```

---

### Task 16: End-to-end test + README + .env.example

**Files:**
- Create: `tests/e2e.test.ts`, `.env.example`, `README.md`

- [ ] **Step 1: Write the E2E test — `tests/e2e.test.ts`** (spins up a real local HTTP webhook receiver; mocks only the LLM)

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import { runMigrations } from "../src/db/migrate.js";
import { makeDb } from "../src/db/client.js";
import { createBrand } from "../src/service/brands.js";
import { createSite } from "../src/service/sites.js";
import { saveCredential } from "../src/service/credentials.js";
import { addTopic } from "../src/service/topics.js";
import { runGenerate } from "../src/generation/orchestrator.js";
import { registerLLMProvider } from "../src/providers/llm/index.js";
import "../src/adapters/publish/webhook.js";

const URL = "file::memory:?cache=shared";
let server: Server;
let received: unknown[] = [];
let port: number;

const fakeArticle = {
  title: "How to Cut Blinkit Ad Waste in 2026 Fast",
  slug: "e2e-cut-waste",
  excerpt: "A short, specific meta description about reducing Blinkit ad waste with concrete steps and data.",
  category: "Guides", tags: ["blinkit"], date: "2026-05-31",
  bodyMarkdown: "Lead answer.\n\n## What is ad waste?\n\nSee {{visual:waste}}.",
  tldr: "Pause dark hours; save 18-30%.",
  faqs: [{ question: "a?", answer: "b" }, { question: "c?", answer: "d" }, { question: "e?", answer: "f" }],
  takeaways: ["Pause dark hours", "Tighten match", "Cap CPC", "Review weekly"],
  relatedSlugs: [], visuals: [{ token: "waste", kind: "svg", code: "<svg/>", alt: "chart" }],
  seoHints: { jsonldType: "Article", mentions: ["Blinkit"], speakableSelectors: ["h1"] },
};

beforeAll(async () => {
  process.env.QCONTENT_MASTER_KEY = randomBytes(32).toString("base64");
  await runMigrations(URL);
  registerLLMProvider("fake", () => ({ name: "fake", async generateJson() { return fakeArticle as never; } }));

  await new Promise<void>((resolve) => {
    server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        received.push(JSON.parse(body));
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ id: "received-1" }));
      });
    });
    server.listen(0, () => {
      port = (server.address() as { port: number }).port;
      resolve();
    });
  });
});

afterAll(() => {
  server.close();
});

describe("E2E: generate -> webhook publish", () => {
  it("delivers a validated article to a live webhook receiver and records it", async () => {
    const db = makeDb(URL);
    const brand = await createBrand(db, { name: "Ladya", slug: "e2e-brand", seedKeywords: ["blinkit ads"] });
    const site = await createSite(db, {
      brandId: brand.id, name: "Ladya", slug: "e2e-site", adapterType: "webhook", baseUrl: "https://ladya.in",
      contentTypes: { guides: {} },
    });
    await saveCredential(db, {
      siteId: site.id, integration: "webhook",
      secret: { url: `http://127.0.0.1:${port}/hook`, token: "secret" },
    });
    await addTopic(db, { siteId: site.id, title: "How to reduce Blinkit ad waste?", source: "manual", status: "approved", priority: 5 });

    const result = await runGenerate(db, { siteId: site.id, llmProvider: "fake", contentType: "guides" });

    expect(result.status).toBe("ok");
    expect(result.url).toBe("https://ladya.in/e2e-cut-waste");
    expect(received).toHaveLength(1);
    expect((received[0] as { article: { slug: string } }).article.slug).toBe("e2e-cut-waste");
  });
});
```

- [ ] **Step 2: Run the E2E test**

Run: `npx vitest run tests/e2e.test.ts`
Expected: PASS (1 passed).

- [ ] **Step 3: Create `.env.example`**

```bash
# Master key for encrypting credentials at rest. Generate with:
#   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
QCONTENT_MASTER_KEY=

# Turso (libSQL). For local dev, leave unset to use a local file (file:local.db).
TURSO_DATABASE_URL=
TURSO_AUTH_TOKEN=

# LLM providers
ANTHROPIC_API_KEY=

# Topic discovery (DataForSEO)
DATAFORSEO_LOGIN=
DATAFORSEO_PASSWORD=
```

- [ ] **Step 4: Create `README.md`**

```markdown
# qcontent

Autonomous, multi-site content & GEO engine. One engine maintains many sites of mixed types
via publishing adapters. See `docs/superpowers/specs/2026-05-31-qcontent-multisite-engine-design.md`.

## Phase 1 (this build)
Core spine: discover → generate (LLM) → validate → publish via **webhook adapter** → record,
on a DB-driven schedule. Turso registry, encrypted credentials, pluggable LLM/topic providers.

## Quickstart
```bash
npm install
cp .env.example .env   # fill QCONTENT_MASTER_KEY (and ANTHROPIC_API_KEY for real runs)
npm run migrate
npm run cli -- brand:add --name "Ladya" --slug ladya --seeds "blinkit ads,zepto ads"
npm run cli -- site:add --brand <brandId> --name "Ladya" --slug ladya --adapter webhook --base-url https://ladya.in
npm run cli -- creds:set --site <siteId> --integration webhook --json '{"url":"https://your.hook/in","token":"secret"}'
npm run cli -- topic:add --site <siteId> --title "How to reduce Blinkit ad waste?" --approve --priority 5
npm run cli -- run --site ladya --job generate --type guides
```

## Test
```bash
npm test
```

## Roadmap
Phase 2: GitHub-MDX adapter + Google Indexing + Telegram. Phase 3: WordPress + Payload.
Phase 4: maintenance jobs + social. Phase 5: HTTP API + dashboard.
```

- [ ] **Step 5: Run the full test suite + typecheck**

Run: `npm test && npm run typecheck`
Expected: all test files PASS; no type errors.

- [ ] **Step 6: Commit**

```bash
git add tests/e2e.test.ts .env.example README.md
git commit -m "test: end-to-end generate->webhook + docs"
```

---

## Self-Review (against the spec)

**Spec coverage (Phase 1, §10):**
- Project scaffold → Task 1. ✓
- Turso schema + migrations → Task 4. ✓
- Secrets crypto → Task 2; credentials service → Task 5. ✓
- Canonical `Article` + zod schema + validators → Task 3. ✓
- LLM provider interface + Claude (JSON mode + retries) → Task 9. ✓
- Topic sources (manual queue + DataForSEO) → Tasks 7 + 10. ✓
- `generate` job (orchestrator, dedupe, publish-failure aborts run) → Task 13. ✓
- Webhook publish adapter → Task 12. ✓
- Service layer (brands/sites/credentials/topics/runs/published) → Tasks 5,6,7,8. ✓
- CLI → Task 15. ✓
- DB scheduler/worker + run recording → Tasks 8 (runs) + 14 (worker). ✓
- Exit criterion (configured site receives validated content via webhook on a schedule, run recorded) → Task 16 E2E + Task 14 worker. ✓

**Placeholder scan:** No TBD/TODO/"add error handling"-style steps; every code step shows full code.

**Type consistency:** `DB` type from `db/client.ts` used throughout; `Article`/`ArticleSchema` consistent; service signatures (`createBrand`, `createSite`, `saveCredential`/`getCredential`, `addTopic`/`popQueuedTopic`, `startRun`, `recordPublished`/`slugExists`/`getAllSlugs`) match their call sites in the orchestrator (Task 13) and CLI (Task 15); provider/adapter registry functions (`registerLLMProvider`/`getLLMProvider`, `registerTopicSource`/`getTopicSource`, `registerPublishAdapter`/`getPublishAdapter`) are defined before use. `runGenerate(db, args)` signature matches scheduler and E2E call sites.

**Note on Phase 1 scope:** The OG-image/Playwright/satori visuals, GitHub/WordPress/Payload adapters, Google Indexing, Telegram, and maintenance/social jobs are intentionally deferred to later phases per the spec; the seams (provider/adapter registries, job types) are in place so they slot in without refactoring.
