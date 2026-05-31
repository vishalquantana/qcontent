import { stringify as yamlStringify } from "yaml";
import type { Article, Visual } from "../../domain/article.js";

const TOKEN_RE = /\{\{visual:([a-z0-9-]+)\}\}/g;

function renderVisual(v: Visual): string {
  if (v.kind === "image" && v.url) return `![${v.alt}](${v.url})`;
  if (v.kind === "svg" && v.code) return v.code;
  return "";
}

export function inlineVisuals(article: Article): string {
  const byToken = new Map(article.visuals.map((v) => [v.token, v]));
  return article.bodyMarkdown.replace(TOKEN_RE, (_m, token: string) => {
    const v = byToken.get(token);
    return v ? renderVisual(v) : "";
  });
}

function frontmatter(article: Article): Record<string, unknown> {
  return {
    title: article.title,
    slug: article.slug,
    excerpt: article.excerpt,
    category: article.category,
    tags: article.tags,
    date: article.date,
    ...(article.publishDate ? { publishDate: article.publishDate } : {}),
    tldr: article.tldr,
    faqs: article.faqs,
    takeaways: article.takeaways,
    relatedSlugs: article.relatedSlugs,
    jsonldType: article.seoHints.jsonldType,
    mentions: article.seoHints.mentions,
  };
}

export function articleToMdx(article: Article): string {
  const fm = yamlStringify(frontmatter(article)).trimEnd();
  const body = inlineVisuals(article).trim();
  return `---\n${fm}\n---\n\n${body}\n`;
}

export interface ManifestEntry {
  slug: string;
  type: string;
  title: string;
  excerpt: string;
  date: string;
  path: string;
}

export function mdxPath(slug: string, type: string, basePath = "content"): string {
  return `${basePath}/${type}/${slug}.mdx`;
}

export function manifestEntry(article: Article, type: string, basePath = "content"): ManifestEntry {
  return {
    slug: article.slug,
    type,
    title: article.title,
    excerpt: article.excerpt,
    date: article.date,
    path: mdxPath(article.slug, type, basePath),
  };
}
