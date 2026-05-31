import { describe, it, expect, beforeAll } from "vitest";
import { randomUUID, randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMigrations } from "../src/db/migrate.js";
import { makeDb } from "../src/db/client.js";
import { createApp, type App } from "../src/api/app.js";

const URL = `file:${join(tmpdir(), `qcontent-api-test-${randomUUID()}.db`)}`;
const TOKEN = "test-token-123";
let app: App;

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
