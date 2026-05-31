import "../providers/llm/claude.js";
import "../providers/topics/dataforseo.js";
import "../adapters/publish/webhook.js";
import "../adapters/publish/github-mdx.js";
import "../adapters/publish/wordpress.js";
import "../adapters/publish/payload.js";

import { createHash } from "node:crypto";
import type { DB } from "../db/client.js";
import { getSite } from "../service/sites.js";
import { getBrand } from "../service/brands.js";
import { getCredential } from "../service/credentials.js";
import { peekQueuedTopic, markTopicUsed } from "../service/topics.js";
import { getAllSlugs, recordPublished, slugExists } from "../service/published.js";
import { startRun } from "../service/runs.js";
import { getLLMProvider } from "../providers/llm/index.js";
import { getTopicSource } from "../providers/topics/index.js";
import { getPublishAdapter } from "../adapters/publish/index.js";
import { buildGenerationPrompt } from "./prompt-builder.js";
import { ArticleSchema, type Article } from "../domain/article.js";
import { validateArticle } from "../domain/validators.js";
import { runIndexing, type ServiceAccount } from "../adapters/index/google-indexing.js";
import { notifyPublished, notifyFailure, type TelegramCreds } from "../adapters/notify/telegram.js";

export interface GenerateArgs {
  siteId: string;
  llmProvider?: string;
  topicSource?: string;
  contentType?: string;
  model?: string;
}

export interface GenerateResult {
  status: "ok" | "failed";
  url?: string;
  slug?: string;
  error?: string;
}

export async function runGenerate(db: DB, args: GenerateArgs): Promise<GenerateResult> {
  const run = await startRun(db, { siteId: args.siteId, jobType: "generate" });
  try {
    const site = await getSite(db, args.siteId);
    if (!site) throw new Error(`site not found: ${args.siteId}`);
    if (!site.enabled) throw new Error(`site disabled: ${args.siteId}`);
    const brand = await getBrand(db, site.brandId);
    if (!brand) throw new Error(`brand not found: ${site.brandId}`);

    const contentType = args.contentType ?? "guides";

    let topic: string;
    let queuedTopicId: string | null = null;
    const queued = await peekQueuedTopic(db, args.siteId);
    if (queued) {
      queuedTopicId = queued.id;
      topic = queued.title;
      await run.log("info", "topic from queue", { topic });
    } else {
      const source = getTopicSource(args.topicSource ?? "dataforseo");
      const discovered = await source.discover(site, brand);
      topic = discovered.topic;
      await run.log("info", "topic discovered", { topic, source: source.name });
    }

    const existingSlugs = await getAllSlugs(db, args.siteId);
    const contentTypes = site.contentTypes as Record<string, unknown> | null;
    const contentRule = contentTypes != null ? (contentTypes[contentType] as Record<string, unknown> | undefined) : undefined;
    const prompt = buildGenerationPrompt({ topic, contentType, brand, existingSlugs, contentRule });
    const llm = getLLMProvider(args.llmProvider ?? "claude");
    const article = await llm.generateJson({ prompt, schema: ArticleSchema, model: args.model }) as Article;
    await run.log("info", "article generated", { slug: article.slug });

    const v = validateArticle(article);
    if (!v.ok) throw new Error(`validation failed: ${v.errors.join("; ")}`);

    if (await slugExists(db, args.siteId, article.slug)) {
      throw new Error(`slug already published: ${article.slug}`);
    }

    const creds = (await getCredential<Record<string, unknown>>(db, args.siteId, site.adapterType)) ?? {};
    const adapter = getPublishAdapter(site.adapterType);
    const published = await adapter.publish(article, site, creds);
    await run.log("info", "published", { url: published.url });

    const contentHash = createHash("sha256").update(article.bodyMarkdown).digest("hex");
    await recordPublished(db, {
      siteId: args.siteId, slug: article.slug, url: published.url, contentType,
      title: article.title, adapterRef: published.ref as Record<string, unknown>, contentHash,
    });

    if (queuedTopicId) {
      await markTopicUsed(db, queuedTopicId);
    }

    // Best-effort: Google Indexing (only if a service-account credential exists for the site).
    try {
      const sa = await getCredential<ServiceAccount>(db, args.siteId, "google-indexing");
      const sitemapUrl = (site.indexing as Record<string, unknown> | null)?.sitemapUrl as string | undefined;
      const idx = await runIndexing(sa, published.url, sitemapUrl);
      await run.log("info", "indexing", idx as unknown as Record<string, unknown>);
    } catch (e) {
      await run.log("warn", "indexing error", { message: e instanceof Error ? e.message : String(e) });
    }

    // Best-effort: Telegram publish notification.
    try {
      const tg = await getCredential<TelegramCreds>(db, args.siteId, "telegram");
      await notifyPublished(tg, { title: article.title, url: published.url, type: contentType });
    } catch (e) {
      await run.log("warn", "notify error", { message: e instanceof Error ? e.message : String(e) });
    }

    await run.finishOk({ slug: article.slug, url: published.url });
    return { status: "ok", url: published.url, slug: article.slug };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await run.log("error", "generate failed", { message });
    await run.finishFailed(message);
    // Best-effort failure notification — never let it mask the original error.
    try {
      const tg = await getCredential<TelegramCreds>(db, args.siteId, "telegram");
      await notifyFailure(tg, { site: args.siteId, jobType: "generate", error: message });
    } catch {
      // swallow
    }
    return { status: "failed", error: message };
  }
}
