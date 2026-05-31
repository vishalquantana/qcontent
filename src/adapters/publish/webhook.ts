import type { Article } from "../../domain/article.js";
import type { Site } from "../../service/sites.js";
import type { PublishAdapter, PublishResult } from "./index.js";
import { registerPublishAdapter } from "./index.js";

export class WebhookAdapter implements PublishAdapter {
  readonly type = "webhook";

  async publish(article: Article, site: Site, creds: Record<string, unknown>): Promise<PublishResult> {
    const endpoint = (creds.url as string | undefined) ?? ((site.adapterConfig as Record<string, unknown> | null)?.url as string | undefined);
    if (!endpoint) throw new Error("webhook adapter: missing 'url' in credentials or adapterConfig");

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (creds.token) headers.Authorization = `Bearer ${creds.token as string}`;

    const res = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({ site: { id: site.id, baseUrl: site.baseUrl }, article }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`webhook publish failed: ${res.status} ${body}`);
    }
    const ref = await res.json().catch(() => ({}));
    const url = site.baseUrl ? `${site.baseUrl.replace(/\/$/, "")}/${article.slug}` : article.slug;
    return { url, ref };
  }

  async update(article: Article, _ref: unknown, site: Site, creds: Record<string, unknown>): Promise<PublishResult> {
    const endpoint = (creds.url as string | undefined) ?? ((site.adapterConfig as Record<string, unknown> | null)?.url as string | undefined);
    if (!endpoint) throw new Error("webhook adapter: missing 'url' in credentials or adapterConfig");
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (creds.token) headers.Authorization = `Bearer ${creds.token as string}`;
    const res = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({ action: "update", site: { id: site.id, baseUrl: site.baseUrl }, article }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`webhook update failed: ${res.status} ${body}`);
    }
    const ref = await res.json().catch(() => ({}));
    const url = site.baseUrl ? `${site.baseUrl.replace(/\/$/, "")}/${article.slug}` : article.slug;
    return { url, ref };
  }
}

registerPublishAdapter("webhook", () => new WebhookAdapter());
