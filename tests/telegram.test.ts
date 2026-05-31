import { describe, it, expect, vi, beforeEach } from "vitest";
import { sendTelegram, notifyPublished, notifyFailure } from "../src/adapters/notify/telegram.js";

beforeEach(() => vi.unstubAllGlobals());

const creds = { botToken: "BOT", chatId: "123" };

describe("sendTelegram", () => {
  it("skips when creds are absent", async () => {
    const out = await sendTelegram(null, "hi");
    expect(out).toEqual({ sent: false, skipped: true });
  });

  it("POSTs to the bot sendMessage endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);
    const out = await sendTelegram(creds, "<b>hello</b>");
    expect(out).toEqual({ sent: true, skipped: false });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.telegram.org/botBOT/sendMessage");
    const sent = JSON.parse((init as RequestInit).body as string);
    expect(sent).toMatchObject({ chat_id: "123", text: "<b>hello</b>", parse_mode: "HTML" });
  });

  it("never throws when the network call fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));
    const out = await sendTelegram(creds, "x");
    expect(out).toEqual({ sent: false, skipped: false });
  });
});

describe("message builders", () => {
  it("notifyPublished includes title and url", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);
    await notifyPublished(creds, { title: "My Post", url: "https://x/y", type: "guides" });
    const text = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string).text as string;
    expect(text).toContain("My Post");
    expect(text).toContain("https://x/y");
  });

  it("notifyFailure includes the error", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);
    await notifyFailure(creds, { site: "ladya", jobType: "generate", error: "boom" });
    const text = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string).text as string;
    expect(text).toContain("boom");
  });
});
