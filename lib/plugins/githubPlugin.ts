/**
 * GitHub (read-only) plugin.
 * Uses the GitHub REST API via raw fetch (no dependency) with a classic PAT.
 * All tools use hasCustomExecution (live API queries, nothing indexed).
 */

import type {
  DataSourceCapabilities,
  DataSourcePlugin,
  MetadataField,
  QueryParams,
  ScanResult,
  ToolDefinition,
} from "../dataSourceRegistry";
import prisma from "../prisma";
import type { SearchResult } from "../retrieval";

const GITHUB_API = "https://api.github.com";
const USER_AGENT = "rob-rag";

/**
 * Optional flag on the PR-list tools. Age + author are always shown (free — they
 * come back in the search payload); files/lines require one extra API call per
 * PR, so they're opt-in and the agent sets this when the user asks about size.
 */
const CHANGE_STATS_PARAM = {
  name: "includeChangeStats",
  type: "boolean",
  required: false,
  description:
    "When true, also fetch and show files changed and lines added/removed for each PR (one extra API call per PR). Set this when the user asks about the size of PRs, files touched, or lines changed.",
} as const;

interface GithubConfig {
  token: string;
}

export class GithubPlugin implements DataSourcePlugin {
  name = "github";
  displayName = "GitHub";

  capabilities: DataSourceCapabilities = {
    supportsMetadataQuery: false,
    supportsSemanticSearch: false,
    supportsScanning: false,
    requiresAuthentication: true,
  };

  // Cache the resolved login for the current token so we don't hit /user every call.
  private cachedLogin: string | null = null;
  private cachedLoginToken: string | null = null;

  getMetadataSchema(): MetadataField[] {
    return [];
  }

  async queryByMetadata(_params: QueryParams): Promise<SearchResult[]> {
    return [];
  }

  getAvailableTools(): ToolDefinition[] {
    return [
      {
        name: "github_assigned",
        description:
          "List open GitHub issues and pull requests assigned to you. Each item shows how long it has been open and its author. Use for questions like 'what's assigned to me on GitHub' or 'what do I need to work on'.",
        parameters: [CHANGE_STATS_PARAM],
        hasCustomExecution: true,
      },
      {
        name: "github_my_prs",
        description:
          "List your own open pull requests (PRs you authored that are still open). Each item shows how long it has been open and its author.",
        parameters: [CHANGE_STATS_PARAM],
        hasCustomExecution: true,
      },
      {
        name: "github_review_requests",
        description:
          "List open pull requests where your review has been requested (PRs waiting on you to review). Each item shows how long it has been open and its author.",
        parameters: [CHANGE_STATS_PARAM],
        hasCustomExecution: true,
      },
      {
        name: "github_list_repos",
        description:
          "List your GitHub repositories (most recently updated first). Optionally filter by a keyword matched against the repo name/description.",
        parameters: [
          {
            name: "filter",
            type: "string",
            required: false,
            description:
              "Optional keyword to filter repositories by name or description (case-insensitive).",
          },
        ],
        hasCustomExecution: true,
      },
      {
        name: "github_repo_activity",
        description:
          "Get recent activity for a specific repository: open pull requests (with count) and the most recent commit (message, author, date). Also reports open issue count.",
        parameters: [
          {
            name: "repo",
            type: "string",
            required: true,
            description:
              "Repository as 'owner/name', or just 'name' to use your own account as the owner.",
          },
        ],
        hasCustomExecution: true,
      },
      {
        name: "github_recent_commits",
        description:
          "List the most recent commits on a repository, with real short SHA, date, author, and message. Use this for 'recent commits' / 'what did I commit' questions.",
        parameters: [
          {
            name: "repo",
            type: "string",
            required: true,
            description:
              "Repository as 'owner/name', or just 'name' to use your own account as the owner.",
          },
          {
            name: "limit",
            type: "number",
            required: false,
            description: "How many commits to return (default 10, max 30).",
          },
        ],
        hasCustomExecution: true,
      },
      {
        name: "github_pr_details",
        description:
          "Get detailed metadata for ONE pull request: title, author, how long it's been open, files changed, lines added/removed, commit count, requested reviewers, and merge state. Use when the user wants depth on a specific PR. Accept either repo + number, or a full PR URL.",
        parameters: [
          {
            name: "repo",
            type: "string",
            required: false,
            description:
              "Repository as 'owner/name' (or just 'name' for your own account). Omit if you pass a full PR url.",
          },
          {
            name: "number",
            type: "number",
            required: false,
            description: "The pull request number. Omit if you pass a full PR url.",
          },
          {
            name: "url",
            type: "string",
            required: false,
            description:
              "Full PR URL (https://github.com/owner/name/pull/123) as an alternative to repo + number.",
          },
        ],
        hasCustomExecution: true,
      },
    ];
  }

  async executeTool(
    toolName: string,
    params: QueryParams,
    _originalQuery?: string,
  ): Promise<string> {
    const config = await this.getConfig();
    if (!config) {
      return "GitHub is not configured. Add a GitHub personal access token in Settings.";
    }

    try {
      switch (toolName) {
        case "github_assigned":
          return await this.executeSearch(
            config,
            "assignee:@me is:open archived:false",
            "assigned to you",
            params.includeChangeStats === true,
          );
        case "github_my_prs":
          return await this.executeSearch(
            config,
            "is:pr is:open author:@me archived:false",
            "your open pull requests",
            params.includeChangeStats === true,
          );
        case "github_review_requests":
          return await this.executeSearch(
            config,
            "is:pr is:open review-requested:@me archived:false",
            "awaiting your review",
            params.includeChangeStats === true,
          );
        case "github_list_repos":
          return await this.executeListRepos(config, params);
        case "github_repo_activity":
          return await this.executeRepoActivity(config, params);
        case "github_recent_commits":
          return await this.executeRecentCommits(config, params);
        case "github_pr_details":
          return await this.executePrDetails(config, params);
        default:
          return `Unknown github tool: ${toolName}`;
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      console.error(`[GithubPlugin] Error executing ${toolName}:`, error);
      return `Error executing ${toolName}: ${errorMsg}`;
    }
  }

  async scan(_options?: any): Promise<ScanResult> {
    return { indexed: 0, deleted: 0 };
  }

  async isConfigured(): Promise<boolean> {
    return (await this.getConfig()) !== null;
  }

  // --- Private helpers ---

  private async getConfig(): Promise<GithubConfig | null> {
    try {
      const settings = await prisma.settings.findUnique({
        where: { id: "singleton" },
      });
      if (settings?.githubToken && settings?.githubEnabled) {
        return { token: settings.githubToken };
      }
    } catch (error) {
      console.error("[GithubPlugin] Error loading config:", error);
    }
    return null;
  }

  private async githubFetch<T>(config: GithubConfig, path: string): Promise<T> {
    const res = await fetch(`${GITHUB_API}${path}`, {
      headers: {
        Authorization: `Bearer ${config.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": USER_AGENT,
      },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      if (res.status === 401) {
        throw new Error(
          "GitHub rejected the token (401). Check that your personal access token is valid — it must be a classic token with 'repo' scope, and SSO-authorized for any org repos.",
        );
      }
      throw new Error(
        `GitHub API error (${res.status}): ${body.slice(0, 200) || res.statusText}`,
      );
    }
    return (await res.json()) as T;
  }

  private async getLogin(config: GithubConfig): Promise<string> {
    if (this.cachedLogin && this.cachedLoginToken === config.token) {
      return this.cachedLogin;
    }
    const user = await this.githubFetch<{ login: string }>(config, "/user");
    this.cachedLogin = user.login;
    this.cachedLoginToken = config.token;
    return user.login;
  }

  private repoFullName(item: any): string {
    // item.repository_url looks like https://api.github.com/repos/owner/name
    const url: string = item.repository_url || "";
    const idx = url.indexOf("/repos/");
    return idx >= 0 ? url.slice(idx + "/repos/".length) : "";
  }

  /** Human-friendly "how long open" from an ISO timestamp. */
  private formatAge(createdAt?: string): string {
    if (!createdAt) return "";
    const created = new Date(createdAt).getTime();
    if (Number.isNaN(created)) return "";
    const ms = Date.now() - created;
    const days = Math.floor(ms / 86_400_000);
    if (days <= 0) {
      const hours = Math.floor(ms / 3_600_000);
      return hours <= 1 ? "open <1h" : `open ${hours}h`;
    }
    if (days === 1) return "open 1 day";
    if (days < 30) return `open ${days} days`;
    const months = Math.floor(days / 30);
    return months <= 1 ? "open ~1 month" : `open ~${months} months`;
  }

  private async executeSearch(
    config: GithubConfig,
    query: string,
    label: string,
    includeChangeStats = false,
  ): Promise<string> {
    const data = await this.githubFetch<{ items: any[]; total_count: number }>(
      config,
      `/search/issues?q=${encodeURIComponent(query)}&per_page=50`,
    );
    const items = data.items || [];
    if (items.length === 0) {
      return `No GitHub items ${label}.`;
    }

    // Optionally enrich PRs with files/lines changed (one extra call each).
    const statsByKey = new Map<
      string,
      { additions: number; deletions: number; changed_files: number }
    >();
    if (includeChangeStats) {
      const prItems = items.filter((it) => it.pull_request);
      const details = await Promise.all(
        prItems.map(async (it) => {
          const repo = this.repoFullName(it);
          try {
            const pr = await this.githubFetch<any>(
              config,
              `/repos/${repo}/pulls/${it.number}`,
            );
            return {
              key: `${repo}#${it.number}`,
              additions: pr.additions ?? 0,
              deletions: pr.deletions ?? 0,
              changed_files: pr.changed_files ?? 0,
            };
          } catch {
            return null; // e.g. no access to that PR — skip its stats
          }
        }),
      );
      for (const d of details) if (d) statsByKey.set(d.key, d);
    }

    const formatted = items
      .map((it, i) => {
        const kind = it.pull_request ? "PR" : "Issue";
        const repo = this.repoFullName(it);
        const draft = it.draft ? " (draft)" : "";
        const author = it.user?.login ? ` by @${it.user.login}` : "";
        let line =
          `${i + 1}. **${it.title}**${draft} — ${kind} #${it.number} in ${repo}${author}\n` +
          `   ${it.html_url}`;

        const meta: string[] = [];
        const age = this.formatAge(it.created_at);
        if (age) meta.push(age);
        const stat = statsByKey.get(`${repo}#${it.number}`);
        if (stat) {
          meta.push(
            `+${stat.additions}/-${stat.deletions} across ${stat.changed_files} file${stat.changed_files === 1 ? "" : "s"}`,
          );
        }
        if (meta.length) line += `\n   ${meta.join(" · ")}`;
        return line;
      })
      .join("\n");

    return `${items.length} GitHub item(s) ${label}:\n\n${formatted}`;
  }

  private async executeListRepos(
    config: GithubConfig,
    params: QueryParams,
  ): Promise<string> {
    const repos = await this.githubFetch<any[]>(
      config,
      "/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator",
    );

    const filter =
      typeof params.filter === "string"
        ? params.filter.toLowerCase().trim()
        : "";
    const matched = filter
      ? repos.filter(
          (r) =>
            r.full_name?.toLowerCase().includes(filter) ||
            (r.description || "").toLowerCase().includes(filter),
        )
      : repos;

    if (matched.length === 0) {
      return filter
        ? `No repositories match "${params.filter}".`
        : "No repositories found.";
    }

    const shown = matched.slice(0, 40);
    const formatted = shown
      .map((r, i) => {
        const priv = r.private ? "private" : "public";
        const pushed = r.pushed_at
          ? new Date(r.pushed_at).toLocaleDateString()
          : "unknown";
        let entry = `${i + 1}. **${r.full_name}** (${priv})`;
        if (r.description) entry += ` — ${r.description}`;
        entry += `\n   open issues/PRs: ${r.open_issues_count ?? 0} · updated ${pushed}`;
        return entry;
      })
      .join("\n");

    const more =
      matched.length > shown.length
        ? `\n\n(showing ${shown.length} of ${matched.length})`
        : "";
    return `${matched.length} repositor${matched.length === 1 ? "y" : "ies"}:\n\n${formatted}${more}`;
  }

  private async executeRepoActivity(
    config: GithubConfig,
    params: QueryParams,
  ): Promise<string> {
    const raw = String(params.repo || "").trim();
    if (!raw) {
      return "Please provide a repository (as 'owner/name' or just 'name').";
    }
    const fullName = raw.includes("/")
      ? raw
      : `${await this.getLogin(config)}/${raw}`;

    // Repo object (for open issue/PR count + existence check)
    const repo = await this.githubFetch<any>(config, `/repos/${fullName}`);

    // Open PRs
    const prs = await this.githubFetch<any[]>(
      config,
      `/repos/${fullName}/pulls?state=open&per_page=50`,
    );

    // Last commit (default branch)
    let lastCommitLine = "unknown";
    try {
      const commits = await this.githubFetch<any[]>(
        config,
        `/repos/${fullName}/commits?per_page=1`,
      );
      const c = commits[0];
      if (c) {
        const msg = (c.commit?.message || "").split("\n")[0];
        const author = c.commit?.author?.name || c.author?.login || "unknown";
        const date = c.commit?.author?.date
          ? new Date(c.commit.author.date).toLocaleString()
          : "";
        lastCommitLine = `"${msg}" — ${author}${date ? ` (${date})` : ""}`;
      }
    } catch {
      // Empty repo or no commits — leave as unknown.
    }

    let result = `**${repo.full_name}**\n`;
    if (repo.description) result += `${repo.description}\n`;
    result += `\n**Open PRs:** ${prs.length}\n`;
    if (prs.length > 0) {
      result += prs
        .slice(0, 20)
        .map(
          (p) =>
            `  - #${p.number} ${p.title}${p.draft ? " (draft)" : ""} — @${p.user?.login}\n    ${p.html_url}`,
        )
        .join("\n");
      result += "\n";
    }
    result += `**Open issues + PRs (GitHub count):** ${repo.open_issues_count ?? 0}\n`;
    result += `**Last commit:** ${lastCommitLine}`;
    return result;
  }

  private async executeRecentCommits(
    config: GithubConfig,
    params: QueryParams,
  ): Promise<string> {
    const raw = String(params.repo || "").trim();
    if (!raw) {
      return "Please provide a repository (as 'owner/name' or just 'name').";
    }
    const fullName = raw.includes("/")
      ? raw
      : `${await this.getLogin(config)}/${raw}`;
    const limit = Math.min(30, Math.max(1, Number(params.limit) || 10));

    const commits = await this.githubFetch<any[]>(
      config,
      `/repos/${fullName}/commits?per_page=${limit}`,
    );
    if (!Array.isArray(commits) || commits.length === 0) {
      return `No commits found for ${fullName}.`;
    }

    const formatted = commits
      .map((c) => {
        const sha = (c.sha || "").slice(0, 7);
        const msg = (c.commit?.message || "").split("\n")[0];
        const author = c.commit?.author?.name || c.author?.login || "unknown";
        const date = c.commit?.author?.date
          ? new Date(c.commit.author.date).toLocaleString()
          : "";
        return `- ${sha} — ${msg} (${author}${date ? `, ${date}` : ""})`;
      })
      .join("\n");

    return `${commits.length} most recent commit(s) on ${fullName}:\n\n${formatted}`;
  }

  private async executePrDetails(
    config: GithubConfig,
    params: QueryParams,
  ): Promise<string> {
    let fullName = String(params.repo || "").trim();
    let number = Number(params.number) || 0;

    // A full PR URL can stand in for repo + number.
    const url = String(params.url || "").trim();
    if (url) {
      const m = url.match(/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/);
      if (m) {
        fullName = m[1];
        number = Number(m[2]);
      }
    }

    if (fullName && !fullName.includes("/")) {
      fullName = `${await this.getLogin(config)}/${fullName}`;
    }
    if (!fullName || !number) {
      return "Please provide a repository and PR number, or a full pull request URL.";
    }

    const pr = await this.githubFetch<any>(
      config,
      `/repos/${fullName}/pulls/${number}`,
    );

    const age = this.formatAge(pr.created_at);
    const state = pr.merged ? "merged" : pr.draft ? "draft" : pr.state;
    const reviewers =
      (pr.requested_reviewers || [])
        .map((r: any) => `@${r.login}`)
        .join(", ") || "none";

    const lines = [
      `**${pr.title}** — PR #${pr.number} in ${fullName}`,
      `${pr.html_url}`,
      "",
      `- Author: @${pr.user?.login ?? "unknown"}`,
      `- State: ${state}`,
      `- ${age || "age unknown"}`,
      `- Changes: +${pr.additions ?? 0}/-${pr.deletions ?? 0} across ${pr.changed_files ?? 0} file(s), ${pr.commits ?? 0} commit(s)`,
      `- Requested reviewers: ${reviewers}`,
    ];
    if (pr.mergeable_state) {
      lines.push(`- Mergeable state: ${pr.mergeable_state}`);
    }
    return lines.join("\n");
  }
}

export const githubPlugin = new GithubPlugin();
