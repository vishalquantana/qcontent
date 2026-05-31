import { describe, it, expect } from "vitest";
import { buildGenerationPrompt } from "../src/generation/prompt-builder.js";

describe("buildGenerationPrompt", () => {
  it("embeds topic, content type, brand voice, and dedupe slugs", () => {
    const prompt = buildGenerationPrompt({
      topic: "How to reduce Blinkit ad waste?",
      contentType: "guides",
      brand: { name: "Ladya", voice: { tone: "punchy, data-led" }, seedKeywords: ["blinkit ads"] } as never,
      existingSlugs: ["acos", "dayparting"],
      contentRule: { minWords: 1000, style: "how-to with INR benchmarks" },
    });
    expect(prompt).toContain("How to reduce Blinkit ad waste?");
    expect(prompt).toContain("guides");
    expect(prompt).toContain("punchy, data-led");
    expect(prompt).toContain("acos");
    expect(prompt).toContain("{{visual:");
    expect(prompt).toContain("JSON");
  });
});
