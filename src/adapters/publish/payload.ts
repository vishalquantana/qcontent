import type { Article } from "../../domain/article.js";
import type { Site } from "../../service/sites.js";
import type { PublishAdapter, PublishResult } from "./index.js";
import { registerPublishAdapter } from "./index.js";
import { inlineVisuals } from "./mdx-format.js";

interface PayloadConfig {
  baseUrl?: string;
  collection?: string;
  contentField?: string;
  statusField?: string;
  status?: string;
  authScheme?: string;
  extraFields?: Record<string, unknown>;
}

interface PayloadCreds {
  apiKey?: string;
}

export class PayloadAdapter implements PublishAdapter {
  readonly type = "payload";

  async publish(article: Article, site: Site, creds: Record<string, unknown>): Promise<PublishResult> {
    const apiKey = (creds as PayloadCreds).apiKey;
    if (!apiKey) throw new Error("payload adapter: missing 'apiKey' credential");

    const cfg = (site.adapterConfig ?? {}) as PayloadConfig;
    const base = (cfg.baseUrl ?? site.baseUrl ?? "").replace(/\/$/, "");
    if (!base) throw new Error("payload adapter: missing base URL (adapterConfig.baseUrl or site.baseUrl)");
    const collection = cfg.collection ?? "posts";
    const contentField = cfg.contentField ?? "content";
    const authScheme = cfg.authScheme ?? "users API-Key";

    const doc: Record<string, unknown> = {
      title: article.title,
      slug: article.slug,
      excerpt: article.excerpt,
      [contentField]: inlineVisuals(article),
      date: article.date,
      tags: article.tags,
      ...(cfg.extraFields ?? {}),
    };
    if (cfg.statusField) doc[cfg.statusField] = cfg.status ?? "published";

    const res = await fetch(`${base}/api/${collection}`, {
      method: "POST",
      headers: { Authorization: `${authScheme} ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(doc),
    });
    if (!res.ok) throw new Error(`payload create failed: ${res.status} ${await res.text().catch(() => "")}`);
    const body = (await res.json()) as { doc?: { id: string | number } };
    const id = body.doc?.id;
    const url = site.baseUrl ? `${site.baseUrl.replace(/\/$/, "")}/${collection}/${article.slug}` : article.slug;
    return { url, ref: { id } };
  }
}

registerPublishAdapter("payload", () => new PayloadAdapter());
