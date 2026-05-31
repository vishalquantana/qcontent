import { marked } from "marked";

/**
 * Convert article Markdown to HTML for HTML-bodied CMSs (WordPress).
 * Configured synchronous + GFM; raw inline HTML/SVG passes through untouched
 * (marked does not sanitize, which is what we want for our own generated content).
 */
export function markdownToHtml(markdown: string): string {
  const out = marked.parse(markdown, { async: false, gfm: true, breaks: false });
  return typeof out === "string" ? out : String(out);
}
