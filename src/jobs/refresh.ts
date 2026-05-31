import { createHash } from "node:crypto";
import type { DB } from "../db/client.js";
import type { JobArgs, JobResult } from "./types.js";
import { getSite } from "../service/sites.js";
import { getBrand } from "../service/brands.js";
import { getCredential } from "../service/credentials.js";
import { getPublishedForSite, updatePublishedArticle, type PublishedRow } from "../service/published.js";
import { startRun } from "../service/runs.js";
import { getPublishAdapter } from "../adapters/publish/index.js";
import { getLLMProvider } from "../providers/llm/index.js";
import { ArticleSchema, type Article } from "../domain/article.js";
import { validateArticle } from "../domain/validators.js";

interface HasDate { publishedAt: Date | null; }

/** Rows older than maxAgeDays, oldest first, capped at limit. */
export function selectStale<T extends HasDate>(rows: T[], now: Date, maxAgeDays: number, limit: number): T[] {
  const cutoff = now.getTime() - maxAgeDays * 24 * 60 * 60 * 1000;
  return rows
    .filter((r) => r.publishedAt != null && r.publishedAt.getTime() < cutoff)
    .sort((a, b) => a.publishedAt!.getTime() - b.publishedAt!.getTime())
    .slice(0, limit);
}

export async function runRefresh(db: DB, args: JobArgs): Promise<JobResult> {
  const run = await startRun(db, { siteId: args.siteId, jobType: "refresh" });
  try {
    const site = await getSite(db, args.siteId);
    if (!site) throw new Error(`site not found: ${args.siteId}`);
    const brand = await getBrand(db, site.brandId);
    if (!brand) throw new Error(`brand not found: ${site.brandId}`);
    const adapter = getPublishAdapter(site.adapterType);
    if (!adapter.update) {
      await run.finishOk({ skipped: true, reason: "no update()" });
      return { status: "ok", summary: { skipped: true } };
    }
    const maxAgeDays = (args.maxAgeDays as number) ?? 90;
    const limit = (args.limit as number) ?? 3;
    const now = args.now ? new Date(args.now as string) : new Date();
    const llm = getLLMProvider((args.llmProvider as string) ?? "claude");
    const creds = (await getCredential<Record<string, unknown>>(db, args.siteId, site.adapterType)) ?? {};

    const all = (await getPublishedForSite(db, args.siteId)).filter(
      (r): r is PublishedRow & { article: Article } => !!r.article && !!r.url,
    );
    const stale = selectStale(all, now, maxAgeDays, limit);

    let refreshed = 0;
    for (const row of stale) {
      const prompt = `Improve and update this existing article for freshness and accuracy in 2026. Keep the SAME slug "${row.article.slug}". Return the full JSON Article object (same schema) with an improved bodyMarkdown, refreshed data points, and an updated title/excerpt if warranted. Current article JSON:\n${JSON.stringify(row.article)}`;
      const next = await llm.generateJson({ prompt, schema: ArticleSchema });
      const fixed = ArticleSchema.parse({ ...next, slug: row.article.slug }); // enforce slug stability
      const v = validateArticle(fixed);
      if (!v.ok) {
        await run.log("warn", "refresh produced invalid article; skipping", { slug: row.article.slug, errors: v.errors });
        continue;
      }
      const published = await adapter.update(fixed, row.adapterRef, site, creds);
      const contentHash = createHash("sha256").update(fixed.bodyMarkdown).digest("hex");
      await updatePublishedArticle(db, row.id, { article: fixed, url: published.url, contentHash });
      refreshed++;
      await run.log("info", "refreshed post", { slug: row.article.slug });
    }

    await run.finishOk({ refreshed, candidates: stale.length });
    return { status: "ok", summary: { refreshed, candidates: stale.length } };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await run.log("error", "refresh failed", { message });
    await run.finishFailed(message);
    return { status: "failed", error: message };
  }
}
