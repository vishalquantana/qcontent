import type { Article } from "../../domain/article.js";
import type { Site } from "../../service/sites.js";
import type { PublishAdapter, PublishResult } from "./index.js";
import { registerPublishAdapter } from "./index.js";
import { inlineVisuals } from "./mdx-format.js";
import { markdownToHtml } from "./markdown-html.js";

interface WordPressConfig {
  baseUrl?: string;
  status?: string;
  seoPlugin?: "yoast" | "rankmath" | "none";
}

interface WordPressCreds {
  username?: string;
  appPassword?: string;
}

interface WpTerm {
  id: number;
  name: string;
}

export class WordPressAdapter implements PublishAdapter {
  readonly type = "wordpress";

  async publish(article: Article, site: Site, creds: Record<string, unknown>): Promise<PublishResult> {
    const c = creds as WordPressCreds;
    if (!c.username || !c.appPassword) throw new Error("wordpress adapter: missing 'username'/'appPassword' credentials");

    const cfg = (site.adapterConfig ?? {}) as WordPressConfig;
    const base = (cfg.baseUrl ?? site.baseUrl ?? "").replace(/\/$/, "");
    if (!base) throw new Error("wordpress adapter: missing base URL (adapterConfig.baseUrl or site.baseUrl)");
    const api = `${base}/wp-json/wp/v2`;
    const auth = "Basic " + Buffer.from(`${c.username}:${c.appPassword}`).toString("base64");
    const headers = { Authorization: auth, "Content-Type": "application/json" };

    const categoryId = await this.resolveTerm(api, "categories", article.category, headers);
    const tagIds: number[] = [];
    for (const tag of article.tags) {
      tagIds.push(await this.resolveTerm(api, "tags", tag, headers));
    }

    const html = markdownToHtml(inlineVisuals(article));
    const payload: Record<string, unknown> = {
      title: article.title,
      content: html,
      excerpt: article.excerpt,
      slug: article.slug,
      status: cfg.status ?? "publish",
      categories: [categoryId],
      tags: tagIds,
    };
    const meta = this.seoMeta(cfg.seoPlugin, article);
    if (meta) payload.meta = meta;

    const res = await fetch(`${api}/posts`, { method: "POST", headers, body: JSON.stringify(payload) });
    if (!res.ok) throw new Error(`wordpress post failed: ${res.status} ${await res.text().catch(() => "")}`);
    const body = (await res.json()) as { id: number; link?: string };
    const url = body.link ?? `${base}/${article.slug}`;
    return { url, ref: { id: body.id, link: body.link } };
  }

  async update(article: Article, ref: unknown, site: Site, creds: Record<string, unknown>): Promise<PublishResult> {
    const c = creds as WordPressCreds;
    if (!c.username || !c.appPassword) throw new Error("wordpress adapter: missing 'username'/'appPassword' credentials");
    const id = (ref as { id?: number | string } | null)?.id;
    if (id === undefined || id === null) throw new Error("wordpress adapter: update requires ref.id");
    const cfg = (site.adapterConfig ?? {}) as WordPressConfig;
    const base = (cfg.baseUrl ?? site.baseUrl ?? "").replace(/\/$/, "");
    if (!base) throw new Error("wordpress adapter: missing base URL");
    const auth = "Basic " + Buffer.from(`${c.username}:${c.appPassword}`).toString("base64");
    const headers = { Authorization: auth, "Content-Type": "application/json" };

    const payload: Record<string, unknown> = {
      title: article.title,
      content: markdownToHtml(inlineVisuals(article)),
      excerpt: article.excerpt,
    };
    const meta = this.seoMeta(cfg.seoPlugin, article);
    if (meta) payload.meta = meta;

    const res = await fetch(`${base}/wp-json/wp/v2/posts/${id}`, { method: "POST", headers, body: JSON.stringify(payload) });
    if (!res.ok) throw new Error(`wordpress update failed: ${res.status} ${await res.text().catch(() => "")}`);
    const body = (await res.json()) as { id: number; link?: string };
    const url = body.link ?? `${base}/${article.slug}`;
    return { url, ref: { id: body.id, link: body.link } };
  }

  private async resolveTerm(
    api: string,
    taxonomy: "categories" | "tags",
    name: string,
    headers: Record<string, string>,
  ): Promise<number> {
    const searchRes = await fetch(`${api}/${taxonomy}?search=${encodeURIComponent(name)}&per_page=100`, { headers });
    if (!searchRes.ok) throw new Error(`wordpress ${taxonomy} search failed: ${searchRes.status}`);
    const found = (await searchRes.json()) as WpTerm[];
    const match = found.find((t) => t.name.toLowerCase() === name.toLowerCase());
    if (match) return match.id;

    const createRes = await fetch(`${api}/${taxonomy}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name }),
    });
    if (!createRes.ok) throw new Error(`wordpress ${taxonomy} create failed: ${createRes.status} ${await createRes.text().catch(() => "")}`);
    const created = (await createRes.json()) as WpTerm;
    return created.id;
  }

  private seoMeta(plugin: WordPressConfig["seoPlugin"], article: Article): Record<string, string> | undefined {
    if (plugin === "yoast") return { _yoast_wpseo_title: article.title, _yoast_wpseo_metadesc: article.excerpt };
    if (plugin === "rankmath") return { rank_math_title: article.title, rank_math_description: article.excerpt };
    return undefined;
  }
}

registerPublishAdapter("wordpress", () => new WordPressAdapter());
