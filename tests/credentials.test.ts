import { describe, it, expect, beforeAll } from "vitest";
import { randomUUID, randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMigrations } from "../src/db/migrate.js";
import { makeDb } from "../src/db/client.js";
import { brands, sites } from "../src/db/schema.js";
import { saveCredential, getCredential } from "../src/service/credentials.js";

const URL = `file:${join(tmpdir(), `qcontent-creds-test-${randomUUID()}.db`)}`;
let siteId: string;

beforeAll(async () => {
  process.env.QCONTENT_MASTER_KEY = randomBytes(32).toString("base64");
  await runMigrations(URL);
  const db = makeDb(URL);
  const bid = randomUUID();
  siteId = randomUUID();
  await db.insert(brands).values({ id: bid, name: "B", slug: "b-creds" });
  await db.insert(sites).values({ id: siteId, brandId: bid, name: "S", slug: "s-creds", adapterType: "webhook" });
});

describe("credentials service", () => {
  it("stores encrypted and returns decrypted", async () => {
    const db = makeDb(URL);
    await saveCredential(db, { siteId, integration: "webhook", secret: { url: "https://x", token: "t" } });
    const got = await getCredential<{ url: string; token: string }>(db, siteId, "webhook");
    expect(got).toEqual({ url: "https://x", token: "t" });
  });

  it("returns null when missing", async () => {
    const db = makeDb(URL);
    const got = await getCredential(db, siteId, "nope");
    expect(got).toBeNull();
  });
});
