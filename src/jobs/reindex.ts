import type { DB } from "../db/client.js";
import type { JobArgs, JobResult } from "./types.js";
import { getSite } from "../service/sites.js";
import { getCredential } from "../service/credentials.js";
import { getPublishedForSite } from "../service/published.js";
import { startRun } from "../service/runs.js";
import { runIndexing, type ServiceAccount } from "../adapters/index/google-indexing.js";

export async function runReindex(db: DB, args: JobArgs): Promise<JobResult> {
  const run = await startRun(db, { siteId: args.siteId, jobType: "reindex" });
  try {
    const site = await getSite(db, args.siteId);
    if (!site) throw new Error(`site not found: ${args.siteId}`);
    const sa = await getCredential<ServiceAccount>(db, args.siteId, "google-indexing");
    if (!sa) {
      await run.log("info", "no google-indexing credential; skipping", {});
      await run.finishOk({ skipped: true });
      return { status: "ok", summary: { skipped: true } };
    }
    const sitemapUrl = (site.indexing as Record<string, unknown> | null)?.sitemapUrl as string | undefined;
    const rows = await getPublishedForSite(db, args.siteId);
    let submitted = 0;
    for (const row of rows) {
      if (!row.url) continue;
      const res = await runIndexing(sa, row.url, sitemapUrl);
      if (res.submitted) submitted++;
    }
    await run.log("info", "reindex complete", { total: rows.length, submitted });
    await run.finishOk({ skipped: false, total: rows.length, submitted });
    return { status: "ok", summary: { skipped: false, total: rows.length, submitted } };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await run.log("error", "reindex failed", { message });
    await run.finishFailed(message);
    return { status: "failed", error: message };
  }
}
