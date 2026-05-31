import { describe, it, expect, beforeAll, vi } from "vitest";
import { randomUUID, randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMigrations } from "../src/db/migrate.js";
import { makeDb } from "../src/db/client.js";
import { createBrand } from "../src/service/brands.js";
import { createSite } from "../src/service/sites.js";
import { saveCredential } from "../src/service/credentials.js";
import { recordPublished } from "../src/service/published.js";
import { runReindex } from "../src/jobs/reindex.js";

const URL = `file:${join(tmpdir(), `qcontent-reindex-test-${randomUUID()}.db`)}`;

vi.mock("jose", () => ({
  importPKCS8: vi.fn().mockResolvedValue({ fake: "k" }),
  SignJWT: class { setProtectedHeader(){return this;} setIssuedAt(){return this;} setIssuer(){return this;} setSubject(){return this;} setAudience(){return this;} setExpirationTime(){return this;} async sign(){return "jwt";} },
}));

let siteId: string;
beforeAll(async () => {
  process.env.QCONTENT_MASTER_KEY = randomBytes(32).toString("base64");
  await runMigrations(URL);
  const db = makeDb(URL);
  const brand = await createBrand(db, { name: "B", slug: "b-reindex" });
  const site = await createSite(db, { brandId: brand.id, name: "S", slug: "s-reindex", adapterType: "webhook", baseUrl: "https://x.test", indexing: { sitemapUrl: "https://x.test/sitemap.xml" } });
  siteId = site.id;
  await saveCredential(db, { siteId, integration: "google-indexing", secret: { client_email: "svc@x.iam", private_key: "-----BEGIN PRIVATE KEY-----\nMII\n-----END PRIVATE KEY-----\n" } });
  await recordPublished(db, { siteId, slug: "a", url: "https://x.test/guides/a", contentType: "guides", title: "A" });
  await recordPublished(db, { siteId, slug: "b", url: "https://x.test/guides/b", contentType: "guides", title: "B" });
});

describe("runReindex", () => {
  it("submits every published URL and reports a count", async () => {
    const db = makeDb(URL);
    const submitted: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "https://oauth2.googleapis.com/token") return { ok: true, status: 200, json: async () => ({ access_token: "at" }) } as Response;
      if (url.includes("urlNotifications:publish")) { submitted.push(JSON.parse(init!.body as string).url); return { ok: true, status: 200, json: async () => ({}) } as Response; }
      return { ok: true, status: 200, text: async () => "OK" } as Response;
    }) as never);

    const result = await runReindex(db, { siteId });
    expect(result.status).toBe("ok");
    expect(submitted.sort()).toEqual(["https://x.test/guides/a", "https://x.test/guides/b"]);
    expect(result.summary?.submitted).toBe(2);
  });

  it("skips (ok) when the site has no google-indexing credential", async () => {
    const db = makeDb(URL);
    const brand = await createBrand(db, { name: "B2", slug: "b-reindex2" });
    const site = await createSite(db, { brandId: brand.id, name: "S2", slug: "s-reindex2", adapterType: "webhook", baseUrl: "https://y.test" });
    await recordPublished(db, { siteId: site.id, slug: "c", url: "https://y.test/c" });
    const result = await runReindex(db, { siteId: site.id });
    expect(result.status).toBe("ok");
    expect(result.summary?.skipped).toBe(true);
  });
});
