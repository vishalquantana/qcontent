import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID, randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import { runMigrations } from "../src/db/migrate.js";
import { makeDb } from "../src/db/client.js";
import { startServer } from "../src/api/server.js";

const URL = `file:${join(tmpdir(), `qcontent-server-test-${randomUUID()}.db`)}`;
const TOKEN = "srv-token";
let server: Server;
let port: number;

beforeAll(async () => {
  process.env.QCONTENT_MASTER_KEY = randomBytes(32).toString("base64");
  await runMigrations(URL);
  const started = await startServer({ db: makeDb(URL), token: TOKEN, port: 0 });
  server = started.server;
  port = started.port;
});

afterAll(() => {
  server.close();
});

describe("startServer", () => {
  it("serves the dashboard HTML at /", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("<!DOCTYPE html>");
    expect(html.toLowerCase()).toContain("qcontent");
  });

  it("serves health without auth and rejects unauthorized API calls", async () => {
    const h = await fetch(`http://127.0.0.1:${port}/api/health`);
    expect(h.status).toBe(200);
    const unauth = await fetch(`http://127.0.0.1:${port}/api/brands`);
    expect(unauth.status).toBe(401);
  });

  it("accepts an authorized POST and returns JSON", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/brands`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Srv", slug: "srv-brand" }),
    });
    expect(res.status).toBe(201);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = await res.json();
    expect(body.slug).toBe("srv-brand");
  });
});
