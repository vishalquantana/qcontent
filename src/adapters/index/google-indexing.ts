import { importPKCS8, SignJWT } from "jose";

export interface ServiceAccount {
  client_email: string;
  private_key: string;
}

export interface IndexingResult {
  skipped: boolean;
  submitted?: boolean;
  pinged?: boolean;
}

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const PUBLISH_URL = "https://indexing.googleapis.com/v3/urlNotifications:publish";
const SCOPE = "https://www.googleapis.com/auth/indexing";

async function getAccessToken(sa: ServiceAccount): Promise<string> {
  const key = await importPKCS8(sa.private_key, "RS256");
  const assertion = await new SignJWT({ scope: SCOPE })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuedAt()
    .setIssuer(sa.client_email)
    .setSubject(sa.client_email)
    .setAudience(TOKEN_URL)
    .setExpirationTime("1h")
    .sign(key);

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }).toString(),
  });
  if (!res.ok) throw new Error(`google token ${res.status}: ${await res.text().catch(() => "")}`);
  const body = (await res.json()) as { access_token: string };
  return body.access_token;
}

export async function runIndexing(
  sa: ServiceAccount | null | undefined,
  url: string,
  sitemapUrl?: string,
): Promise<IndexingResult> {
  if (!sa || !sa.client_email || !sa.private_key) return { skipped: true };
  const token = await getAccessToken(sa);

  let submitted = false;
  try {
    const res = await fetch(PUBLISH_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ url, type: "URL_UPDATED" }),
    });
    submitted = res.ok;
  } catch {
    submitted = false;
  }

  let pinged = false;
  if (sitemapUrl) {
    try {
      const ping = `https://www.google.com/ping?sitemap=${encodeURIComponent(sitemapUrl)}`;
      const res = await fetch(ping);
      pinged = res.ok;
    } catch {
      pinged = false;
    }
  }

  return { skipped: false, submitted, pinged };
}
