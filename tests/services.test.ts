import { describe, it, expect, beforeAll } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMigrations } from "../src/db/migrate.js";
import { makeDb } from "../src/db/client.js";
import { createBrand } from "../src/service/brands.js";
import { createSite, getSite, getSiteBySlug } from "../src/service/sites.js";

const URL = `file:${join(tmpdir(), `qcontent-services-test-${randomUUID()}.db`)}`;
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
