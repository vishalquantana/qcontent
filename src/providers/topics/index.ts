import type { Brand } from "../../service/brands.js";
import type { Site } from "../../service/sites.js";

export interface DiscoveredTopic {
  topic: string;
  contentType?: string;
}

export interface TopicSource {
  readonly name: string;
  discover(site: Site, brand: Brand): Promise<DiscoveredTopic>;
}

const registry = new Map<string, () => TopicSource>();
export function registerTopicSource(name: string, factory: () => TopicSource): void {
  registry.set(name, factory);
}
export function getTopicSource(name: string): TopicSource {
  const factory = registry.get(name);
  if (!factory) throw new Error(`unknown topic source: ${name}`);
  return factory();
}
