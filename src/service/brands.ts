import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { brands } from "../db/schema.js";

export type Brand = typeof brands.$inferSelect;

export async function createBrand(
  db: DB,
  args: { name: string; slug: string } & Partial<Omit<Brand, "id" | "name" | "slug" | "createdAt">>,
): Promise<Brand> {
  const id = randomUUID();
  await db.insert(brands).values({ id, ...args } as typeof brands.$inferInsert);
  const rows = await db.select().from(brands).where(eq(brands.id, id));
  return rows[0]!;
}

export async function getBrand(db: DB, id: string): Promise<Brand | null> {
  const rows = await db.select().from(brands).where(eq(brands.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function listBrands(db: DB): Promise<Brand[]> {
  return db.select().from(brands);
}
