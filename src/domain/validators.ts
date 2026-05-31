import type { Article } from "./article.js";

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

const TOKEN_RE = /\{\{visual:([a-z0-9-]+)\}\}/g;

export function validateArticle(article: Article): ValidationResult {
  const errors: string[] = [];

  // Every visual token referenced in the body must have a matching visual.
  const declared = new Set(article.visuals.map((v) => v.token));
  const referenced = new Set<string>();
  for (const m of article.bodyMarkdown.matchAll(TOKEN_RE)) referenced.add(m[1]!);
  for (const token of referenced) {
    if (!declared.has(token)) errors.push(`body references undeclared visual token: ${token}`);
  }

  // svg visuals must carry code; image visuals must carry url.
  for (const v of article.visuals) {
    if (v.kind === "svg" && !v.code) errors.push(`svg visual ${v.token} missing code`);
    if (v.kind === "image" && !v.url) errors.push(`image visual ${v.token} missing url`);
  }

  return { ok: errors.length === 0, errors };
}
