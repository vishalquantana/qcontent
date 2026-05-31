import type { ApiResponse } from "./json.js";

export type RouteHandler = (
  headers: Record<string, string | undefined>,
  params: Record<string, string>,
  bodyText: string,
) => Promise<ApiResponse>;

interface Route {
  method: string;
  segments: string[]; // path split on "/", entries beginning ":" are params
  handler: RouteHandler;
}

export interface RouteMatch {
  handler: RouteHandler;
  params: Record<string, string>;
}

function splitPath(path: string): string[] {
  const noQuery = path.split("?")[0]!;
  return noQuery.split("/").filter((s) => s.length > 0);
}

export class Router {
  private routes: Route[] = [];

  add(method: string, pattern: string, handler: RouteHandler): void {
    this.routes.push({ method: method.toUpperCase(), segments: splitPath(pattern), handler });
  }

  match(method: string, path: string): RouteMatch | null {
    const reqSegments = splitPath(path);
    for (const route of this.routes) {
      if (route.method !== method.toUpperCase()) continue;
      if (route.segments.length !== reqSegments.length) continue;
      const params: Record<string, string> = {};
      let ok = true;
      for (let i = 0; i < route.segments.length; i++) {
        const rs = route.segments[i]!;
        const ps = reqSegments[i]!;
        if (rs.startsWith(":")) {
          params[rs.slice(1)] = decodeURIComponent(ps);
        } else if (rs !== ps) {
          ok = false;
          break;
        }
      }
      if (ok) return { handler: route.handler, params };
    }
    return null;
  }
}
