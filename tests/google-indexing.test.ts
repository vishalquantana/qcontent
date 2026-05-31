import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("jose", () => ({
  importPKCS8: vi.fn().mockResolvedValue({ fake: "key" }),
  SignJWT: class {
    setProtectedHeader() { return this; }
    setIssuedAt() { return this; }
    setIssuer() { return this; }
    setSubject() { return this; }
    setAudience() { return this; }
    setExpirationTime() { return this; }
    setClaim() { return this; }
    async sign() { return "signed.jwt.token"; }
  },
}));

import { runIndexing } from "../src/adapters/index/google-indexing.js";

const creds = {
  client_email: "svc@proj.iam.gserviceaccount.com",
  private_key: "-----BEGIN PRIVATE KEY-----\nMIIfake\n-----END PRIVATE KEY-----\n",
};

beforeEach(() => vi.unstubAllGlobals());

describe("runIndexing", () => {
  it("skips when creds are null", async () => {
    const out = await runIndexing(null, "https://x/y");
    expect(out).toEqual({ skipped: true });
  });

  it("gets a token then publishes the URL, then pings the sitemap", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ access_token: "at-123" }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ urlNotificationMetadata: {} }) })
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => "OK" });
    vi.stubGlobal("fetch", fetchMock);

    const out = await runIndexing(creds, "https://x/y", "https://x/sitemap.xml");
    expect(out).toMatchObject({ skipped: false, submitted: true });

    expect(fetchMock.mock.calls[0]![0]).toBe("https://oauth2.googleapis.com/token");
    const [pubUrl, pubInit] = fetchMock.mock.calls[1]!;
    expect(pubUrl).toBe("https://indexing.googleapis.com/v3/urlNotifications:publish");
    expect((pubInit as RequestInit).headers).toMatchObject({ Authorization: "Bearer at-123" });
    expect(JSON.parse((pubInit as RequestInit).body as string)).toEqual({ url: "https://x/y", type: "URL_UPDATED" });
  });

  it("does not throw if the publish call fails (returns submitted:false)", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ access_token: "at" }) })
      .mockResolvedValueOnce({ ok: false, status: 403, text: async () => "denied" });
    vi.stubGlobal("fetch", fetchMock);
    const out = await runIndexing(creds, "https://x/y");
    expect(out).toMatchObject({ skipped: false, submitted: false });
  });
});
