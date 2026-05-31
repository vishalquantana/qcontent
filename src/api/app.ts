import "../adapters/publish/webhook.js";
import "../adapters/publish/github-mdx.js";
import "../adapters/publish/wordpress.js";
import "../adapters/publish/payload.js";

import type { DB } from "../db/client.js";
import { Router } from "./router.js";
import { json, error, type ApiResponse } from "./json.js";
import { createBrand, listBrands } from "../service/brands.js";
import { createSite, listSites, getSite } from "../service/sites.js";
import { addTopic } from "../service/topics.js";
import { saveCredential } from "../service/credentials.js";
import { getPublishedForSite } from "../service/published.js";
import { listRuns, getRun, getRunLogs } from "../service/runs.js";
import { runJob, knownJobTypes } from "../jobs/index.js";

export interface App {
  handle(
    method: string,
    path: string,
    headers: Record<string, string | undefined>,
    bodyText: string,
  ): Promise<ApiResponse>;
}

function parseJson(bodyText: string): Record<string, unknown> {
  if (!bodyText.trim()) return {};
  return JSON.parse(bodyText) as Record<string, unknown>;
}

export function createApp(db: DB, token: string | undefined): App {
  const router = new Router();

  router.add("GET", "/api/health", async () => json(200, { ok: true }));

  router.add("GET", "/api/brands", async () => json(200, await listBrands(db)));
  router.add("POST", "/api/brands", async (_h, _p, body) => {
    const b = parseJson(body);
    if (!b.name || !b.slug) return error(400, "name and slug are required");
    const brand = await createBrand(db, {
      name: String(b.name),
      slug: String(b.slug),
      seedKeywords: Array.isArray(b.seedKeywords) ? (b.seedKeywords as string[]) : [],
    });
    return json(201, brand);
  });

  router.add("GET", "/api/sites", async () => json(200, await listSites(db)));
  router.add("POST", "/api/sites", async (_h, _p, body) => {
    const b = parseJson(body);
    if (!b.brandId || !b.name || !b.slug || !b.adapterType) {
      return error(400, "brandId, name, slug, adapterType are required");
    }
    const site = await createSite(db, {
      brandId: String(b.brandId),
      name: String(b.name),
      slug: String(b.slug),
      adapterType: String(b.adapterType),
      baseUrl: b.baseUrl ? String(b.baseUrl) : undefined,
      ...(b.adapterConfig ? { adapterConfig: b.adapterConfig as Record<string, unknown> } : {}),
      ...(b.contentTypes ? { contentTypes: b.contentTypes as Record<string, unknown> } : {}),
    });
    return json(201, site);
  });

  router.add("GET", "/api/sites/:id/published", async (_h, p) => {
    const site = await getSite(db, p.id!);
    if (!site) return error(404, "site not found");
    return json(200, await getPublishedForSite(db, p.id!));
  });

  router.add("POST", "/api/sites/:id/topics", async (_h, p, body) => {
    const site = await getSite(db, p.id!);
    if (!site) return error(404, "site not found");
    const b = parseJson(body);
    if (!b.title) return error(400, "title is required");
    const topic = await addTopic(db, {
      siteId: p.id!,
      title: String(b.title),
      source: "manual",
      contentType: b.contentType ? String(b.contentType) : undefined,
      status: b.approve ? "approved" : "pending",
      priority: typeof b.priority === "number" ? b.priority : 0,
    });
    return json(201, topic);
  });

  router.add("POST", "/api/sites/:id/credentials", async (_h, p, body) => {
    const site = await getSite(db, p.id!);
    if (!site) return error(404, "site not found");
    const b = parseJson(body);
    if (!b.integration || !b.secret) return error(400, "integration and secret are required");
    await saveCredential(db, { siteId: p.id!, integration: String(b.integration), secret: b.secret });
    return json(201, { ok: true });
  });

  router.add("POST", "/api/sites/:id/run", async (_h, p, body) => {
    const site = await getSite(db, p.id!);
    if (!site) return error(404, "site not found");
    const b = parseJson(body);
    const jobType = b.job ? String(b.job) : "generate";
    if (!knownJobTypes().includes(jobType)) return error(400, `unknown job '${jobType}'`);
    const result = await runJob(db, jobType, {
      siteId: p.id!,
      ...(b.llmProvider ? { llmProvider: String(b.llmProvider) } : {}),
      ...(b.contentType ? { contentType: String(b.contentType) } : {}),
      ...(typeof b.maxAgeDays === "number" ? { maxAgeDays: b.maxAgeDays } : {}),
      ...(typeof b.limit === "number" ? { limit: b.limit } : {}),
    });
    return json(200, result);
  });

  router.add("GET", "/api/runs", async () => json(200, await listRuns(db, {})));

  router.add("GET", "/api/runs/:id", async (_h, p) => {
    const run = await getRun(db, p.id!);
    if (!run) return error(404, "run not found");
    const logs = await getRunLogs(db, p.id!);
    return json(200, { run, logs });
  });

  async function handle(
    method: string,
    path: string,
    headers: Record<string, string | undefined>,
    bodyText: string,
  ): Promise<ApiResponse> {
    try {
      const pathOnly = path.split("?")[0]!;
      const isApi = pathOnly.startsWith("/api/");
      const isHealth = pathOnly === "/api/health" || pathOnly === "/api/health/";
      if (isApi && !isHealth) {
        const provided = (headers.authorization ?? headers.Authorization ?? "").replace(/^Bearer\s+/i, "");
        if (!token || provided !== token) return error(401, "unauthorized");
      }

      // GET /api/runs supports ?siteId= and ?limit= (router strips the query string).
      if (method.toUpperCase() === "GET" && (pathOnly === "/api/runs" || pathOnly === "/api/runs/")) {
        const qs = new URLSearchParams(path.includes("?") ? path.slice(path.indexOf("?") + 1) : "");
        const siteId = qs.get("siteId") ?? undefined;
        const limit = qs.get("limit") ? Number(qs.get("limit")) : undefined;
        return json(200, await listRuns(db, { ...(siteId ? { siteId } : {}), ...(limit ? { limit } : {}) }));
      }

      const m = router.match(method, path);
      if (!m) return error(404, "not found");
      return await m.handler(headers, m.params, bodyText);
    } catch (err) {
      if (err instanceof SyntaxError) return error(400, `invalid JSON: ${err.message}`);
      const message = err instanceof Error ? err.message : String(err);
      return error(500, message);
    }
  }

  return { handle };
}
