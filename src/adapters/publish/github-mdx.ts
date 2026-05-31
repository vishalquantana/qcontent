import type { Article } from "../../domain/article.js";
import type { Site } from "../../service/sites.js";
import type { PublishAdapter, PublishResult } from "./index.js";
import { registerPublishAdapter } from "./index.js";
import { GitHubClient } from "../../github/client.js";
import { articleToMdx, manifestEntry, mdxPath } from "./mdx-format.js";

interface GitHubMdxConfig {
  owner?: string;
  repo?: string;
  branch?: string;
  basePath?: string;
  type?: string;
  prMode?: boolean;
}

export class GitHubMdxAdapter implements PublishAdapter {
  readonly type = "github-mdx";

  async publish(article: Article, site: Site, creds: Record<string, unknown>): Promise<PublishResult> {
    const token = creds.token as string | undefined;
    if (!token) throw new Error("github-mdx adapter: missing 'token' credential");

    const cfg = (site.adapterConfig ?? {}) as GitHubMdxConfig;
    if (!cfg.owner || !cfg.repo) throw new Error("github-mdx adapter: adapterConfig.owner and .repo are required");
    const branch = cfg.branch ?? "main";
    const basePath = cfg.basePath ?? "content";
    const type = cfg.type ?? "guides";
    const gh = new GitHubClient(token);

    const mdx = articleToMdx(article);
    const filePath = mdxPath(article.slug, type, basePath);
    const manifestPath = `${basePath}/manifest.json`;

    let targetBranch = branch;
    let prUrl: string | undefined;
    if (cfg.prMode) {
      const headSha = await gh.getBranchHeadSha(cfg.owner, cfg.repo, branch);
      targetBranch = `qcontent/${article.slug}`;
      await gh.createBranch(cfg.owner, cfg.repo, targetBranch, headSha);
    }

    const mdxRes = await gh.putFile({
      owner: cfg.owner, repo: cfg.repo, path: filePath,
      message: `content: add "${article.title}"`, content: mdx, branch: targetBranch,
    });

    const existing = await gh.getFile(cfg.owner, cfg.repo, manifestPath, targetBranch);
    const manifest: Record<string, unknown> = existing ? safeParse(existing.content) : {};
    manifest[article.slug] = manifestEntry(article, type, basePath);
    await gh.putFile({
      owner: cfg.owner, repo: cfg.repo, path: manifestPath,
      message: `content: register "${article.slug}" in manifest`,
      content: JSON.stringify(manifest, null, 2) + "\n",
      branch: targetBranch,
      ...(existing ? { sha: existing.sha } : {}),
    });

    if (cfg.prMode) {
      prUrl = await gh.openPullRequest({
        owner: cfg.owner, repo: cfg.repo, head: targetBranch, base: branch,
        title: `content: add "${article.title}"`,
        body: `Automated content addition for \`${article.slug}\`.`,
      });
    }

    const url = site.baseUrl
      ? `${site.baseUrl.replace(/\/$/, "")}/${type}/${article.slug}`
      : article.slug;
    return { url, ref: { commitSha: mdxRes.commitSha, path: filePath, branch: targetBranch, prUrl } };
  }

  async update(article: Article, ref: unknown, site: Site, creds: Record<string, unknown>): Promise<PublishResult> {
    const token = creds.token as string | undefined;
    if (!token) throw new Error("github-mdx adapter: missing 'token' credential");
    const cfg = (site.adapterConfig ?? {}) as GitHubMdxConfig;
    if (!cfg.owner || !cfg.repo) throw new Error("github-mdx adapter: adapterConfig.owner and .repo are required");
    const r = (ref ?? {}) as { path?: string; branch?: string };
    const branch = r.branch ?? cfg.branch ?? "main";
    const basePath = cfg.basePath ?? "content";
    const type = cfg.type ?? "guides";
    const filePath = r.path ?? mdxPath(article.slug, type, basePath);
    const gh = new GitHubClient(token);

    const existing = await gh.getFile(cfg.owner, cfg.repo, filePath, branch);
    const res = await gh.putFile({
      owner: cfg.owner, repo: cfg.repo, path: filePath,
      message: `content: update "${article.title}"`, content: articleToMdx(article), branch,
      ...(existing ? { sha: existing.sha } : {}),
    });
    const url = site.baseUrl ? `${site.baseUrl.replace(/\/$/, "")}/${type}/${article.slug}` : article.slug;
    return { url, ref: { commitSha: res.commitSha, path: filePath, branch } };
  }
}

function safeParse(s: string): Record<string, unknown> {
  try {
    const v = JSON.parse(s);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

registerPublishAdapter("github-mdx", () => new GitHubMdxAdapter());
