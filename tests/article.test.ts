import { describe, it, expect } from "vitest";
import { ArticleSchema } from "../src/domain/article.js";
import { validateArticle } from "../src/domain/validators.js";

const good = {
  title: "How to Cut Blinkit Ad Waste in 2026",
  slug: "cut-blinkit-ad-waste-2026",
  excerpt: "A short, specific meta description about reducing Blinkit ad waste with concrete steps.",
  category: "Guides",
  tags: ["blinkit", "ad-waste"],
  date: "2026-05-31",
  bodyMarkdown: "Reducing waste starts with dayparting.\n\n## What is ad waste?\n\nSpend with no return. See {{visual:waste-bars}}.",
  tldr: "Cut waste by pausing dark hours and tightening match types; brands save 18-30%.",
  faqs: [
    { question: "What is ad waste?", answer: "Spend that yields no measurable return." },
    { question: "How much can I save?", answer: "Typically 18-30%." },
    { question: "Where to start?", answer: "Dayparting." },
  ],
  takeaways: ["Pause dark hours", "Tighten match types", "Cap CPCs", "Review weekly"],
  relatedSlugs: ["acos", "dayparting"],
  visuals: [{ token: "waste-bars", kind: "svg", code: "<svg/>", alt: "waste chart" }],
  seoHints: { jsonldType: "Article", mentions: ["Blinkit"], speakableSelectors: ["h1", ".tldr-box"] },
};

describe("ArticleSchema", () => {
  it("accepts a valid article", () => {
    expect(() => ArticleSchema.parse(good)).not.toThrow();
  });
  it("rejects an article with too few faqs", () => {
    expect(() => ArticleSchema.parse({ ...good, faqs: [good.faqs[0]] })).toThrow();
  });
});

describe("validateArticle", () => {
  it("flags a visual token in body with no matching visual", () => {
    const bad = { ...good, bodyMarkdown: good.bodyMarkdown + " {{visual:missing}}" };
    const result = validateArticle(ArticleSchema.parse(bad));
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain("missing");
  });
  it("passes a consistent article", () => {
    const result = validateArticle(ArticleSchema.parse(good));
    expect(result.ok).toBe(true);
  });
});
