import { describe, it, expect } from "vitest";
import { deriveKeywords, injectInternalLinks, type LinkCandidate } from "../src/jobs/links.js";

describe("deriveKeywords", () => {
  it("extracts lowercase keywords from a title, dropping stopwords", () => {
    const kws = deriveKeywords("How to Reduce Blinkit Ad Waste");
    expect(kws).toContain("blinkit");
    expect(kws).toContain("waste");
    expect(kws).not.toContain("to");
    expect(kws).not.toContain("how");
  });
});

describe("injectInternalLinks", () => {
  const candidates: LinkCandidate[] = [
    { slug: "acos", title: "ACoS Explained", url: "/learn/acos", keywords: ["acos"] },
    { slug: "dayparting", title: "Dayparting Guide", url: "/learn/dayparting", keywords: ["dayparting"] },
  ];

  it("links the first un-linked occurrence of a candidate keyword, up to maxLinks", () => {
    const body = "Lower your ACoS with dayparting and smarter bids.";
    const out = injectInternalLinks(body, candidates, 3);
    expect(out.changed).toBe(true);
    expect(out.body).toContain("[ACoS](/learn/acos)");
    expect(out.body).toContain("[dayparting](/learn/dayparting)");
  });

  it("does not double-link text already inside a markdown link", () => {
    const body = "See [ACoS](/learn/acos) for details about acos and dayparting.";
    const out = injectInternalLinks(body, candidates, 3);
    expect(out.body.match(/\]\(\/learn\/acos\)/g)!.length).toBe(1);
    expect(out.body).toContain("[dayparting](/learn/dayparting)");
  });

  it("respects maxLinks", () => {
    const body = "acos dayparting acos dayparting";
    const out = injectInternalLinks(body, candidates, 1);
    const links = out.body.match(/\]\(\/learn\//g) ?? [];
    expect(links.length).toBe(1);
  });

  it("returns changed=false when nothing matches", () => {
    const out = injectInternalLinks("nothing relevant here", candidates, 3);
    expect(out.changed).toBe(false);
    expect(out.body).toBe("nothing relevant here");
  });
});
