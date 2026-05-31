# What to absorb from `AgricIDaniel/claude-seo`

> Source: https://github.com/AgricIDaniel/claude-seo (MIT). Reviewed 2026-05-31.
> It is a **Claude Code plugin** (Python scripts + Claude skills/agents) for *auditing* sites —
> not a content engine. So we don't import its code; we absorb its **techniques, reference data,
> and prompt library** into qcontent. Below, each item is mapped to a qcontent phase.

## What it is (so we calibrate expectations)
25 sub-skills + 18 agents covering technical SEO, E-E-A-T, Schema.org, GEO/AEO, backlinks,
local/maps, semantic clustering, e-commerce, i18n, Google APIs, and MD/JSON/PDF reporting.
Strong points for us: a **falsifiability-first** recommendation style, evidence-based GEO
guidance (incl. a documented case that `llms.txt` is *not* a citation lever), schema templates +
a deprecated-types linter, an E-E-A-T quality-gate framework, and a large prompt library.

Its orientation is **audit/measure** (read a site, score it). qcontent is **generate/publish**
(create + distribute content). The overlap is the quality bar; the complement is that their
audit signals can become *our acceptance gates and maintenance jobs*.

---

## High-value absorptions, by phase

### Generation quality gate (fold into Phase 1/Phase 4 validators)
- **Passage citability heuristic** (`skills/seo-geo`): self-contained answer blocks ~134–167
  words, question-style H2s, attribution density. → Extend `src/domain/validators.ts` with a
  non-fatal `scoreCitability(article)` that warns when the lead/sections drift from these shapes;
  feed the score into `run_logs` and a future quality gate before publish.
- **E-E-A-T quality gates + filler/AI-pattern detection** (`skills/seo-content`,
  `scripts/content_quality.py`, `content_humanize.py`, `content_verify.py`): concrete checks for
  experience signals, citations, date stamps, and "filler" phrasing. → A `content-quality` check
  step in the generate pipeline (and the Phase 4 `refresh` job). Directly serves our project rule
  against thin/hallucinated content.
- **GEO evidence doc** (`skills/seo-geo/references/llmstxt-evidence.md`): primary-source argument
  that `llms.txt` is not a ranking/citation lever. → Re-scope our planned `llms.txt` work to
  "cheap to emit, don't over-invest"; prioritize on-page citability + schema instead.

### Schema / structured data (Phase 2 rendering + adapters)
- **`schema/templates.json`** (JSON-LD templates) and **`skills/seo-schema/references/
  deprecated-types-2024-2026.md`** (HowTo, SpecialAnnouncement, EstimatedSalary, CourseInfo
  carousel retired). → Seed our JSON-LD emitters from these templates and add a tiny
  "don't emit deprecated types" lint to `seoHints.jsonldType` handling.
- **Dual validation** (Rich Results + Schema Markup Validator). → Optional post-publish schema
  validation in the indexing/maintenance job.

### Topic strategy (Phase 1 topics + Phase 4 maintenance)
- **Semantic clustering / hub-spoke** (`skills/seo-cluster/references/*`: serp-overlap
  methodology, hub-spoke architecture). → Upgrade topic discovery from single-keyword to
  cluster-aware planning; informs `relatedSlugs` and the internal-link backfill job.
- **Prompt library** (`skills/seo-flow/references/prompts/**`): ready-made prompts for keyword
  research, content brief, blog outline/writing, meta description, title tag, PAA rewording. →
  Mine these to enrich `src/generation/prompt-builder.ts` and a future `content-brief` pre-step.

### Distribution / indexing (Phase 2)
- **IndexNow** (`scripts/indexnow_submit.py`): Bing/Yandex/Seznam/Naver instant indexing. → Add
  alongside Google Indexing in our `index` adapter.
- **Google API references** (`skills/seo-google/references/*`: GSC, Indexing API, PageSpeed/CrUX,
  GA4, NLP). → Reference material for the Google Indexing adapter now and analytics-driven
  `refresh` later.

### Programmatic + technical SEO (Phase 2/3 rendering & adapters)
- **Programmatic SEO** (`skills/seo-programmatic`): patterns for templated landing pages (our
  `/for/<platform>` style pages). → Future "pSEO" content type / adapter capability.
- **Agent-friendly pages, sitemap/robots, image SEO, hreflang** (`skills/seo-technical`,
  `seo-sitemap`, `seo-images`, `seo-hreflang`). → Checklist for the rendering conventions our
  GitHub-MDX adapter documents, plus per-site i18n config.

### Observability / "maintain" (Phase 4/5)
- **Drift monitoring via SQLite snapshots** (`scripts/drift_baseline|compare|history.py`):
  week-over-week regression tracking. → We already use Turso; add a `drift`/monitor job that
  snapshots published_content + key SEO signals and diffs over time.
- **Falsifiability framework** (every recommendation carries an explicit "how would we know this
  failed?" + a leading indicator). → Adopt this shape for `refresh`/`maintain` job outputs so each
  automated change is self-checking.
- **Multi-format reports** (MD/JSON/PDF). → A `runs` report exporter for the future dashboard.

### Security (only if we add crawling)
- **URL safety / SSRF + DNS-rebinding tests** (`scripts/url_safety.py`, `parasite_risk.py`). →
  Relevant only if/when we fetch arbitrary remote URLs (e.g. competitor analysis). Not needed for
  the publish-only Phase 1–3.

---

## Explicitly NOT absorbing
- Its plugin/skill/agent packaging, Python scripts, and audit-runner architecture — different
  language (Python) and different purpose (audit vs generate). We take ideas + data, not code.
- Local-SEO / Google-Business-Profile / maps intelligence — out of scope for qcontent's
  publish-to-many-sites mission.

## Suggested next step
When we start Phase 2, pull `schema/templates.json` + the deprecated-types list into our JSON-LD
layer, and lift 3–4 prompts from `seo-flow` into the prompt-builder. When we start Phase 4, adopt
the citability + E-E-A-T quality gate and the drift-snapshot monitor.
