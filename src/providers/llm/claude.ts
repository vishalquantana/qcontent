import Anthropic from "@anthropic-ai/sdk";
import type { GenerateJsonOpts, LLMProvider } from "./index.js";
import { parseJsonLoose, registerLLMProvider } from "./index.js";
import { env } from "../../env.js";

export class ClaudeProvider implements LLMProvider {
  readonly name = "claude";
  private client: Anthropic;
  private defaultModel: string;

  constructor(model = "claude-sonnet-4-6") {
    this.client = new Anthropic({ apiKey: env.anthropicKey ?? "" });
    this.defaultModel = model;
  }

  async generateJson<T>(opts: GenerateJsonOpts<T>): Promise<T> {
    const maxRetries = opts.maxRetries ?? 3;
    let lastErr: unknown;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const res = await this.client.messages.create({
          model: opts.model ?? this.defaultModel,
          max_tokens: 8000,
          system: opts.system ?? "You output only valid JSON matching the requested schema. No prose.",
          messages: [{ role: "user", content: opts.prompt }],
        });
        const block = (res.content ?? []).find((b: { type: string }) => b.type === "text") as
          | { type: "text"; text: string }
          | undefined;
        if (!block) throw new Error("no text block in response");
        const parsed = parseJsonLoose(block.text);
        return opts.schema.parse(parsed);
      } catch (err) {
        lastErr = err;
        if (attempt < maxRetries) await sleep(500 * attempt);
      }
    }
    throw new Error(`ClaudeProvider.generateJson failed after ${maxRetries} attempts: ${String(lastErr)}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

registerLLMProvider("claude", () => new ClaudeProvider());
