import type { ZodSchema } from "zod";

export interface GenerateJsonOpts<T> {
  prompt: string;
  schema: ZodSchema<T>;
  model?: string;
  maxRetries?: number;
  system?: string;
}

export interface LLMProvider {
  readonly name: string;
  generateJson<T>(opts: GenerateJsonOpts<T>): Promise<T>;
}

const registry = new Map<string, () => LLMProvider>();

export function registerLLMProvider(name: string, factory: () => LLMProvider): void {
  registry.set(name, factory);
}

export function getLLMProvider(name: string): LLMProvider {
  const factory = registry.get(name);
  if (!factory) throw new Error(`unknown LLM provider: ${name}`);
  return factory();
}

/** Strips ```json fences and parses. Throws if not valid JSON. */
export function parseJsonLoose(text: string): unknown {
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1]!.trim();
  return JSON.parse(t);
}
