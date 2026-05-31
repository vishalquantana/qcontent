import { describe, it, expect, beforeAll } from "vitest";
import { randomBytes } from "node:crypto";
import { encryptSecret, decryptSecret } from "../src/config/crypto.js";

beforeAll(() => {
  process.env.QCONTENT_MASTER_KEY = randomBytes(32).toString("base64");
});

describe("crypto", () => {
  it("round-trips a JSON payload", () => {
    const payload = { apiKey: "sk-test-123", nested: { a: 1 } };
    const blob = encryptSecret(payload);
    expect(blob.ciphertext).toBeTypeOf("string");
    expect(blob.iv).toBeTypeOf("string");
    expect(blob.authTag).toBeTypeOf("string");
    const out = decryptSecret(blob);
    expect(out).toEqual(payload);
  });

  it("fails to decrypt tampered ciphertext", () => {
    const blob = encryptSecret({ x: 1 });
    const tampered = { ...blob, ciphertext: Buffer.from("garbage").toString("base64") };
    expect(() => decryptSecret(tampered)).toThrow();
  });
});
