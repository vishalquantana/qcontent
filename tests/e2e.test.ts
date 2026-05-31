import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
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
import "../src/adapters/publish/webhook.js";

const URL = `file:${join(tmpdir(), `qcontent-e2e-test-${randomUUID()}.db`)}`;
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
