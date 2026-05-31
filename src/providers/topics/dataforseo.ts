import type { Brand } from "../../service/brands.js";
import type { Site } from "../../service/sites.js";
import type { DiscoveredTopic, TopicSource } from "./index.js";
import { registerTopicSource } from "./index.js";
import { env } from "../../env.js";

const BASE = "https://api.dataforseo.com/v3";

export class DataForSeoSource implements TopicSource {
  readonly name = "dataforseo";
  constructor(
    private pickSeed: (seeds: string[]) => string = (s) => s[Math.floor(Math.random() * s.length)] ?? "",
    private rng: () => number = Math.random,
  ) {}

  private auth(): string {
    return "Basic " + Buffer.from(`${env.dataforseoLogin}:${env.dataforseoPassword}`).toString("base64");
  }

  async discover(_site: Site, brand: Brand): Promise<DiscoveredTopic> {
    const seeds = (brand.seedKeywords as string[] | null) ?? [];
    const seed = typeof this.pickSeed === "function" ? this.pickSeed(seeds) : seeds[0] ?? "";
    if (!seed) throw new Error("no seed keywords on brand");

    if (this.rng() < 0.75) {
      const paa = await this.fetchPaa(seed);
      if (paa.length) return { topic: paa[Math.floor(this.rng() * paa.length)]! };
    }
    const kws = await this.fetchKeywords(seed);
    if (kws.length) return { topic: kws[Math.floor(this.rng() * kws.length)]! };
    return { topic: seed };
  }

  private async fetchPaa(seed: string): Promise<string[]> {
    const res = await fetch(`${BASE}/serp/google/organic/live/advanced`, {
      method: "POST",
      headers: { Authorization: this.auth(), "Content-Type": "application/json" },
      body: JSON.stringify([{ keyword: seed, location_code: 2356, language_code: "en", depth: 10 }]),
    });
    if (!res.ok) throw new Error(`dataforseo serp ${res.status}`);
    const json = (await res.json()) as DfsResponse;
    const items = json.tasks?.[0]?.result?.[0]?.items ?? [];
    return items.filter((i) => i.type === "people_also_ask" && i.title).map((i) => i.title!);
  }

  private async fetchKeywords(seed: string): Promise<string[]> {
    const res = await fetch(`${BASE}/dataforseo_labs/google/keyword_suggestions/live`, {
      method: "POST",
      headers: { Authorization: this.auth(), "Content-Type": "application/json" },
      body: JSON.stringify([{ keyword: seed, location_code: 2356, language_code: "en", limit: 20 }]),
    });
    if (!res.ok) throw new Error(`dataforseo kw ${res.status}`);
    const json = (await res.json()) as DfsResponse;
    const items = json.tasks?.[0]?.result?.[0]?.items ?? [];
    return items.map((i) => i.keyword).filter((k): k is string => !!k);
  }
}

interface DfsItem { type?: string; title?: string; keyword?: string; }
interface DfsResponse { tasks?: Array<{ result?: Array<{ items?: DfsItem[] }> }>; }

registerTopicSource("dataforseo", () => new DataForSeoSource());
