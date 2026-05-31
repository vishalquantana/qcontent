import { createHash } from "node:crypto";
import type { DB } from "../db/client.js";
import type { JobArgs, JobResult } from "./types.js";
import { getSite } from "../service/sites.js";
import { getCredential } from "../service/credentials.js";
import { getPublishedForSite, updatePublishedArticle, type PublishedRow } from "../service/published.js";
import { startRun } from "../service/runs.js";
import { getPublishAdapter } from "../adapters/publish/index.js";
import { ArticleSchema, type Article } from "../domain/article.js";
import { deriveKeywords, injectInternalLinks, type LinkCandidate } from "./links.js";

export async function runMaintainLinks(db: DB, args: JobArgs): Promise<JobResult> {
  const run = await startRun(db, { siteId: args.siteId, jobType: "maintain-links" });
  try {
    const site = await getSite(db, args.siteId);
    if (!site) throw new Error(`site not found: ${args.siteId}`);
    const adapter = getPublishAdapter(site.adapterType);
    if (!adapter.update) {
      await run.log("info", "adapter does not support update; skipping", { adapter: site.adapterType });
      await run.finishOk({ skipped: true, reason: "no update()" });
      return { status: "ok", summary: { skipped: true } };
    }
    const maxLinks = (args.maxLinksPerPost as number) ?? 3;
    const creds = (await getCredential<Record<string, unknown>>(db, args.siteId, site.adapterType)) ?? {};

    const rows = (await getPublishedForSite(db, args.siteId)).filter(
      (r): r is PublishedRow & { article: Article } => !!r.article && !!r.url,
    );
    const candidates: LinkCandidate[] = rows.map((r) => ({
      slug: r.slug,
      title: r.title ?? r.article.title,
      url: r.url!,
      keywords: deriveKeywords(r.title ?? r.article.title),
    }));

    let updated = 0;
    for (const row of rows) {
      // Exclude the post itself and any candidate already linked in this body, so repeated
      // runs are idempotent and never accumulate links beyond what each run adds.
      const others = candidates.filter(
        (c) => c.slug !== row.slug && !row.article.bodyMarkdown.includes(`](${c.url})`),
      );
      const { body, changed } = injectInternalLinks(row.article.bodyMarkdown, others, maxLinks);
      if (!changed) continue;
      const nextArticle = ArticleSchema.parse({ ...row.article, bodyMarkdown: body });
      const published = await adapter.update(nextArticle, row.adapterRef, site, creds);
      const contentHash = createHash("sha256").update(body).digest("hex");
      await updatePublishedArticle(db, row.id, { article: nextArticle, url: published.url, contentHash });
      updated++;
      await run.log("info", "linked post", { slug: row.slug });
    }

    await run.finishOk({ updated, scanned: rows.length });
    return { status: "ok", summary: { updated, scanned: rows.length } };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await run.log("error", "maintain-links failed", { message });
    await run.finishFailed(message);
    return { status: "failed", error: message };
  }
}
