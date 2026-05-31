import "dotenv/config";

function opt(name: string): string | undefined {
  const v = process.env[name];
  return v && v.length > 0 ? v : undefined;
}

export const env = {
  masterKey: opt("QCONTENT_MASTER_KEY"),
  tursoUrl: opt("TURSO_DATABASE_URL") ?? "file:local.db",
  tursoToken: opt("TURSO_AUTH_TOKEN"),
  anthropicKey: opt("ANTHROPIC_API_KEY"),
  dataforseoLogin: opt("DATAFORSEO_LOGIN"),
  dataforseoPassword: opt("DATAFORSEO_PASSWORD"),
};

export function requireMasterKey(): Buffer {
  const key = process.env.QCONTENT_MASTER_KEY ?? env.masterKey;
  if (!key) throw new Error("QCONTENT_MASTER_KEY is required");
  const buf = Buffer.from(key, "base64");
  if (buf.length !== 32) throw new Error("QCONTENT_MASTER_KEY must be base64 of 32 bytes (AES-256)");
  return buf;
}
