import type { Brand } from "../service/brands.js";

export interface PromptArgs {
  topic: string;
  contentType: string;
  brand: Brand;
  existingSlugs: string[];
  contentRule?: Record<string, unknown>;
}

export function buildGenerationPrompt(args: PromptArgs): string {
  const voice = JSON.stringify(args.brand.voice ?? {});
  const rule = JSON.stringify(args.contentRule ?? {});
  const seeds = ((args.brand.seedKeywords as string[] | null) ?? []).join(", ");
  return `You are a senior content writer for the brand "${args.brand.name}".
Brand voice (JSON): ${voice}
Topic seeds: ${seeds}

Write one ${args.contentType} article about: "${args.topic}".
Content rules (JSON): ${rule}

GEO writing rules:
- The FIRST paragraph must directly answer the query in 2-3 data-rich sentences (citation-worthy).
- Every H2 must read as a natural-language search query.
- Include at least 3 specific, citable data points.
- Reference relevant real entities and metrics.
- Embed 1-2 data-visualization placeholders inline using the token form {{visual:some-token}};
  declare a matching entry in the "visuals" array with kind "svg" and complete <svg>...</svg> code.

Do NOT reuse any of these existing slugs: ${args.existingSlugs.join(", ") || "(none)"}.

Return ONLY a JSON object with EXACTLY these keys:
{
  "title": string (50-65 chars),
  "slug": string (kebab-case, unique),
  "excerpt": string (120-155 chars),
  "category": string,
  "tags": string[],
  "date": "YYYY-MM-DD",
  "bodyMarkdown": string (portable Markdown, no frontmatter, includes {{visual:...}} tokens),
  "tldr": string,
  "faqs": [{ "question": string, "answer": string }]  (at least 3),
  "takeaways": string[]  (4-6 items),
  "relatedSlugs": string[],
  "visuals": [{ "token": string, "kind": "svg", "code": string (full <svg>...</svg>), "alt": string }],
  "seoHints": { "jsonldType": "Article"|"HowTo"|"DefinedTerm", "mentions": string[], "speakableSelectors": string[] }
}`;
}
