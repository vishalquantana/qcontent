import { describe, it, expect } from "vitest";
import { Router } from "../src/api/router.js";

describe("Router", () => {
  it("matches a static route and returns its handler result", async () => {
    const r = new Router();
    r.add("GET", "/api/sites", async () => ({ status: 200, body: { ok: true } }));
    const m = r.match("GET", "/api/sites");
    expect(m).not.toBeNull();
    const res = await m!.handler({}, m!.params, "");
    expect(res).toEqual({ status: 200, body: { ok: true } });
  });

  it("extracts path params", () => {
    const r = new Router();
    r.add("GET", "/api/sites/:id/runs", async () => ({ status: 200, body: {} }));
    const m = r.match("GET", "/api/sites/abc123/runs");
    expect(m).not.toBeNull();
    expect(m!.params).toEqual({ id: "abc123" });
  });

  it("does not match a different method", () => {
    const r = new Router();
    r.add("POST", "/api/topics", async () => ({ status: 201, body: {} }));
    expect(r.match("GET", "/api/topics")).toBeNull();
  });

  it("does not match a different path shape", () => {
    const r = new Router();
    r.add("GET", "/api/sites/:id", async () => ({ status: 200, body: {} }));
    expect(r.match("GET", "/api/sites/abc/extra")).toBeNull();
  });

  it("ignores a trailing slash and query string when matching", () => {
    const r = new Router();
    r.add("GET", "/api/runs", async () => ({ status: 200, body: {} }));
    expect(r.match("GET", "/api/runs/")).not.toBeNull();
    expect(r.match("GET", "/api/runs?limit=10")).not.toBeNull();
  });
});
