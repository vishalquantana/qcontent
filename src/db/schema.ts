import { sqliteTable, text, integer, uniqueIndex } from "drizzle-orm/sqlite-core";

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
  adapterType: text("adapter_type").notNull(),
  adapterConfig: text("adapter_config", { mode: "json" }).$type<Record<string, unknown>>().default({}),
  baseUrl: text("base_url"),
  contentTypes: text("content_types", { mode: "json" }).$type<Record<string, unknown>>().default({}),
  indexing: text("indexing", { mode: "json" }).$type<Record<string, unknown>>().default({}),
  enabled: integer("enabled").notNull().default(1),
  createdAt: now(),
});

export const credentials = sqliteTable("credentials", {
  id: id(),
  siteId: text("site_id").references(() => sites.id),
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
  source: text("source").notNull(),
  status: text("status").notNull().default("pending"),
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
  status: text("status").notNull().default("running"),
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
  article: text("article", { mode: "json" }).$type<Record<string, unknown>>(),
  socialPosted: integer("social_posted").notNull().default(0),
  publishedAt: integer("published_at", { mode: "timestamp_ms" }).$defaultFn(() => new Date()),
}, (t) => ({
  siteSlugUnq: uniqueIndex("published_site_slug_unq").on(t.siteId, t.slug),
}));
