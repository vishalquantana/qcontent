import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { runs, runLogs } from "../db/schema.js";

export interface RunHandle {
  id: string;
  log(level: "info" | "warn" | "error", message: string, data?: Record<string, unknown>): Promise<void>;
  finishOk(summary?: Record<string, unknown>): Promise<void>;
  finishFailed(error: string, summary?: Record<string, unknown>): Promise<void>;
}

export async function startRun(
  db: DB,
  args: { siteId?: string | null; jobType: string },
): Promise<RunHandle> {
  const id = randomUUID();
  await db.insert(runs).values({ id, siteId: args.siteId ?? null, jobType: args.jobType, status: "running" });
  return {
    id,
    async log(level, message, data) {
      await db.insert(runLogs).values({ id: randomUUID(), runId: id, level, message, data });
    },
    async finishOk(summary) {
      await db.update(runs).set({ status: "ok", finishedAt: new Date(), summary }).where(eq(runs.id, id));
    },
    async finishFailed(error, summary) {
      await db.update(runs).set({ status: "failed", finishedAt: new Date(), error, summary }).where(eq(runs.id, id));
    },
  };
}

export type RunRow = typeof runs.$inferSelect;
export type RunLogRow = typeof runLogs.$inferSelect;

/** List runs, newest first, optionally filtered by site, capped by limit (default 50). */
export async function listRuns(
  db: DB,
  opts: { siteId?: string; limit?: number } = {},
): Promise<RunRow[]> {
  const limit = opts.limit ?? 50;
  return opts.siteId
    ? db.select().from(runs).where(eq(runs.siteId, opts.siteId)).orderBy(desc(runs.startedAt)).limit(limit)
    : db.select().from(runs).orderBy(desc(runs.startedAt)).limit(limit);
}

export async function getRun(db: DB, id: string): Promise<RunRow | null> {
  const rows = await db.select().from(runs).where(eq(runs.id, id)).limit(1);
  return rows[0] ?? null;
}

/** Logs for a run, oldest first. */
export async function getRunLogs(db: DB, runId: string): Promise<RunLogRow[]> {
  return db.select().from(runLogs).where(eq(runLogs.runId, runId)).orderBy(runLogs.ts);
}
