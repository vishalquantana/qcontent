import { z } from "zod";
import type { DB } from "../db/client.js";
import type { JobArgs, JobResult } from "./types.js";
import { getSite } from "../service/sites.js";
import { getBrand } from "../service/brands.js";
import { getCredential } from "../service/credentials.js";
import { getPublishedForSite, markSocialPosted, type PublishedRow } from "../service/published.js";
import { startRun } from "../service/runs.js";
import { getLLMProvider } from "../providers/llm/index.js";
import { deliverCarousel, type UploadPostCreds } from "../adapters/social/upload-post.js";
import { renderCarousel, playwrightRender, type BrandStyle, type RenderFn } from "../adapters/social/carousel-render.js";
import type { Article } from "../domain/article.js";

const SlidesSchema = z.object({
  caption: z.string().min(1),
  hashtags: z.array(z.string()).default([]),
  slides: z.array(z.object({ type: z.enum(["hook", "insight", "stat", "cta"]), text: z.string().min(1) })).min(2),
});

const DEFAULT_PALETTE = { bg: "#0a0a0a", card: "#18181b", accent: "#dc2626", text: "#fafafa", muted: "#a1a1aa" };

function brandStyle(brand: { name: string; palette?: unknown; social?: unknown }): BrandStyle {
  const p = (brand.palette as Partial<BrandStyle["palette"]> | null) ?? {};
  const handle = ((brand.social as Record<string, unknown> | null)?.instagram as string | undefined) ?? brand.name;
  return {
    name: brand.name,
    palette: {
      bg: p.bg ?? DEFAULT_PALETTE.bg,
      card: p.card ?? DEFAULT_PALETTE.card,
      accent: p.accent ?? DEFAULT_PALETTE.accent,
      text: p.text ?? DEFAULT_PALETTE.text,
      muted: p.muted ?? DEFAULT_PALETTE.muted,
    },
    handle,
  };
}

export async function runDistributeSocial(db: DB, args: JobArgs): Promise<JobResult> {
  const run = await startRun(db, { siteId: args.siteId, jobType: "distribute-social" });
  try {
    const site = await getSite(db, args.siteId);
    if (!site) throw new Error(`site not found: ${args.siteId}`);
    const brand = await getBrand(db, site.brandId);
    if (!brand) throw new Error(`brand not found: ${site.brandId}`);

    const creds = await getCredential<UploadPostCreds>(db, args.siteId, "upload-post");
    const llm = getLLMProvider((args.llmProvider as string) ?? "claude");
    const render: RenderFn = (args.render as RenderFn | undefined) ?? playwrightRender;
    const style = brandStyle(brand);

    const rows = (await getPublishedForSite(db, args.siteId)).filter(
      (r): r is PublishedRow & { article: Article } => !!r.article && r.socialPosted === 0,
    );
    const limit = (args.limit as number) ?? 1;
    const batch = rows.slice(0, limit);

    let posted = 0;
    for (const row of batch) {
      const prompt = `Write an Instagram carousel for this article. Return JSON {caption, hashtags[], slides[]} where slides is 4-6 items each {type: "hook"|"insight"|"stat"|"cta", text} (<=25 words each), opening with a hook and ending with a CTA to follow @${style.handle}. Article: ${JSON.stringify({ title: row.article.title, tldr: row.article.tldr, takeaways: row.article.takeaways })}`;
      const slides = await llm.generateJson({ prompt, schema: SlidesSchema });
      const hashtags = slides.hashtags.length ? slides.hashtags : ((brand.hashtags as string[] | null) ?? []);
      const images = await renderCarousel(slides.slides, style, render);
      const result = await deliverCarousel(creds, images, slides.caption, hashtags);
      if (result.delivered) {
        await markSocialPosted(db, row.id);
        posted++;
        await run.log("info", "social delivered", { slug: row.slug, requestId: result.requestId });
      } else {
        await run.log("info", "social not delivered", { slug: row.slug, reason: result.reason ?? (result.skipped ? "no creds" : "unknown") });
      }
    }

    await run.finishOk({ posted, candidates: batch.length });
    return { status: "ok", summary: { posted, candidates: batch.length } };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await run.log("error", "distribute-social failed", { message });
    await run.finishFailed(message);
    return { status: "failed", error: message };
  }
}
