import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { sites } from "../db/schema.js";

export type Site = typeof sites.$inferSelect;

export async function createSite(
  db: DB,
  args: { brandId: string; name: string; slug: string; adapterType: string } & Partial<
    Omit<Site, "id" | "brandId" | "name" | "slug" | "adapterType" | "createdAt">
  >,
): Promise<Site> {
  const id = randomUUID();
  await db.insert(sites).values({ id, ...args } as typeof sites.$inferInsert);
  return (await db.select().from(sites).where(eq(sites.id, id)))[0]!;
}

export async function getSite(db: DB, id: string): Promise<Site | null> {
  const rows = await db.select().from(sites).where(eq(sites.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function getSiteBySlug(db: DB, slug: string): Promise<Site | null> {
  const rows = await db.select().from(sites).where(eq(sites.slug, slug)).limit(1);
  return rows[0] ?? null;
}

export async function listSites(db: DB): Promise<Site[]> {
  return db.select().from(sites);
}
