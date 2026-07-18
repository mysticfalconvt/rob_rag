/**
 * Todo XP (read-only) plugin — reads the todo-gameification app's /api/v1 REST API.
 * Per-family-member API tokens are stored in the TodoAccount table; the global
 * base URL + enable flag live in Settings. All tools use hasCustomExecution.
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

const DEFAULT_BASE_URL = "https://todo.rboskind.com";

interface TodoAccountConfig {
  label: string;
  token: string;
}
interface TodoConfig {
  baseUrl: string;
  accounts: TodoAccountConfig[];
}

export class TodoPlugin implements DataSourcePlugin {
  name = "todo";
  displayName = "Todo XP";

  capabilities: DataSourceCapabilities = {
    supportsMetadataQuery: false,
    supportsSemanticSearch: false,
    supportsScanning: false,
    requiresAuthentication: true,
  };

  getMetadataSchema(): MetadataField[] {
    return [];
  }

  async queryByMetadata(_params: QueryParams): Promise<SearchResult[]> {
    return [];
  }

  getAvailableTools(): ToolDefinition[] {
    return [
      {
        name: "todo_today",
        description:
          "List the full 'due today + overdue' list for a member who has a personal token configured (typically the account owner). For a specific OTHER family member (e.g. a kid), prefer todo_family — it shows every member's assigned chores without needing their personal token.",
        parameters: [
          {
            name: "member",
            type: "string",
            required: false,
            description:
              "Which family member's personal list to read (their configured name). If omitted and only one member is configured, that one is used. If the member has no personal token, this falls back to their family-assigned chores.",
          },
        ],
        hasCustomExecution: true,
      },
      {
        name: "todo_week",
        description:
          "List the family's upcoming chores for a 7-day window (projected by due date). Use for 'what's coming up this week'.",
        parameters: [
          {
            name: "startDate",
            type: "string",
            required: false,
            description:
              "Optional start date (YYYY-MM-DD). Defaults to the current week.",
          },
        ],
        hasCustomExecution: true,
      },
      {
        name: "todo_family",
        description:
          "Show the family/household: members and their roles, plus who is assigned which chores. Use for 'who's responsible for the dishes' or 'what is <name> assigned'. Optionally filter chores to one person.",
        parameters: [
          {
            name: "assignee",
            type: "string",
            required: false,
            description:
              "Optional: only show chores assigned to this person (matched by name).",
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
      return "Todo XP is not configured. Enable it and add at least one family member's API token in Settings.";
    }

    try {
      switch (toolName) {
        case "todo_today":
          return await this.executeToday(config, params);
        case "todo_week":
          return await this.executeWeek(config, params);
        case "todo_family":
          return await this.executeFamily(config, params);
        default:
          return `Unknown todo tool: ${toolName}`;
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      console.error(`[TodoPlugin] Error executing ${toolName}:`, error);
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

  private async getConfig(): Promise<TodoConfig | null> {
    try {
      const settings = await prisma.settings.findUnique({
        where: { id: "singleton" },
      });
      if (!settings?.todoEnabled) return null;

      const accounts = await prisma.todoAccount.findMany({
        where: { enabled: true },
        orderBy: { createdAt: "asc" },
        select: { label: true, apiToken: true },
      });
      if (accounts.length === 0) return null;

      return {
        baseUrl: (settings.todoBaseUrl || DEFAULT_BASE_URL).replace(/\/$/, ""),
        accounts: accounts.map((a) => ({ label: a.label, token: a.apiToken })),
      };
    } catch (error) {
      console.error("[TodoPlugin] Error loading config:", error);
    }
    return null;
  }

  /** Resolve which member's token to use, or a helpful message if ambiguous. */
  private resolveMember(
    config: TodoConfig,
    member?: string,
  ): TodoAccountConfig | { error: string } {
    const labels = config.accounts.map((a) => a.label);
    if (member && member.trim()) {
      const m = member.trim().toLowerCase();
      const found = config.accounts.find((a) => a.label.toLowerCase() === m);
      if (found) return found;
      return {
        error: `No configured family member named "${member}". Available: ${labels.join(", ")}.`,
      };
    }
    if (config.accounts.length === 1) return config.accounts[0];
    return {
      error: `Multiple family members are configured — specify which one. Available: ${labels.join(", ")}.`,
    };
  }

  private async todoFetch<T>(
    config: TodoConfig,
    token: string,
    path: string,
  ): Promise<T> {
    const res = await fetch(`${config.baseUrl}${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || (json && json.error)) {
      const msg =
        json?.error?.message ||
        json?.error?.code ||
        res.statusText ||
        "request failed";
      if (res.status === 401) {
        throw new Error(
          "Todo XP rejected the token (401). Re-mint the member's API token in Todo XP settings and update it here.",
        );
      }
      throw new Error(`Todo XP API error (${res.status}): ${msg}`);
    }
    return (json?.data ?? json) as T;
  }

  private fmtDate(value: any): string {
    if (!value) return "";
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString();
  }

  private async executeToday(
    config: TodoConfig,
    params: QueryParams,
  ): Promise<string> {
    const resolved = this.resolveMember(config, params.member);
    if ("error" in resolved) {
      // A specific family member was named but has no personal token configured.
      // Household endpoints still expose every member's assigned chores, so fall
      // back to the family chore view filtered to that name instead of dead-ending.
      if (params.member && String(params.member).trim()) {
        const family = await this.executeFamily(config, {
          assignee: params.member,
        });
        return (
          `No personal Todo XP token is configured for "${params.member}", ` +
          `so here are the chores assigned to them from the family list:\n\n${family}`
        );
      }
      return resolved.error;
    }

    const items = await this.todoFetch<any[]>(
      config,
      resolved.token,
      "/api/v1/today",
    );
    if (!Array.isArray(items) || items.length === 0) {
      return `Nothing due or overdue for ${resolved.label}. 🎉`;
    }

    const now = Date.now();
    const formatted = items
      .map((it) => {
        const due = it.dueAt || it.due_at;
        const overdue = due && new Date(due).getTime() < now;
        const title = it.title || it.name || "(untitled)";
        return `- ${title}${due ? ` — due ${this.fmtDate(due)}${overdue ? " ⚠️ overdue" : ""}` : ""}`;
      })
      .join("\n");
    return `${resolved.label} has ${items.length} item(s) due/overdue:\n\n${formatted}`;
  }

  private async executeWeek(
    config: TodoConfig,
    params: QueryParams,
  ): Promise<string> {
    const token = config.accounts[0].token;
    const startDate =
      typeof params.startDate === "string" && params.startDate.trim()
        ? params.startDate.trim()
        : "";
    const path = `/api/v1/household/chores/week${startDate ? `?startDate=${encodeURIComponent(startDate)}` : ""}`;
    const data = await this.todoFetch<any>(config, token, path);

    const occurrences: any[] =
      data?.occurrences || (Array.isArray(data) ? data : []);
    if (occurrences.length === 0) {
      return "No upcoming chores found for the week.";
    }

    // Group by calendar day.
    const byDay = new Map<string, string[]>();
    for (const o of occurrences) {
      const due = o.dueAt || o.due_at;
      const day = due ? new Date(due).toLocaleDateString() : "Unscheduled";
      const who =
        o.assignedToName || o.assignee || o.assigneeGroup || "unassigned";
      const title = o.title || o.name || "(untitled)";
      if (!byDay.has(day)) byDay.set(day, []);
      byDay.get(day)?.push(`  - ${title} (${who})`);
    }

    const formatted = Array.from(byDay.entries())
      .map(([day, lines]) => `**${day}**\n${lines.join("\n")}`)
      .join("\n\n");
    return `Upcoming chores this week:\n\n${formatted}`;
  }

  private async executeFamily(
    config: TodoConfig,
    params: QueryParams,
  ): Promise<string> {
    const token = config.accounts[0].token;

    const household = await this.todoFetch<any>(
      config,
      token,
      "/api/v1/household",
    );
    const chores = await this.todoFetch<any[]>(
      config,
      token,
      "/api/v1/household/chores",
    );

    let result = "";
    const members: any[] = household?.members || [];
    if (household?.household?.name) {
      result += `**Household:** ${household.household.name}\n`;
    }
    if (members.length > 0) {
      result += `**Members:**\n`;
      result += members
        .map((m) => `  - ${m.name || m.handle} (${m.role || "member"})`)
        .join("\n");
      result += "\n\n";
    }

    const assigneeFilter =
      typeof params.assignee === "string"
        ? params.assignee.toLowerCase().trim()
        : "";
    let rows = Array.isArray(chores) ? chores : [];
    if (assigneeFilter) {
      rows = rows.filter((c) =>
        (c.assignedToName || c.assignee || "")
          .toLowerCase()
          .includes(assigneeFilter),
      );
    }

    if (rows.length === 0) {
      result += assigneeFilter
        ? `No chores assigned to "${params.assignee}".`
        : "No chores found.";
      return result.trim();
    }

    result += `**Chores${assigneeFilter ? ` for ${params.assignee}` : ""}:**\n`;
    result += rows
      .slice(0, 40)
      .map((c) => {
        const who =
          c.assignedToName || c.assignee || c.assigneeGroup || "unassigned";
        const due = c.dueAt || c.due_at;
        const title = c.title || c.name || "(untitled)";
        return `  - ${title} → ${who}${due ? ` (due ${this.fmtDate(due)})` : ""}`;
      })
      .join("\n");
    return result.trim();
  }
}

export const todoPlugin = new TodoPlugin();
