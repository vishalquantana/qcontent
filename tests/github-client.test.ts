import { describe, it, expect, vi, beforeEach } from "vitest";
import { GitHubClient } from "../src/github/client.js";

beforeEach(() => vi.unstubAllGlobals());

describe("GitHubClient.getFile", () => {
  it("returns content + sha when the file exists", async () => {
    const body = { sha: "abc123", content: Buffer.from("hello", "utf8").toString("base64"), encoding: "base64" };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body }));
    const gh = new GitHubClient("tok");
    const out = await gh.getFile("o", "r", "content/manifest.json", "main");
    expect(out).toEqual({ sha: "abc123", content: "hello" });
  });

  it("returns null on 404", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404, text: async () => "Not Found" }));
    const gh = new GitHubClient("tok");
    expect(await gh.getFile("o", "r", "missing.json", "main")).toBeNull();
  });
});

describe("GitHubClient.putFile", () => {
  it("PUTs base64 content with the auth header and returns the commit sha", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 201, json: async () => ({ commit: { sha: "deadbeef" }, content: { sha: "blobsha" } }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const gh = new GitHubClient("tok");
    const res = await gh.putFile({
      owner: "o", repo: "r", path: "content/guides/x.mdx", message: "add x",
      content: "# hi", branch: "main",
    });
    expect(res).toEqual({ commitSha: "deadbeef", contentSha: "blobsha" });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.github.com/repos/o/r/contents/content/guides/x.mdx");
    expect((init as RequestInit).method).toBe("PUT");
    expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer tok" });
    const sent = JSON.parse((init as RequestInit).body as string);
    expect(Buffer.from(sent.content, "base64").toString("utf8")).toBe("# hi");
    expect(sent.branch).toBe("main");
  });

  it("includes the existing sha when updating", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ commit: { sha: "c2" }, content: { sha: "b2" } }) });
    vi.stubGlobal("fetch", fetchMock);
    const gh = new GitHubClient("tok");
    await gh.putFile({ owner: "o", repo: "r", path: "p", message: "m", content: "c", branch: "main", sha: "old" });
    const sent = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(sent.sha).toBe("old");
  });

  it("throws on a non-ok PUT", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 422, text: async () => "bad" }));
    const gh = new GitHubClient("tok");
    await expect(
      gh.putFile({ owner: "o", repo: "r", path: "p", message: "m", content: "c", branch: "main" }),
    ).rejects.toThrow();
  });
});
