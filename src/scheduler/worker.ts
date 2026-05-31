import { Cron } from "croner";
import { and, eq, lte, or, isNull } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { db as defaultDb } from "../db/client.js";
import { schedules } from "../db/schema.js";
import { runJob } from "../jobs/index.js";

export type Schedule = typeof schedules.$inferSelect;

/** Enabled schedules whose nextRunAt is null or <= now. */
export async function dueSchedules(db: DB, now: Date): Promise<Schedule[]> {
  return db
    .select()
    .from(schedules)
    .where(and(eq(schedules.enabled, 1), or(isNull(schedules.nextRunAt), lte(schedules.nextRunAt, now))));
}

function computeNextRun(cron: string, from: Date): Date | null {
  const next = new Cron(cron).nextRun(from);
  return next ?? null;
}

export async function tick(db: DB, now = new Date()): Promise<void> {
  const due = await dueSchedules(db, now);
  for (const s of due) {
    try {
      await runJob(db, s.jobType, { siteId: s.siteId });
    } catch {
      // a dispatch error must not stop the loop; the job recorder logs its own failures
    }
    await db
      .update(schedules)
      .set({ lastRunAt: now, nextRunAt: computeNextRun(s.cron, now) })
      .where(eq(schedules.id, s.id));
  }
}

export async function startWorker(intervalMs = 60_000): Promise<void> {
  console.log(`qcontent worker started; polling every ${intervalMs}ms`);
  const loop = async () => {
    try {
      await tick(defaultDb);
    } catch (err) {
      console.error("worker tick error:", err);
    }
  };
  await loop();
  setInterval(loop, intervalMs);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startWorker();
}
