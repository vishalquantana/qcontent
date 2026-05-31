import { describe, it, expect, beforeAll } from "vitest";
import { randomUUID, randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMigrations } from "../src/db/migrate.js";
import { makeDb } from "../src/db/client.js";
import { brands } from "../src/db/schema.js";
import { eq } from "drizzle-orm";

const URL = `file:${join(tmpdir(), `qcontent-db-test-${randomUUID()}.db`)}`;

beforeAll(async () => {
  process.env.QCONTENT_MASTER_KEY = randomBytes(32).toString("base64");
  await runMigrations(URL);
});

describe("db", () => {
  it("inserts and reads a brand", async () => {
    const db = makeDb(URL);
    const bid = randomUUID();
    await db.insert(brands).values({ id: bid, name: "Ladya", slug: "ladya" });
    const rows = await db.select().from(brands).where(eq(brands.id, bid));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.slug).toBe("ladya");
  });
});
