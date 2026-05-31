import type { DB } from "../db/client.js";

export interface JobArgs {
  siteId: string;
  [key: string]: unknown;
}

export interface JobResult {
  status: "ok" | "failed";
  summary?: Record<string, unknown>;
  error?: string;
}

export type JobRunner = (db: DB, args: JobArgs) => Promise<JobResult>;
