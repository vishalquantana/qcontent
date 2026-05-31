# qcontent

Autonomous, multi-site content & GEO engine. One engine maintains many sites of mixed types
via publishing adapters. See `docs/superpowers/specs/2026-05-31-qcontent-multisite-engine-design.md`.

## Phase 1 (this build)
Core spine: discover -> generate (LLM) -> validate -> publish via **webhook adapter** -> record,
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
