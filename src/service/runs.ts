import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
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
