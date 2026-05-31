import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { topics } from "../db/schema.js";

export type Topic = typeof topics.$inferSelect;

export async function addTopic(
  db: DB,
  args: { siteId: string; title: string; source: string } & Partial<
    Pick<Topic, "description" | "contentType" | "status" | "priority">
  >,
): Promise<Topic> {
  const id = randomUUID();
  await db.insert(topics).values({ id, ...args } as typeof topics.$inferInsert);
  return (await db.select().from(topics).where(eq(topics.id, id)))[0]!;
}

/** Pops the highest-priority 'approved' topic for a site, marking it 'used'. */
export async function popQueuedTopic(db: DB, siteId: string): Promise<Topic | null> {
  const rows = await db
    .select()
    .from(topics)
    .where(and(eq(topics.siteId, siteId), eq(topics.status, "approved")))
    .orderBy(desc(topics.priority))
    .limit(1);
  const topic = rows[0];
  if (!topic) return null;
  await db.update(topics).set({ status: "used", usedAt: new Date() }).where(eq(topics.id, topic.id));
  return topic;
}
