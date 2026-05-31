# qcontent

Autonomous, multi-site content & GEO engine. One engine maintains many sites of mixed types
via publishing adapters. See `docs/superpowers/specs/2026-05-31-qcontent-multisite-engine-design.md`.

The engine runs the full lifecycle — discover → generate (LLM) → validate → publish → index →
distribute → maintain — for many sites of different types, from one place. It never lives inside a
target site; it talks to each destination through a **publishing adapter**. State lives in
**Turso/libSQL** (Drizzle), credentials are encrypted at rest, LLM/topic providers are pluggable,
and a DB-driven scheduler dispatches jobs. Operate it via the CLI or the HTTP API + dashboard.

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

## Publishing adapters
Set a site's `--adapter` and provide its credentials with `creds:set`.

- **webhook** — POST the canonical Article (+ site context) as JSON to any endpoint.
- **github-mdx** — commit `content/<type>/<slug>.mdx` (YAML frontmatter + body, visuals inlined)
  and upsert `content/manifest.json` via the GitHub Contents API; direct-commit or `prMode`.
  ```bash
  npm run cli -- site:add --brand <id> --name "Blog" --slug blog --adapter github-mdx \
    --base-url https://blog.example.com --config '{"owner":"me","repo":"blog","branch":"main","type":"guides"}'
  npm run cli -- creds:set --site <id> --integration github-mdx --json '{"token":"ghp_xxx"}'
  ```
- **wordpress** — REST API: Markdown→HTML post, category/tag resolution, Yoast/Rank Math SEO meta.
  ```bash
  npm run cli -- site:add --brand <id> --name "WP" --slug wp --adapter wordpress \
    --base-url https://blog.example.com --config '{"status":"publish","seoPlugin":"yoast"}'
  npm run cli -- creds:set --site <id> --integration wordpress --json '{"username":"admin","appPassword":"xxxx xxxx xxxx xxxx"}'
  ```
- **payload** — REST: create a collection document with the body as Markdown in a configurable field.
  ```bash
  npm run cli -- site:add --brand <id> --name "PL" --slug pl --adapter payload \
    --base-url https://cms.example.com --config '{"collection":"posts","contentField":"content","authScheme":"users API-Key"}'
  npm run cli -- creds:set --site <id> --integration payload --json '{"apiKey":"xxxxx"}'
  ```

## Jobs
Run any job now with `run --job <type>`, or schedule it by inserting a row in the `schedules`
table (`job_type` = any of these); the worker (`npm run worker`) dispatches due schedules.

- **generate** — discover topic → LLM → validate → publish → record.
- **reindex** — resubmit every published URL to Google Indexing + ping the sitemap.
- **maintain-links** — add internal links between published posts (re-publishes via `update()`).
- **refresh** — regenerate posts older than `--max-age-days` and update them in place.
- **distribute-social** — LLM carousel copy → Playwright PNGs → Instagram via Upload-Post.

```bash
npm run cli -- run --site <slug> --job reindex
npm run cli -- run --site <slug> --job maintain-links --limit 50
npm run cli -- run --site <slug> --job refresh --max-age-days 90 --limit 3
npm run cli -- run --site <slug> --job distribute-social --limit 1   # needs `npx playwright install chromium` + upload-post creds
```

Optional per-publish integrations (set as per-site credentials): `google-indexing`
(`{client_email, private_key}`), `telegram` (`{botToken, chatId}`), `upload-post` (`{apiKey, user}`).

## HTTP API + dashboard
A bearer-authenticated JSON API (built on `node:http`, no web framework) over the service + jobs
layer, plus a single static HTML dashboard.

```bash
export QCONTENT_API_TOKEN=$(node -e "console.log(require('crypto').randomBytes(24).toString('hex'))")
npm run serve              # http://127.0.0.1:8787  (dashboard at /, paste the token)
```

Endpoints (all `/api/*` except `/api/health` need `Authorization: Bearer $QCONTENT_API_TOKEN`):
`GET /api/health`, `GET|POST /api/brands`, `GET|POST /api/sites`, `GET /api/sites/:id/published`,
`POST /api/sites/:id/topics`, `POST /api/sites/:id/credentials`, `POST /api/sites/:id/run`
(`{job, ...}`), `GET /api/runs?siteId=&limit=`, `GET /api/runs/:id`.

## Test
```bash
npm test          # vitest
npm run typecheck # tsc --noEmit
```

## Status
Phases 1–5 complete. The engine generates, publishes (webhook / GitHub-MDX / WordPress / Payload),
maintains (reindex / internal links / refresh), distributes to social, and is operable via the CLI,
a DB-driven scheduler, and the HTTP API + dashboard.
