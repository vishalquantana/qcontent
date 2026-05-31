import type { DB } from "../db/client.js";
import type { JobArgs, JobResult, JobRunner } from "./types.js";
import { runGenerate } from "../generation/orchestrator.js";
import { runReindex } from "./reindex.js";
import { runMaintainLinks } from "./maintain-links.js";

const runners: Record<string, JobRunner> = {
  generate: (db, args) => runGenerate(db, args as { siteId: string }) as Promise<JobResult>,
  reindex: runReindex,
  "maintain-links": runMaintainLinks,
};

export function registerJob(jobType: string, runner: JobRunner): void {
  runners[jobType] = runner;
}

export function knownJobTypes(): string[] {
  return Object.keys(runners);
}

export async function runJob(db: DB, jobType: string, args: JobArgs): Promise<JobResult> {
  const runner = runners[jobType];
  if (!runner) throw new Error(`unknown job type: ${jobType}`);
  return runner(db, args);
}
