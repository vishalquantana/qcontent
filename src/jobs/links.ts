const STOPWORDS = new Set([
  "the", "a", "an", "to", "of", "in", "on", "for", "and", "or", "with", "how", "what",
  "why", "your", "you", "is", "are", "be", "from", "by", "at", "as", "it", "this", "that",
  "guide", "vs", "best", "2026", "2025",
]);

export interface LinkCandidate {
  slug: string;
  title: string;
  url: string;
  keywords: string[];
}

export interface LinkResult {
  body: string;
  changed: boolean;
}

/** Lowercase content words from a title, minus stopwords and short tokens. */
export function deriveKeywords(title: string): string[] {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Inject up to `maxLinks` internal markdown links into `body`. For each candidate,
 * link the first occurrence of one of its keywords that is NOT already inside a
 * markdown link. Case-insensitive match; preserves the matched text's original case.
 */
export function injectInternalLinks(body: string, candidates: LinkCandidate[], maxLinks: number): LinkResult {
  let out = body;
  let added = 0;

  for (const cand of candidates) {
    if (added >= maxLinks) break;
    // Skip candidates already linked anywhere in the body, so repeated runs stay idempotent
    // and a body that already references a URL never gets a second link to it.
    if (out.includes(`](${cand.url})`)) continue;
    for (const kw of cand.keywords) {
      if (added >= maxLinks) break;
      // Match the keyword as a whole word, not preceded by "[" / word char / "/",
      // not followed by a word char / "/", and not immediately followed by "](" (link text).
      const re = new RegExp(`(?<![\\[\\w/])(${escapeRegExp(kw)})(?![\\w/])(?!\\]\\()`, "i");
      const m = re.exec(out);
      if (!m) continue;
      const idx = m.index;
      const before2 = out.slice(Math.max(0, idx - 2), idx);
      if (before2 === "](") continue; // inside an existing link target
      const matchedText = m[1]!;
      out = out.slice(0, idx) + `[${matchedText}](${cand.url})` + out.slice(idx + matchedText.length);
      added++;
      break; // one link per candidate
    }
  }

  return { body: out, changed: added > 0 };
}
