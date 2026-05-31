import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";

const createMock = vi.fn();
vi.mock("@anthropic-ai/sdk", () => {
  return {
    default: class {
      messages = { create: createMock };
    },
  };
});

import { ClaudeProvider } from "../src/providers/llm/claude.js";

beforeEach(() => {
  createMock.mockReset();
  process.env.ANTHROPIC_API_KEY = "sk-test";
});

describe("ClaudeProvider", () => {
  it("parses a valid JSON response against a schema", async () => {
    createMock.mockResolvedValue({ content: [{ type: "text", text: '{"slug":"abc","n":3}' }] });
    const provider = new ClaudeProvider();
    const schema = z.object({ slug: z.string(), n: z.number() });
    const out = await provider.generateJson({ prompt: "make json", schema });
    expect(out).toEqual({ slug: "abc", n: 3 });
  });

  it("retries on malformed JSON then succeeds", async () => {
    createMock
      .mockResolvedValueOnce({ content: [{ type: "text", text: "not json" }] })
      .mockResolvedValueOnce({ content: [{ type: "text", text: '```json\n{"slug":"ok","n":1}\n```' }] });
    const provider = new ClaudeProvider();
    const schema = z.object({ slug: z.string(), n: z.number() });
    const out = await provider.generateJson({ prompt: "x", schema, maxRetries: 2 });
    expect(out.slug).toBe("ok");
    expect(createMock).toHaveBeenCalledTimes(2);
  });

  it("throws after exhausting retries", async () => {
    createMock.mockResolvedValue({ content: [{ type: "text", text: "still not json" }] });
    const provider = new ClaudeProvider();
    const schema = z.object({ slug: z.string() });
    await expect(provider.generateJson({ prompt: "x", schema, maxRetries: 2 })).rejects.toThrow();
    expect(createMock).toHaveBeenCalledTimes(2);
  });
});
