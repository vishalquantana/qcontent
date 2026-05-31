import { describe, it, expect } from "vitest";
import { markdownToHtml } from "../src/adapters/publish/markdown-html.js";

describe("markdownToHtml", () => {
  it("converts headings, paragraphs, and links to HTML", () => {
    const html = markdownToHtml("# Title\n\nHello [world](https://x.test).");
    expect(html).toContain("<h1");
    expect(html).toContain("Title");
    expect(html).toContain('<a href="https://x.test"');
    expect(html).toContain("world");
  });

  it("passes raw inline SVG/HTML through untouched", () => {
    const html = markdownToHtml("Intro.\n\n<svg viewBox=\"0 0 10 10\"><rect/></svg>");
    expect(html).toContain("<svg viewBox=\"0 0 10 10\">");
    expect(html).toContain("<rect");
  });

  it("renders a markdown image as an <img> tag", () => {
    const html = markdownToHtml("![a pic](https://cdn.test/p.png)");
    expect(html).toContain('<img');
    expect(html).toContain('src="https://cdn.test/p.png"');
    expect(html).toContain('alt="a pic"');
  });

  it("returns a string synchronously (not a Promise)", () => {
    const out = markdownToHtml("plain");
    expect(typeof out).toBe("string");
  });
});
