/**
 * Gmail provider using googleapis
 * Per-account OAuth tokens, shares Google Client ID/Secret from Settings
 */

import { google, gmail_v1 } from "googleapis";
import prisma from "../prisma";
import { EmailAccountData, EmailMessage, EmailProvider, EmailSearchParams } from "./types";

async function getGmailClient(account: EmailAccountData): Promise<gmail_v1.Gmail> {
  const settings = await prisma.settings.findUnique({
    where: { id: "singleton" },
    select: { googleClientId: true, googleClientSecret: true },
  });

  if (!settings?.googleClientId || !settings?.googleClientSecret) {
    throw new Error("Google Client ID/Secret not configured in Settings. Set them up in the Calendar integration first.");
  }

  if (!account.gmailAccessToken) {
    throw new Error(`Gmail account ${account.email}: not authenticated. Complete OAuth flow first.`);
  }

  const oauth2Client = new google.auth.OAuth2(
    settings.googleClientId,
    settings.googleClientSecret
  );

  oauth2Client.setCredentials({
    access_token: account.gmailAccessToken,
    refresh_token: account.gmailRefreshToken || undefined,
    expiry_date: account.gmailTokenExpiry?.getTime(),
  });

  // Handle token refresh
  oauth2Client.on("tokens", async (tokens) => {
    try {
      await prisma.emailAccount.update({
        where: { id: account.id },
        data: {
          gmailAccessToken: tokens.access_token || account.gmailAccessToken,
          gmailRefreshToken: tokens.refresh_token || account.gmailRefreshToken,
          gmailTokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date) : undefined,
        },
      });
      console.log(`[GmailProvider] Refreshed tokens for ${account.email}`);
    } catch (error) {
      console.error(`[GmailProvider] Failed to save refreshed tokens for ${account.email}:`, error);
    }
  });

  return google.gmail({ version: "v1", auth: oauth2Client });
}

function parseGmailHeaders(headers: gmail_v1.Schema$MessagePartHeader[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const h of headers) {
    if (h.name && h.value) {
      map[h.name.toLowerCase()] = h.value;
    }
  }
  return map;
}

function gmailMessageToEmail(
  msg: gmail_v1.Schema$Message,
  account: EmailAccountData
): EmailMessage {
  const headers = parseGmailHeaders(msg.payload?.headers || []);

  return {
    id: msg.id || "",
    accountId: account.id,
    accountEmail: account.email,
    accountLabel: account.label || undefined,
    subject: headers["subject"] || "(no subject)",
    from: headers["from"] || "unknown",
    to: (headers["to"] || "").split(",").map((s) => s.trim()).filter(Boolean),
    cc: (headers["cc"] || "").split(",").map((s) => s.trim()).filter(Boolean),
    date: headers["date"] ? new Date(headers["date"]) : new Date(),
    snippet: msg.snippet || "",
    isRead: !(msg.labelIds || []).includes("UNREAD"),
    labels: msg.labelIds || [],
    threadId: msg.threadId || undefined,
    hasAttachments: (msg.payload?.parts || []).some(
      (p) => p.filename && p.filename.length > 0
    ),
  };
}

function decodeBody(payload: gmail_v1.Schema$MessagePart | undefined): string {
  if (!payload) return "";

  // Check for direct body data
  if (payload.body?.data) {
    return Buffer.from(payload.body.data, "base64url").toString("utf-8");
  }

  // Check parts (multipart messages)
  if (payload.parts) {
    // Prefer text/plain
    const textPart = payload.parts.find((p) => p.mimeType === "text/plain");
    if (textPart?.body?.data) {
      return Buffer.from(textPart.body.data, "base64url").toString("utf-8");
    }

    // Fall back to text/html
    const htmlPart = payload.parts.find((p) => p.mimeType === "text/html");
    if (htmlPart?.body?.data) {
      return Buffer.from(htmlPart.body.data, "base64url").toString("utf-8");
    }

    // Recurse into nested parts
    for (const part of payload.parts) {
      const result = decodeBody(part);
      if (result) return result;
    }
  }

  return "";
}

export function createGmailProvider(account: EmailAccountData): EmailProvider {
  const provider: EmailProvider = {
    async search(params: EmailSearchParams): Promise<EmailMessage[]> {
      const gmail = await getGmailClient(account);
      const limit = params.limit || 50;

      // Build Gmail search query
      const queryParts: string[] = [];
      if (params.query) queryParts.push(params.query);
      if (params.from) queryParts.push(`from:${params.from}`);
      if (params.to) queryParts.push(`to:${params.to}`);
      if (params.subject) queryParts.push(`subject:${params.subject}`);
      if (params.after) queryParts.push(`after:${params.after}`);
      if (params.before) queryParts.push(`before:${params.before}`);
      if (params.unreadOnly) queryParts.push("is:unread");
      if (params.readOnly) queryParts.push("is:read");
      if (params.label) queryParts.push(`label:${params.label}`);

      const q = queryParts.join(" ") || "in:inbox";
      console.log(`[GmailProvider] Searching ${account.email} with query: "${q}", limit: ${limit}`);

      const listRes = await gmail.users.messages.list({
        userId: "me",
        q,
        maxResults: limit,
      });

      const messageIds = listRes.data.messages || [];
      console.log(`[GmailProvider] Found ${messageIds.length} messages for ${account.email}`);
      if (messageIds.length === 0) return [];

      // Fetch metadata for each message (batch would be ideal but keep simple)
      const messages: EmailMessage[] = [];
      for (const { id } of messageIds) {
        if (!id) continue;
        const msg = await gmail.users.messages.get({
          userId: "me",
          id,
          format: "metadata",
          metadataHeaders: ["From", "To", "Cc", "Subject", "Date"],
        });
        messages.push(gmailMessageToEmail(msg.data, account));
      }

      return messages;
    },

    async getEmail(messageId: string): Promise<EmailMessage | null> {
      const gmail = await getGmailClient(account);

      const msg = await gmail.users.messages.get({
        userId: "me",
        id: messageId,
        format: "full",
      });

      if (!msg.data) return null;

      const email = gmailMessageToEmail(msg.data, account);
      email.body = decodeBody(msg.data.payload);
      return email;
    },

    async listUnread(limit = 25): Promise<EmailMessage[]> {
      return provider.search({ unreadOnly: true, limit });
    },

    async archive(messageId: string): Promise<boolean> {
      try {
        const gmail = await getGmailClient(account);
        await gmail.users.messages.modify({
          userId: "me",
          id: messageId,
          requestBody: {
            removeLabelIds: ["INBOX"],
          },
        });
        return true;
      } catch (error) {
        console.error(`[GmailProvider] Failed to archive ${messageId}:`, error);
        return false;
      }
    },

    async trash(messageId: string): Promise<boolean> {
      try {
        const gmail = await getGmailClient(account);
        await gmail.users.messages.trash({
          userId: "me",
          id: messageId,
        });
        return true;
      } catch (error) {
        console.error(`[GmailProvider] Failed to trash ${messageId}:`, error);
        return false;
      }
    },

    async disconnect(): Promise<void> {
      // No persistent connection
    },
  };

  return provider;
}

/**
 * Refresh Gmail tokens for an account (used during sync)
 */
export async function refreshGmailTokens(account: EmailAccountData): Promise<boolean> {
  try {
    const settings = await prisma.settings.findUnique({
      where: { id: "singleton" },
      select: { googleClientId: true, googleClientSecret: true },
    });

    if (!settings?.googleClientId || !settings?.googleClientSecret) return false;
    if (!account.gmailRefreshToken) return false;

    const oauth2Client = new google.auth.OAuth2(
      settings.googleClientId,
      settings.googleClientSecret
    );

    oauth2Client.setCredentials({
      refresh_token: account.gmailRefreshToken,
    });

    const { credentials } = await oauth2Client.refreshAccessToken();

    await prisma.emailAccount.update({
      where: { id: account.id },
      data: {
        gmailAccessToken: credentials.access_token || undefined,
        gmailRefreshToken: credentials.refresh_token || account.gmailRefreshToken,
        gmailTokenExpiry: credentials.expiry_date ? new Date(credentials.expiry_date) : undefined,
        connectionError: null,
        lastConnected: new Date(),
      },
    });

    console.log(`[GmailProvider] Token refreshed for ${account.email}`);
    return true;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    console.error(`[GmailProvider] Token refresh failed for ${account.email}:`, errorMsg);

    await prisma.emailAccount.update({
      where: { id: account.id },
      data: { connectionError: `Token refresh failed: ${errorMsg}` },
    });

    return false;
  }
}
