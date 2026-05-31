import { describe, it, expect } from "vitest";
import { articleToMdx, manifestEntry } from "../src/adapters/publish/mdx-format.js";
import type { Article } from "../src/domain/article.js";

const article: Article = {
  title: "How to Cut Blinkit Ad Waste in 2026: A Practical Guide",
  slug: "cut-blinkit-ad-waste-2026",
  excerpt: "A specific, concrete meta description about reducing Blinkit ad waste with steps, benchmarks, and data points worth citing here.",
  category: "Guides",
  tags: ["blinkit", "ad-waste"],
  date: "2026-05-31",
  bodyMarkdown: "Reducing waste starts with dayparting.\n\n## What is ad waste?\n\nSee {{visual:waste-bars}} for the breakdown.",
  tldr: "Pause dark hours and tighten match types; brands save 18-30%.",
  faqs: [
    { question: "What is ad waste?", answer: "Spend with no measurable return." },
    { question: "How much can I save?", answer: "Typically 18-30%." },
    { question: "Where do I start?", answer: "Dayparting." },
  ],
  takeaways: ["Pause dark hours", "Tighten match types", "Cap CPCs", "Review weekly"],
  relatedSlugs: ["acos", "dayparting"],
  visuals: [{ token: "waste-bars", kind: "svg", code: "<svg viewBox=\"0 0 400 200\"><rect/></svg>", alt: "waste chart" }],
  seoHints: { jsonldType: "Article", mentions: ["Blinkit"], speakableSelectors: ["h1", ".tldr-box"] },
};

describe("articleToMdx", () => {
  it("emits YAML frontmatter then the body with visuals inlined", () => {
    const mdx = articleToMdx(article);
    expect(mdx.startsWith("---\n")).toBe(true);
    expect(mdx).toContain("\n---\n");
    expect(mdx).toContain('title: ');
    expect(mdx).toContain("slug: cut-blinkit-ad-waste-2026");
    expect(mdx).toContain("tldr:");
    expect(mdx).toContain("<svg viewBox=");
    expect(mdx).not.toContain("{{visual:waste-bars}}");
    expect(mdx).toContain("## What is ad waste?");
  });

  it("inlines an image visual as a markdown image when kind is image", () => {
    const withImg: Article = {
      ...article,
      bodyMarkdown: "Intro.\n\n{{visual:pic}}",
      visuals: [{ token: "pic", kind: "image", url: "https://cdn.test/p.png", alt: "a pic" }],
    };
    const mdx = articleToMdx(withImg);
    expect(mdx).toContain("![a pic](https://cdn.test/p.png)");
    expect(mdx).not.toContain("{{visual:pic}}");
  });
});

describe("manifestEntry", () => {
  it("builds a manifest record keyed by slug with routing fields", () => {
    const entry = manifestEntry(article, "guides");
    expect(entry).toMatchObject({
      slug: "cut-blinkit-ad-waste-2026",
      type: "guides",
      title: article.title,
      date: "2026-05-31",
      path: "content/guides/cut-blinkit-ad-waste-2026.mdx",
    });
  });
});
