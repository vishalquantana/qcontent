import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { DB } from "../db/client.js";
import { createApp } from "./app.js";
import { readBody } from "./json.js";

const HERE = dirname(fileURLToPath(import.meta.url));

export interface StartServerOpts {
  db: DB;
  token: string | undefined;
  port?: number;
  host?: string;
}

export interface StartedServer {
  server: Server;
  port: number;
}

export async function startServer(opts: StartServerOpts): Promise<StartedServer> {
  const app = createApp(opts.db, opts.token);
  const dashboard = await readFile(join(HERE, "dashboard.html"), "utf8");

  const server = createServer((req, res) => {
    void (async () => {
      const url = req.url ?? "/";
      const method = req.method ?? "GET";
      const pathOnly = url.split("?")[0];

      if (method === "GET" && (pathOnly === "/" || pathOnly === "/index.html")) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(dashboard);
        return;
      }

      const bodyText = method === "GET" || method === "HEAD" ? "" : await readBody(req);
      const headers: Record<string, string | undefined> = {};
      for (const [k, v] of Object.entries(req.headers)) headers[k] = Array.isArray(v) ? v[0] : v;

      const result = await app.handle(method, url, headers, bodyText);
      res.writeHead(result.status, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(result.body));
    })();
  });

  const port = await new Promise<number>((resolve) => {
    server.listen(opts.port ?? 8787, opts.host ?? "127.0.0.1", () => {
      const addr = server.address();
      resolve(typeof addr === "object" && addr ? addr.port : (opts.port ?? 8787));
    });
  });

  return { server, port };
}
