import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { env } from "../env.js";
import * as schema from "./schema.js";

export function makeDb(url = env.tursoUrl, authToken = env.tursoToken) {
  const client = createClient({ url, authToken });
  return drizzle(client, { schema });
}

export const db = makeDb();
export type DB = ReturnType<typeof makeDb>;
