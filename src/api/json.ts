import type { IncomingMessage } from "node:http";

export interface ApiResponse {
  status: number;
  body: unknown;
}

export function json(status: number, body: unknown): ApiResponse {
  return { status, body };
}

export function error(status: number, message: string): ApiResponse {
  return { status, body: { error: message } };
}

/** Read a request body stream to a string (utf8). */
export function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}
