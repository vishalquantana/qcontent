import { randomUUID } from "node:crypto";
import { and, eq, desc } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { publishedContent } from "../db/schema.js";
import type { Article } from "../domain/article.js";

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
    siteId: string; slug: string; url?: string; contentType?: string; title?: string;
    adapterRef?: Record<string, unknown>; contentHash?: string; article?: Article;
  },
): Promise<void> {
  const { article, ...rest } = args;
  await db.insert(publishedContent).values({
    id: randomUUID(),
    ...rest,
    article: (article as unknown as Record<string, unknown>) ?? undefined,
  } as typeof publishedContent.$inferInsert);
}

export interface PublishedRow {
  id: string;
  siteId: string;
  slug: string;
  url: string | null;
  contentType: string | null;
  title: string | null;
  adapterRef: Record<string, unknown> | null;
  contentHash: string | null;
  socialPosted: number;
  article: Article | null;
  publishedAt: Date | null;
}

export async function getPublishedForSite(db: DB, siteId: string): Promise<PublishedRow[]> {
  const rows = await db
    .select()
    .from(publishedContent)
    .where(eq(publishedContent.siteId, siteId))
    .orderBy(desc(publishedContent.publishedAt));
  return rows.map((r) => ({
    id: r.id,
    siteId: r.siteId,
    slug: r.slug,
    url: r.url ?? null,
    contentType: r.contentType ?? null,
    title: r.title ?? null,
    adapterRef: (r.adapterRef as Record<string, unknown> | null) ?? null,
    contentHash: r.contentHash ?? null,
    socialPosted: r.socialPosted,
    article: (r.article as unknown as Article | null) ?? null,
    publishedAt: r.publishedAt ?? null,
  }));
}

export async function updatePublishedArticle(
  db: DB,
  id: string,
  args: { article: Article; url?: string; contentHash?: string },
): Promise<void> {
  await db
    .update(publishedContent)
    .set({
      article: args.article as unknown as Record<string, unknown>,
      ...(args.url ? { url: args.url } : {}),
      ...(args.contentHash ? { contentHash: args.contentHash } : {}),
    })
    .where(eq(publishedContent.id, id));
}

export async function markSocialPosted(db: DB, id: string): Promise<void> {
  await db.update(publishedContent).set({ socialPosted: 1 }).where(eq(publishedContent.id, id));
}
