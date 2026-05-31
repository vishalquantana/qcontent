import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { publishedContent } from "../db/schema.js";

export async function slugExists(db: DB, siteId: string, slug: string): Promise<boolean> {
  const rows = await db
    .select({ id: publishedContent.id })
    .from(publishedContent)
    .where(and(eq(publishedContent.siteId, siteId), eq(publishedContent.slug, slug)))
    .limit(1);
  return rows.length > 0;
}

export async function getAllSlugs(db: DB, siteId: string): Promise<string[]> {
  const rows = await db
    .select({ slug: publishedContent.slug })
    .from(publishedContent)
    .where(eq(publishedContent.siteId, siteId));
  return rows.map((r) => r.slug);
}

export async function recordPublished(
  db: DB,
  args: {
    siteId: string;
    slug: string;
    url?: string;
    contentType?: string;
    title?: string;
    adapterRef?: Record<string, unknown>;
    contentHash?: string;
  },
): Promise<void> {
  await db.insert(publishedContent).values({ id: randomUUID(), ...args } as typeof publishedContent.$inferInsert);
}
