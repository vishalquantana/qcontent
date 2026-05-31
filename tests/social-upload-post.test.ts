import { describe, it, expect, vi, beforeEach } from "vitest";
import { deliverCarousel } from "../src/adapters/social/upload-post.js";

beforeEach(() => vi.unstubAllGlobals());

const images = [Buffer.from("png-a"), Buffer.from("png-b")];
const caption = "How to cut Blinkit ad waste";
const hashtags = ["#blinkit", "#qcommerce"];

describe("deliverCarousel", () => {
  it("skips when no creds", async () => {
    const out = await deliverCarousel(null, images, caption, hashtags);
    expect(out).toEqual({ delivered: false, skipped: true });
  });

  it("returns delivered:false (not thrown) when there are no images", async () => {
    const out = await deliverCarousel({ apiKey: "K", user: "ladya" }, [], caption, hashtags);
    expect(out).toEqual({ delivered: false, skipped: false, reason: "no images to post" });
  });

  it("posts PNG buffers to Upload-Post with the apikey header and combined description", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: true, request_id: "rq" }) });
    vi.stubGlobal("fetch", fetchMock);
    const out = await deliverCarousel({ apiKey: "K", user: "ladya" }, images, caption, hashtags);
    expect(out).toMatchObject({ delivered: true, skipped: false, requestId: "rq" });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.upload-post.com/api/upload_photos");
    expect((init as RequestInit).headers).toMatchObject({ Authorization: "Apikey K" });
    expect((init as RequestInit).body).toBeInstanceOf(FormData);
    const form = (init as RequestInit).body as FormData;
    expect(form.getAll("photos[]")).toHaveLength(2);
    expect(form.get("user")).toBe("ladya");
    expect((form.get("description") as string)).toContain("#blinkit");
  });

  it("throws on a non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => "boom" }));
    await expect(deliverCarousel({ apiKey: "K", user: "ladya" }, images, caption, hashtags)).rejects.toThrow();
  });
});
