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
  article TEXT, social_posted INTEGER NOT NULL DEFAULT 0, published_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS published_site_slug_unq ON published_content(site_id, slug)
`;

export async function runMigrations(url = env.tursoUrl, authToken = env.tursoToken): Promise<void> {
  const client = createClient({ url, authToken });
  for (const stmt of DDL.split(";").map((s) => s.trim()).filter(Boolean)) {
    await client.execute(stmt);
  }
  // Idempotent column add for DBs created before the snapshot column existed.
  try {
    await client.execute("ALTER TABLE published_content ADD COLUMN article TEXT");
  } catch {
    // Column already exists (fresh DBs get it from CREATE TABLE) — ignore.
  }
  client.close();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runMigrations().then(() => {
    console.log("migrations applied");
    process.exit(0);
  });
}
