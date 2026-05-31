import { describe, it, expect, vi, beforeEach } from "vitest";
import { DataForSeoSource } from "../src/providers/topics/dataforseo.js";

beforeEach(() => {
  process.env.DATAFORSEO_LOGIN = "u";
  process.env.DATAFORSEO_PASSWORD = "p";
});

describe("DataForSeoSource", () => {
  it("returns a PAA question from the SERP response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        tasks: [{ result: [{ items: [
          { type: "people_also_ask", title: "How to reduce Blinkit ad waste?" },
        ] }] }],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const src = new DataForSeoSource(() => "blinkit ads", () => 0.0); // force PAA branch
    const out = await src.discover(
      { id: "s", brandId: "b", name: "S", slug: "s", adapterType: "webhook" } as never,
      { id: "b", name: "B", slug: "b", seedKeywords: ["blinkit ads"] } as never,
    );
    expect(out.topic).toContain("Blinkit");
  });
});
