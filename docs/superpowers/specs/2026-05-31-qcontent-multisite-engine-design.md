# qcontent — Autonomous Multi-Site Content & GEO Engine

> Design spec. Date: 2026-05-31. Status: **Approved** (brainstorming complete).
> Project home: `/Users/vishalkumar/Downloads/qcontent`.
> Origin: generalizes the single-site Ladya content engine (`qcmax/ladya-site/`) into an
> independent, multi-site engine. Source analysis: `qcmax/docs/content-engine-analysis.md`
> and `qcmax/docs/content-engine-spec.md`.

---

## 1. Purpose

`qcontent` is a standalone TypeScript/Node service that runs the full content lifecycle —
**discover → generate → validate → publish → index → distribute → maintain** — for *many*
sites of mixed types, from one engine.

The defining shift from the existing Ladya engine: the engine **never lives inside a target
site and never edits a site's source files**. The old engine performed brittle string-surgery
on `ladya-site`'s own `meta.ts` / `page.tsx` / `illustrations.ts` and `git push`ed them. Here,
the engine is site-agnostic and talks to every destination through a **publishing adapter**.

### Goals
- One engine maintains N sites of heterogeneous types (GitHub-MDX, WordPress, Payload, custom).
- Adding a site is data (a row + credentials), not code or a new deployment.
- Pluggable LLM providers; per-site/brand model choice.
- Hardened generation (JSON-mode, schema validation, retries, rate limiting) — fixing the
  reliability gaps documented in the source analysis (§11).
- Observable: every job run is recorded; a dashboard can be added later without re-architecting.

### Non-goals (for now)
- A web dashboard/admin CMS (Phase 5, optional; the service layer is built to allow it).
- Rebuilding the abandoned DB-backed `/blog` + admin design from the original Ladya spec.
- Deploying/hosting the target sites themselves (the engine publishes *to* them).

---

## 2. Architecture overview

Central **engine + site adapters**. A long-running **worker** reads a schedule table and
dispatches **jobs**; each job uses **providers** (LLM, topic sources) and **adapters**
(publish, index, social, notify) and records a **run**. A **CLI** drives everything manually;
both CLI and a future HTTP API call the same thin **service** layer.

```
                         ┌─────────────────────────────┐
                         │  scheduler/worker (croner)   │
                         │  reads `schedules`, dispatches│
                         └──────────────┬──────────────┘
                                        ▼
   topics ──►  ┌──────────────────────────────────────────────┐
   (manual/    │  job: generate                                │
   dataforseo/ │   discover → LLM provider (JSON+schema+retry) │
   rss)        │   → build canonical Article → visuals         │
               │   → validate → persist → publish adapter      │
               └───────────────┬───────────────┬──────────────┘
                               ▼               ▼
                     publish adapter      index/social/notify
                  (webhook │ github-mdx    (google indexing,
                   │ wordpress │ payload)   instagram, telegram)
                               │
                               ▼
                   published_content + runs/run_logs (Turso)
```

---

## 3. Data model (Turso / libSQL via Drizzle ORM)

All persistent state lives in Turso. Tables:

### `brands`
Reusable identity; **one brand → many sites**.
```
id, name, slug,
voice          json   -- tone, audience, do/don't, reading level
palette        json   -- colors for visuals (bg, cards, accents, text)
fonts          json
assets         json   -- logo refs (light/dark), character art
social         json   -- handles per platform (instagram, x, linkedin)
hashtags       json   -- default hashtag sets
cta            json   -- label + url
seed_keywords  json   -- topic-discovery seeds
created_at, updated_at
```

### `sites`
A publishing destination.
```
id, brand_id (fk), name, slug,
adapter_type   text   -- 'webhook' | 'github-mdx' | 'wordpress' | 'payload'
adapter_config json   -- non-secret adapter settings (repo, base path, collection, endpoint…)
base_url       text   -- public site URL (for canonical/indexing)
content_types  json   -- which types this site publishes + per-type rules/length/style
indexing       json   -- google indexing on/off, sitemap url, llms.txt on/off
enabled        int    -- 0/1
created_at, updated_at
```

### `credentials`
Secrets, **encrypted at rest** (see §9). Keyed by site (or global) + integration.
```
id, site_id (fk, nullable for global), integration text,  -- 'llm:openrouter', 'wordpress', 'github', 'telegram', 'upload-post', 'google-indexing', 'dataforseo'
ciphertext     blob   -- AES-256-GCM(JSON payload)
iv, auth_tag   blob
created_at, updated_at
```

### `topics`
Per-site topic queue (supersedes the old `blog_topics`).
```
id, site_id (fk), title, description,
content_type   text
source         text   -- 'manual' | 'dataforseo' | 'rss'
status         text   -- 'pending' | 'approved' | 'used' | 'rejected'
priority       int
created_at, used_at
```

### `schedules`
```
id, site_id (fk), job_type text, cron text, enabled int,
last_run_at, next_run_at, created_at, updated_at
```

### `runs` + `run_logs`
```
runs:     id, site_id, job_type, status('running'|'ok'|'failed'),
          started_at, finished_at, summary json, error text
run_logs: id, run_id (fk), ts, level, message, data json
```

### `published_content`
```
id, site_id (fk), slug, url, content_type, title,
adapter_ref json,        -- adapter-specific ids (wp post id, git commit sha, payload doc id…)
content_hash text,       -- dedup / change detection
social_posted int,       -- repurposed to social yet?
published_at, updated_at
```

---

## 4. Canonical content model (Markdown-canonical)

Generation always yields a provider- and adapter-agnostic `Article`. Adapters translate at
the edge — keeping the core ignorant of any destination's format.

```ts
interface Visual {
  token: string;                 // referenced inline in bodyMarkdown, e.g. {{visual:roas-bars}}
  kind: 'svg' | 'image';
  code?: string;                 // SVG/TSX source for kind:'svg'
  url?: string;                  // resolved URL for kind:'image'
  alt: string;
}

interface Faq { question: string; answer: string; }

interface Article {
  title: string;                 // 50–65 chars
  slug: string;                  // unique per site
  excerpt: string;               // 120–155 chars
  category: string;
  tags: string[];
  date: string;                  // YYYY-MM-DD (run date)
  publishDate?: string;          // scheduling gate
  bodyMarkdown: string;          // portable Markdown (answer-first, H2-as-query)
  tldr: string;
  faqs: Faq[];                   // ≥3
  takeaways: string[];           // 4–6
  relatedSlugs: string[];
  visuals: Visual[];
  seoHints: {
    jsonldType: 'Article' | 'HowTo' | 'DefinedTerm';
    mentions: string[];
    speakableSelectors: string[];
  };
}
```

**Adapter translation:**
- **webhook** — POST the `Article` (+ site context) as JSON. (Phase 1)
- **github-mdx** — Markdown→MDX; write `content/<type>/<slug>.mdx` + a JSON data entry into the
  target repo's content dir per a documented **drop-in convention/manifest** the site loads
  dynamically (glob). **No editing of the site's `page.tsx`/registries.** Commit via API; PR optional.
- **wordpress** — Markdown→HTML; create REST post; upload featured media; map SEO fields
  (Yoast/RankMath); set categories/tags.
- **payload** — Markdown→Lexical; create a collection document via Payload REST/local API.

Visual tokens are resolved per adapter: inlined as MDX components (github), uploaded + swapped
for `<img>`/media (wordpress/payload), or left as token+asset in the webhook payload.

---

## 5. Generation pipeline (hardened)

1. **Topic** — `popQueuedTopic(site)` (approved/manual first) else `discoverTopic(site)` via a
   topic-source provider (DataForSEO PAA/keywords; RSS later). Seeds from the brand.
2. **Content type** — from the site's `content_types` rules (and/or scheduled job param).
3. **Dedup guard** — collect existing slugs from `published_content` for the site.
4. **LLM call** — pluggable provider (`claude` default; `openai`, `gemini`, `openrouter`),
   **JSON response mode + schema validation + retries with backoff + per-provider rate limiting**.
   Prompt built from **brand voice + site content rules + content type + GEO writing rules**
   (answer-first lead, H2-as-query, ≥3 citable data points, internal-link mandate, quotable
   tldr/faqs/takeaways).
5. **Visuals** — generate brand-styled data-viz SVG(s); optional OG image (satori/sharp);
   carousel slides (Playwright) for social.
6. **Validate** — Markdown/MDX compiles; internal links resolve; SVG/JSON well-formed; schema
   passes. Validation failure aborts before publish.
7. **Persist** — write `Article` + `run` record.
8. **Publish** — hand to the site's adapter. **A failed publish aborts and alerts; never emits a
   dead URL** (the one good property retained from the old engine).

---

## 6. Jobs

All run through the scheduler and record a `run`.

- **`generate`** — the core loop (§5).
- **`maintain-links`** — internal-link backfill across a site's published corpus; regenerate
  `llms.txt`. Derived from `published_content`, not hard-coded lists.
- **`reindex`** — submit URLs to Google Indexing + ping sitemaps; URL set derived from
  `published_content` (fixes the drift-prone hard-coded reindex list noted in source analysis §11).
- **`refresh`** — revisit stale posts (update stats/dates, fix broken links, thicken thin posts).
- **`distribute-social`** — pick unposted published content, render a brand carousel, post to
  Instagram via Upload-Post, mark `social_posted`.

---

## 7. Module layout (single package, modular folders)

```
qcontent/
  src/
    db/          schema.ts, client.ts, migrate.ts, migrations/
    config/      site & brand loaders, secrets crypto (encrypt/decrypt)
    domain/      article.ts (canonical model + zod schema), content-types.ts, validators.ts
    providers/
      llm/       index.ts (interface), claude.ts, openai.ts, gemini.ts, openrouter.ts
      topics/    index.ts (interface), dataforseo.ts, manual.ts, rss.ts
    generation/  orchestrator.ts, prompt-builder.ts, visuals/{svg.ts,og.ts,carousel.ts}, validate.ts
    adapters/
      publish/   index.ts (interface), webhook.ts, github-mdx.ts, wordpress.ts, payload.ts
      index/     google-indexing.ts
      social/    instagram.ts
      notify/    telegram.ts
    jobs/        generate.ts, maintain-links.ts, refresh.ts, distribute-social.ts, reindex.ts
    scheduler/   worker.ts, dispatch.ts, run-recorder.ts
    service/     sites.ts, brands.ts, credentials.ts, topics.ts, runs.ts  (CLI + future API share these)
    cli/         index.ts (commands: run, sites, brands, creds, topics, runs, schedule)
    index.ts
  tests/
  package.json, tsconfig.json, vitest.config.ts, drizzle.config.ts, .env.example, README.md
```

Interfaces (`PublishAdapter`, `LLMProvider`, `TopicSource`) are the seams; new adapters/providers
are drop-in implementations registered by `type`.

---

## 8. Interfaces (key seams)

```ts
interface LLMProvider {
  name: string;
  generateJson<T>(opts: { prompt: string; schema: ZodSchema<T>; model?: string }): Promise<T>;
}

interface TopicSource {
  name: string;
  discover(site: Site, brand: Brand): Promise<{ topic: string; contentType?: string }>;
}

interface PublishAdapter {
  type: string; // 'webhook' | 'github-mdx' | 'wordpress' | 'payload'
  publish(article: Article, site: Site, creds: Record<string, unknown>): Promise<PublishResult>;
  update?(article: Article, ref: unknown, site: Site, creds: Record<string, unknown>): Promise<PublishResult>;
}

interface PublishResult { url: string; ref: unknown; }
```

---

## 9. Cross-cutting concerns

- **Security.** Credentials AES-256-GCM encrypted at rest; master key from one env var
  (`QCONTENT_MASTER_KEY`). Secrets are decrypted only in-process at use; never written to
  `run_logs`. `.env.example` documents required vars; real `.env` git-ignored.
- **Observability.** Structured logging to `run_logs`; `runs` carries status/timings/summary;
  `qcontent runs` CLI view. This is the exact surface a future dashboard reads.
- **Error handling.** LLM: retries + backoff + rate limit; validation failures abort pre-publish;
  publish failure aborts the run and fires a Telegram alert (no dead URLs). Jobs are idempotent
  where feasible (dedup via `content_hash` / `published_content`).
- **Config drift fixes** (vs. source analysis §11): single content loader concept (canonical
  Article), reindex derived from data, no source string-surgery.

---

## 10. Phasing

- **Phase 1 — MVP spine (webhook, single site, end-to-end).**
  Project scaffold; Turso schema + migrations; secrets crypto; canonical `Article` + zod schema +
  validators; LLM provider interface + Claude impl (others stubbed behind interface); topic
  sources (manual queue + DataForSEO); `generate` job; **webhook publish adapter**; service layer
  (sites/brands/credentials/topics/runs); CLI; DB scheduler/worker + run recording. **Exit
  criterion:** a configured site receives validated, generated content via webhook on a schedule,
  with a recorded run — verified against a local webhook receiver.
- **Phase 2 —** GitHub-MDX adapter (drop-in convention + manifest) + Google Indexing + Telegram notify.
- **Phase 3 —** WordPress + Payload adapters (Markdown→HTML / →Lexical, media upload, SEO fields).
- **Phase 4 —** maintenance jobs (`maintain-links`, `refresh`, `reindex`) + `distribute-social`
  (carousel → Instagram) + OG images.
- **Phase 5 (optional) —** HTTP API + dashboard atop the existing service layer.

---

## 11. Testing strategy

- **Unit:** crypto round-trip; canonical-model zod validators; each adapter's translation
  (mocked endpoints — webhook receiver, GitHub API, WP REST, Payload); prompt-builder output;
  scheduler dispatch (cron → due jobs); topic dedup.
- **Integration / E2E (Phase 1):** end-to-end `generate` run against a local webhook receiver,
  asserting a persisted `Article`, a `published_content` row, and an `ok` run with logs.
- LLM provider calls mocked in tests; a single opt-in live smoke test gated by env.

---

## 12. Tech stack

Node 26 (ESM), TypeScript, Drizzle ORM + `@libsql/client` (Turso), `zod` (schemas/validation),
`tsx` (run/dev), `vitest` (tests), `croner` (cron parsing/scheduling), `playwright` (carousel
render), `satori` + `sharp` (OG images), `remark`/`unified` (Markdown→HTML for WordPress),
`@google/generative-ai` / `@anthropic-ai/sdk` / `openai` (LLM providers; OpenRouter via OpenAI-
compatible client), `dotenv`.
