import { randomUUID } from "node:crypto";
import { eq, isNull, and } from "drizzle-orm";
import { credentials } from "../db/schema.js";
import { encryptSecret, decryptSecret } from "../config/crypto.js";
import type { DB } from "../db/client.js";

export interface CredentialInput {
  siteId?: string | null;
  integration: string;
  secret: unknown;
}

export async function saveCredential(db: DB, input: CredentialInput): Promise<void> {
  const { ciphertext, iv, authTag } = encryptSecret(input.secret);
  await db.insert(credentials).values({
    id: randomUUID(),
    siteId: input.siteId ?? null,
    integration: input.integration,
    ciphertext,
    iv,
    authTag,
  });
}

export async function getCredential<T = unknown>(
  db: DB,
  siteId: string | null,
  integration: string,
): Promise<T | null> {
  const query =
    siteId === null
      ? and(isNull(credentials.siteId), eq(credentials.integration, integration))
      : and(eq(credentials.siteId, siteId), eq(credentials.integration, integration));

  const row = await db.query.credentials.findFirst({
    where: query,
  });

  if (!row) return null;

  return decryptSecret<T>({
    ciphertext: row.ciphertext,
    iv: row.iv,
    authTag: row.authTag,
  });
}
