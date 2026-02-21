/**
 * Email data source plugin
 * Supports Gmail and Zoho Mail with per-user accounts
 * All tools use hasCustomExecution (live provider queries, no indexed storage)
 */

import {
  DataSourcePlugin,
  DataSourceCapabilities,
  MetadataField,
  QueryParams,
  ToolDefinition,
  ScanResult,
} from "../dataSourceRegistry";
import { SearchResult } from "../retrieval";
import prisma from "../prisma";
import { createEmailProvider, checkPermission } from "../email";
import { EmailAccountData, EmailMessage, EmailPermission } from "../email/types";

export class EmailPlugin implements DataSourcePlugin {
  name = "email";
  displayName = "Email";

  capabilities: DataSourceCapabilities = {
    supportsMetadataQuery: false, // We don't index emails
    supportsSemanticSearch: false,
    supportsScanning: false, // No scan/index cycle
    requiresAuthentication: true,
  };

  getMetadataSchema(): MetadataField[] {
    return [
      { name: "from", displayName: "From", type: "string", queryable: true, filterable: true, description: "Email sender" },
      { name: "to", displayName: "To", type: "string", queryable: true, filterable: true, description: "Email recipient" },
      { name: "subject", displayName: "Subject", type: "string", queryable: true, filterable: true, description: "Email subject" },
      { name: "date", displayName: "Date", type: "date", queryable: true, filterable: true, description: "Email date" },
      { name: "accountEmail", displayName: "Account", type: "string", queryable: true, filterable: true, description: "Email account" },
    ];
  }

  async queryByMetadata(_params: QueryParams): Promise<SearchResult[]> {
    // Not used — all tools have hasCustomExecution
    return [];
  }

  getAvailableTools(): ToolDefinition[] {
    return [
      {
        name: "search_email",
        description:
          `Search emails across all connected email accounts. Supports filtering by sender, subject, date range, and free-text query. Returns matching emails with sender, subject, date, and snippet.`,
        parameters: [
          { name: "query", type: "string", required: false, description: "Free-text search query" },
          { name: "from", type: "string", required: false, description: "Filter by sender email or name" },
          { name: "subject", type: "string", required: false, description: "Filter by subject text" },
          { name: "after", type: "string", required: false, description: "Only emails after this date (YYYY-MM-DD)" },
          { name: "before", type: "string", required: false, description: "Only emails before this date (YYYY-MM-DD)" },
          { name: "unreadOnly", type: "boolean", required: false, description: "Only unread/new emails" },
          { name: "readOnly", type: "boolean", required: false, description: "Only read/seen emails (not unread)" },
          { name: "accountEmail", type: "string", required: false, description: "Filter to a specific email account" },
          { name: "limit", type: "number", required: false, description: "Max results (default: 25)" },
        ],
        hasCustomExecution: true,
      },
      {
        name: "list_unread_email",
        description:
          `List unread emails across all connected email accounts. Shows sender, subject, date, and preview for each unread message.`,
        parameters: [
          { name: "accountEmail", type: "string", required: false, description: "Filter to a specific email account" },
          { name: "limit", type: "number", required: false, description: "Max results per account (default: 15)" },
        ],
        hasCustomExecution: true,
      },
      {
        name: "get_email_detail",
        description:
          `Get the full content of a specific email by its message ID. Use this after search_email or list_unread_email to read the full body of a message.`,
        parameters: [
          { name: "messageId", type: "string", required: true, description: "The message ID from a previous search result" },
          { name: "accountEmail", type: "string", required: true, description: "The email account this message belongs to" },
        ],
        hasCustomExecution: true,
      },
      {
        name: "archive_email",
        description:
          `Archive an email (remove from inbox). Requires read_write permission on the account.`,
        parameters: [
          { name: "messageId", type: "string", required: true, description: "The message ID to archive" },
          { name: "accountEmail", type: "string", required: true, description: "The email account this message belongs to" },
        ],
        hasCustomExecution: true,
      },
      {
        name: "delete_email",
        description:
          `Move an email to trash. Requires read_write_delete permission on the account.`,
        parameters: [
          { name: "messageId", type: "string", required: true, description: "The message ID to delete" },
          { name: "accountEmail", type: "string", required: true, description: "The email account this message belongs to" },
        ],
        hasCustomExecution: true,
      },
      {
        name: "cleanup_old_email",
        description:
          `Preview or bulk archive/delete old emails matching criteria. Use action="preview" first to see what would be affected, then "archive" or "delete" to act.`,
        parameters: [
          { name: "action", type: "string", required: true, description: '"preview", "archive", or "delete"' },
          { name: "before", type: "string", required: true, description: "Only emails before this date (YYYY-MM-DD)" },
          { name: "from", type: "string", required: false, description: "Filter by sender" },
          { name: "subject", type: "string", required: false, description: "Filter by subject" },
          { name: "accountEmail", type: "string", required: false, description: "Filter to specific account" },
          { name: "limit", type: "number", required: false, description: "Max emails to process (default: 50)" },
        ],
        hasCustomExecution: true,
      },
    ];
  }

  async executeTool(toolName: string, params: QueryParams, originalQuery?: string): Promise<string> {
    const userId = params.userId;
    if (!userId) {
      console.error("[EmailPlugin] No userId in params. Keys:", Object.keys(params));
      return "Error: Unable to determine user. Please log in and try again.";
    }

    // Load user's enabled email accounts
    // Don't filter by accountEmail if the LLM passed a provider name instead of actual email
    let accountFilter = params.accountEmail;
    if (accountFilter && !accountFilter.includes("@")) {
      // LLM passed something like "zoho" instead of an actual email address — ignore it
      console.log(`[EmailPlugin] Ignoring non-email accountEmail filter: "${accountFilter}"`);
      accountFilter = undefined;
    }

    const accounts = await this.getAccounts(userId, accountFilter);
    console.log(`[EmailPlugin] ${toolName}: userId=${userId}, accountFilter=${accountFilter || "all"}, found ${accounts.length} account(s)${accounts.length > 0 ? ": " + accounts.map(a => `${a.email} (${a.provider})`).join(", ") : ""}`);

    if (accounts.length === 0) {
      if (accountFilter) {
        return `No enabled email account found for ${accountFilter}. Check your email configuration.`;
      }
      return "No email accounts configured. Add an email account in Settings → Email.";
    }

    try {
      switch (toolName) {
        case "search_email":
          return await this.executeSearch(accounts, params);
        case "list_unread_email":
          return await this.executeListUnread(accounts, params);
        case "get_email_detail":
          return await this.executeGetDetail(accounts, params);
        case "archive_email":
          return await this.executeArchive(accounts, params);
        case "delete_email":
          return await this.executeDelete(accounts, params);
        case "cleanup_old_email":
          return await this.executeCleanup(accounts, params);
        default:
          return `Unknown email tool: ${toolName}`;
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      console.error(`[EmailPlugin] Error executing ${toolName}:`, error);
      return `Error executing ${toolName}: ${errorMsg}`;
    }
  }

  async scan(_options?: any): Promise<ScanResult> {
    // No-op: emails are queried live, not indexed
    return { indexed: 0, deleted: 0 };
  }

  async isConfigured(): Promise<boolean> {
    try {
      const count = await prisma.emailAccount.count({
        where: { enabled: true },
      });
      return count > 0;
    } catch {
      return false;
    }
  }

  // --- Private helpers ---

  private async getAccounts(userId: string, accountEmail?: string): Promise<EmailAccountData[]> {
    const where: any = { userId, enabled: true };
    if (accountEmail) where.email = accountEmail;

    const records = await prisma.emailAccount.findMany({ where });
    return records as EmailAccountData[];
  }

  private formatMessage(msg: EmailMessage, index: number, detailed = false): string {
    const accountTag = msg.accountLabel || msg.accountEmail;
    let entry = `${index}. **${msg.subject}**`;
    entry += `\n   From: ${msg.from}`;
    entry += `\n   Date: ${msg.date.toLocaleString("en-US", {
      weekday: "short", month: "short", day: "numeric", year: "numeric",
      hour: "numeric", minute: "2-digit", hour12: true,
    })}`;
    entry += `\n   Account: ${accountTag}`;
    entry += `\n   ID: ${msg.id}`;
    if (!msg.isRead) entry += ` [UNREAD]`;
    if (msg.hasAttachments) entry += ` [ATTACHMENT]`;

    if (detailed && msg.body) {
      const bodyPreview = msg.body.length > 500 ? msg.body.substring(0, 500) + "..." : msg.body;
      entry += `\n   Body:\n${bodyPreview}`;
    } else if (msg.snippet) {
      entry += `\n   Preview: ${msg.snippet}`;
    }

    return entry;
  }

  private async executeSearch(accounts: EmailAccountData[], params: QueryParams): Promise<string> {
    const allMessages: EmailMessage[] = [];
    const errors: string[] = [];

    // Query all accounts concurrently so one slow account doesn't block others
    const results = await Promise.allSettled(
      accounts.map(async (account) => {
        const provider = createEmailProvider(account);
        const messages = await provider.search({
          query: params.query,
          from: params.from,
          to: params.to,
          subject: params.subject,
          after: params.after,
          before: params.before,
          unreadOnly: params.unreadOnly,
          readOnly: params.readOnly,
          limit: params.limit || 25,
        });
        await provider.disconnect();
        return { account, messages };
      })
    );

    for (const result of results) {
      if (result.status === "fulfilled") {
        console.log(`[EmailPlugin] ${result.value.account.email}: ${result.value.messages.length} messages`);
        allMessages.push(...result.value.messages);
      } else {
        const reason = result.reason instanceof Error ? result.reason.message : "failed";
        console.error(`[EmailPlugin] Account search failed: ${reason}`);
        errors.push(reason);
      }
    }

    // Sort all results by date descending
    allMessages.sort((a, b) => b.date.getTime() - a.date.getTime());
    const limited = allMessages.slice(0, params.limit || 25);

    if (limited.length === 0) {
      const errorNote = errors.length > 0 ? `\n\nErrors: ${errors.join("; ")}` : "";
      return `No emails found matching the search criteria.${errorNote}`;
    }

    const formatted = limited.map((msg, i) => this.formatMessage(msg, i + 1)).join("\n\n");
    const errorNote = errors.length > 0 ? `\n\n(Errors on some accounts: ${errors.join("; ")})` : "";
    return `Found ${limited.length} email(s):\n\n${formatted}${errorNote}`;
  }

  private async executeListUnread(accounts: EmailAccountData[], params: QueryParams): Promise<string> {
    const allMessages: EmailMessage[] = [];
    const errors: string[] = [];
    const limit = params.limit || 15;

    // Query all accounts concurrently
    const results = await Promise.allSettled(
      accounts.map(async (account) => {
        const provider = createEmailProvider(account);
        const messages = await provider.listUnread(limit);
        await provider.disconnect();
        return { account, messages };
      })
    );

    for (const result of results) {
      if (result.status === "fulfilled") {
        allMessages.push(...result.value.messages);
      } else {
        const reason = result.reason instanceof Error ? result.reason.message : "failed";
        errors.push(reason);
      }
    }

    allMessages.sort((a, b) => b.date.getTime() - a.date.getTime());

    if (allMessages.length === 0) {
      const errorNote = errors.length > 0 ? `\n\nErrors: ${errors.join("; ")}` : "";
      return `No unread emails found.${errorNote}`;
    }

    const formatted = allMessages.map((msg, i) => this.formatMessage(msg, i + 1)).join("\n\n");
    const errorNote = errors.length > 0 ? `\n\n(Errors on some accounts: ${errors.join("; ")})` : "";
    return `Found ${allMessages.length} unread email(s):\n\n${formatted}${errorNote}`;
  }

  private async executeGetDetail(accounts: EmailAccountData[], params: QueryParams): Promise<string> {
    const account = accounts.find((a) => a.email === params.accountEmail);
    if (!account) return `Account ${params.accountEmail} not found or not accessible.`;

    const provider = createEmailProvider(account);
    const email = await provider.getEmail(params.messageId);
    await provider.disconnect();

    if (!email) return `Email with ID ${params.messageId} not found.`;

    return this.formatMessage(email, 1, true);
  }

  private async executeArchive(accounts: EmailAccountData[], params: QueryParams): Promise<string> {
    const account = accounts.find((a) => a.email === params.accountEmail);
    if (!account) return `Account ${params.accountEmail} not found or not accessible.`;

    if (!checkPermission(account.permissions as EmailPermission, "read_write")) {
      return `Account ${account.email} has read-only permissions. Update permissions in Settings to archive emails.`;
    }

    const provider = createEmailProvider(account);
    const success = await provider.archive(params.messageId);
    await provider.disconnect();

    return success
      ? `Email ${params.messageId} archived successfully.`
      : `Failed to archive email ${params.messageId}.`;
  }

  private async executeDelete(accounts: EmailAccountData[], params: QueryParams): Promise<string> {
    const account = accounts.find((a) => a.email === params.accountEmail);
    if (!account) return `Account ${params.accountEmail} not found or not accessible.`;

    if (!checkPermission(account.permissions as EmailPermission, "read_write_delete")) {
      return `Account ${account.email} does not have delete permissions. Update permissions in Settings.`;
    }

    const provider = createEmailProvider(account);
    const success = await provider.trash(params.messageId);
    await provider.disconnect();

    return success
      ? `Email ${params.messageId} moved to trash.`
      : `Failed to delete email ${params.messageId}.`;
  }

  private async executeCleanup(accounts: EmailAccountData[], params: QueryParams): Promise<string> {
    const action = params.action as string;
    if (!["preview", "archive", "delete"].includes(action)) {
      return `Invalid action "${action}". Use "preview", "archive", or "delete".`;
    }

    // First, search for matching emails
    const allMessages: EmailMessage[] = [];
    const errors: string[] = [];
    const limit = params.limit || 50;

    // Filter accounts by permission first, then process concurrently
    const eligibleAccounts = accounts.filter((account) => {
      if (action === "archive" && !checkPermission(account.permissions as EmailPermission, "read_write")) {
        errors.push(`${account.email}: insufficient permissions for archive`);
        return false;
      }
      if (action === "delete" && !checkPermission(account.permissions as EmailPermission, "read_write_delete")) {
        errors.push(`${account.email}: insufficient permissions for delete`);
        return false;
      }
      return true;
    });

    const results = await Promise.allSettled(
      eligibleAccounts.map(async (account) => {
        const provider = createEmailProvider(account);
        const messages = await provider.search({
          before: params.before,
          from: params.from,
          subject: params.subject,
          limit,
        });

        if (action === "preview") {
          await provider.disconnect();
          return { account, messages, actionResult: "" };
        }

        // Execute the action
        let successCount = 0;
        for (const msg of messages) {
          const ok = action === "archive"
            ? await provider.archive(msg.id)
            : await provider.trash(msg.id);
          if (ok) successCount++;
        }
        await provider.disconnect();
        return {
          account,
          messages,
          actionResult: `${account.email}: ${successCount}/${messages.length} ${action}d`,
        };
      })
    );

    for (const result of results) {
      if (result.status === "fulfilled") {
        allMessages.push(...result.value.messages);
        if (result.value.actionResult) errors.push(result.value.actionResult);
      } else {
        const reason = result.reason instanceof Error ? result.reason.message : "failed";
        errors.push(reason);
      }
    }

    if (action === "preview") {
      if (allMessages.length === 0) {
        return `No emails found matching cleanup criteria (before ${params.before}).`;
      }
      const formatted = allMessages.slice(0, 20).map((msg, i) => this.formatMessage(msg, i + 1)).join("\n\n");
      const moreNote = allMessages.length > 20 ? `\n\n... and ${allMessages.length - 20} more` : "";
      return `Found ${allMessages.length} email(s) matching cleanup criteria:\n\n${formatted}${moreNote}\n\nTo proceed, call cleanup_old_email with action="archive" or action="delete".`;
    }

    const resultNotes = errors.join("; ");
    return `Cleanup complete: ${allMessages.length} email(s) processed. Results: ${resultNotes}`;
  }
}

// Export singleton instance
export const emailPlugin = new EmailPlugin();
