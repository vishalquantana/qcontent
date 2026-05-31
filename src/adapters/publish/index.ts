import type { Article } from "../../domain/article.js";
import type { Site } from "../../service/sites.js";

export interface PublishResult {
  url: string;
  ref: unknown;
}

export interface PublishAdapter {
  readonly type: string;
  publish(article: Article, site: Site, creds: Record<string, unknown>): Promise<PublishResult>;
  update?(article: Article, ref: unknown, site: Site, creds: Record<string, unknown>): Promise<PublishResult>;
}

const registry = new Map<string, () => PublishAdapter>();
export function registerPublishAdapter(type: string, factory: () => PublishAdapter): void {
  registry.set(type, factory);
}
export function getPublishAdapter(type: string): PublishAdapter {
  const factory = registry.get(type);
  if (!factory) throw new Error(`unknown publish adapter: ${type}`);
  return factory();
}
