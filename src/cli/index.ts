import { Command } from "commander";
import { db } from "../db/client.js";
import { runMigrations } from "../db/migrate.js";
import { createBrand } from "../service/brands.js";
import { createSite, listSites, getSiteBySlug } from "../service/sites.js";
import { saveCredential } from "../service/credentials.js";
import { addTopic } from "../service/topics.js";
import { runJob, knownJobTypes } from "../jobs/index.js";
import { startWorker } from "../scheduler/worker.js";

// Side-effect imports register providers/adapters.
import "../providers/llm/claude.js";
import "../providers/topics/dataforseo.js";
import "../adapters/publish/webhook.js";
import "../adapters/publish/github-mdx.js";
import "../adapters/publish/wordpress.js";
import "../adapters/publish/payload.js";

const program = new Command();
program.name("qcontent").description("Multi-site content & GEO engine");

program.command("migrate").description("apply DB migrations").action(async () => {
  await runMigrations();
  console.log("migrations applied");
});

program
  .command("brand:add")
  .requiredOption("--name <name>")
  .requiredOption("--slug <slug>")
  .option("--seeds <csv>", "comma-separated seed keywords", "")
  .action(async (o) => {
    const brand = await createBrand(db, {
      name: o.name, slug: o.slug,
      seedKeywords: o.seeds ? String(o.seeds).split(",").map((s: string) => s.trim()) : [],
    });
    console.log("brand created:", brand.id);
  });

program
  .command("site:add")
  .requiredOption("--brand <brandId>")
  .requiredOption("--name <name>")
  .requiredOption("--slug <slug>")
  .requiredOption("--adapter <type>")
  .option("--base-url <url>")
  .action(async (o) => {
    const site = await createSite(db, {
      brandId: o.brand, name: o.name, slug: o.slug, adapterType: o.adapter, baseUrl: o.baseUrl,
    });
    console.log("site created:", site.id);
  });

program
  .command("creds:set")
  .requiredOption("--site <siteId>")
  .requiredOption("--integration <name>")
  .requiredOption("--json <json>", "secret payload as JSON")
  .action(async (o) => {
    await saveCredential(db, { siteId: o.site, integration: o.integration, secret: JSON.parse(o.json) });
    console.log("credential saved");
  });

program
  .command("topic:add")
  .requiredOption("--site <siteId>")
  .requiredOption("--title <title>")
  .option("--type <contentType>")
  .option("--approve", "mark approved", false)
  .option("--priority <n>", "priority", "0")
  .action(async (o) => {
    await addTopic(db, {
      siteId: o.site, title: o.title, source: "manual", contentType: o.type,
      status: o.approve ? "approved" : "pending", priority: Number(o.priority),
    });
    console.log("topic added");
  });

program.command("sites:list").action(async () => {
  for (const s of await listSites(db)) console.log(`${s.slug}\t${s.adapterType}\t${s.id}`);
});

program
  .command("run")
  .description("run a job now")
  .requiredOption("--site <slug>")
  .option("--job <type>", "job type", "generate")
  .option("--llm <provider>", "llm provider", "claude")
  .option("--type <contentType>", "content type", "guides")
  .option("--max-age-days <n>", "refresh: only posts older than N days")
  .option("--limit <n>", "max items to process")
  .action(async (o) => {
    const site = await getSiteBySlug(db, o.site);
    if (!site) throw new Error(`site not found: ${o.site}`);
    if (!knownJobTypes().includes(o.job)) throw new Error(`unknown job type '${o.job}'. Known: ${knownJobTypes().join(", ")}`);
    const result = await runJob(db, o.job, {
      siteId: site.id,
      llmProvider: o.llm,
      contentType: o.type,
      ...(o.maxAgeDays ? { maxAgeDays: Number(o.maxAgeDays) } : {}),
      ...(o.limit ? { limit: Number(o.limit) } : {}),
    });
    console.log(JSON.stringify(result, null, 2));
    if (result.status === "failed") process.exit(1);
  });

program.command("worker").description("start the scheduler worker").action(async () => {
  await startWorker();
});

program.parseAsync();
