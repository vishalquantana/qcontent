import { describe, it, expect } from "vitest";
import { slideHtml, renderCarousel, type SlideInput, type BrandStyle } from "../src/adapters/social/carousel-render.js";

const brand: BrandStyle = {
  name: "Ladya",
  palette: { bg: "#0a0a0a", card: "#18181b", accent: "#dc2626", text: "#fafafa", muted: "#a1a1aa" },
  handle: "getladya",
};

const slides: SlideInput[] = [
  { type: "hook", text: "Wasting ad spend on Blinkit?" },
  { type: "insight", text: "18-30% of spend goes to dark hours." },
  { type: "cta", text: "Follow @getladya" },
];

describe("slideHtml", () => {
  it("renders a full HTML doc with the slide text and brand colors", () => {
    const html = slideHtml(slides[1]!, 1, slides.length, brand);
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("18-30%");
    expect(html).toContain("#0a0a0a");
    expect(html).toContain("getladya");
  });
});

describe("renderCarousel", () => {
  it("calls the injected render fn once per slide and returns the buffers in order", async () => {
    const seen: string[] = [];
    const fakeRender = async (html: string) => {
      seen.push(html);
      return Buffer.from(`png:${seen.length}`);
    };
    const buffers = await renderCarousel(slides, brand, fakeRender);
    expect(buffers).toHaveLength(3);
    expect(buffers[0]!.toString()).toBe("png:1");
    expect(buffers[2]!.toString()).toBe("png:3");
    expect(seen[0]).toContain("Wasting ad spend");
    expect(seen[2]).toContain("Follow @getladya");
  });
});
