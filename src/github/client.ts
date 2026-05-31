const API = "https://api.github.com";

export interface PutFileArgs {
  owner: string;
  repo: string;
  path: string;
  message: string;
  content: string; // raw UTF-8; encoded to base64 internally
  branch: string;
  sha?: string; // required by GitHub when updating an existing file
}

export interface PutFileResult {
  commitSha: string;
  contentSha: string;
}

export interface GetFileResult {
  sha: string;
  content: string; // decoded UTF-8
}

export class GitHubClient {
  constructor(private token: string) {}

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      "User-Agent": "qcontent",
    };
  }

  async getFile(owner: string, repo: string, path: string, ref: string): Promise<GetFileResult | null> {
    const url = `${API}/repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(ref)}`;
    const res = await fetch(url, { headers: this.headers() });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`github getFile ${res.status}: ${await res.text().catch(() => "")}`);
    const body = (await res.json()) as { sha: string; content: string; encoding: string };
    const content = Buffer.from(body.content, "base64").toString("utf8");
    return { sha: body.sha, content };
  }

  async putFile(args: PutFileArgs): Promise<PutFileResult> {
    const url = `${API}/repos/${args.owner}/${args.repo}/contents/${args.path}`;
    const payload: Record<string, unknown> = {
      message: args.message,
      content: Buffer.from(args.content, "utf8").toString("base64"),
      branch: args.branch,
    };
    if (args.sha) payload.sha = args.sha;
    const res = await fetch(url, { method: "PUT", headers: this.headers(), body: JSON.stringify(payload) });
    if (!res.ok) throw new Error(`github putFile ${res.status}: ${await res.text().catch(() => "")}`);
    const body = (await res.json()) as { commit: { sha: string }; content: { sha: string } };
    return { commitSha: body.commit.sha, contentSha: body.content.sha };
  }

  async getBranchHeadSha(owner: string, repo: string, branch: string): Promise<string> {
    const url = `${API}/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`;
    const res = await fetch(url, { headers: this.headers() });
    if (!res.ok) throw new Error(`github getRef ${res.status}: ${await res.text().catch(() => "")}`);
    const body = (await res.json()) as { object: { sha: string } };
    return body.object.sha;
  }

  async createBranch(owner: string, repo: string, branch: string, fromSha: string): Promise<void> {
    const url = `${API}/repos/${owner}/${repo}/git/refs`;
    const res = await fetch(url, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: fromSha }),
    });
    if (!res.ok) throw new Error(`github createBranch ${res.status}: ${await res.text().catch(() => "")}`);
  }

  async openPullRequest(args: {
    owner: string; repo: string; head: string; base: string; title: string; body: string;
  }): Promise<string> {
    const url = `${API}/repos/${args.owner}/${args.repo}/pulls`;
    const res = await fetch(url, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ title: args.title, head: args.head, base: args.base, body: args.body }),
    });
    if (!res.ok) throw new Error(`github openPR ${res.status}: ${await res.text().catch(() => "")}`);
    const body = (await res.json()) as { html_url: string };
    return body.html_url;
  }
}
