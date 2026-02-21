/**
 * Zoho Mail provider using IMAP (imapflow)
 * Connects to imap.zoho.com:993 with TLS
 * Short-lived connections: connect per-request, disconnect after
 */

import { ImapFlow } from "imapflow";
import { EmailAccountData, EmailMessage, EmailProvider, EmailSearchParams } from "./types";
import { simpleParser } from "mailparser";

export function createZohoProvider(account: EmailAccountData): EmailProvider {
  if (!account.imapPassword) {
    throw new Error(`Zoho account ${account.email}: IMAP password not configured`);
  }

  const host = account.imapHost || "imap.zoho.com";
  const port = account.imapPort || 993;

  const OPERATION_TIMEOUT_MS = 20_000; // 20 seconds for the entire operation

  async function withConnection<T>(fn: (client: ImapFlow) => Promise<T>): Promise<T> {
    const client = new ImapFlow({
      host,
      port,
      secure: true,
      auth: {
        user: account.email,
        pass: account.imapPassword!,
      },
      logger: false,
      greetingTimeout: 10_000,
      socketTimeout: 10_000,
    });

    // Catch errors emitted by imapflow so they don't become uncaught exceptions
    let emittedError: Error | null = null;
    client.on("error", (err: Error) => {
      console.error(`[ZohoProvider] ImapFlow error event for ${account.email}:`, err.message);
      emittedError = err;
    });

    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    // Wrap the entire connect + operation in an overall timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        // Force-close the client when we timeout
        try { client.close(); } catch { /* ignore */ }
        reject(new Error(
          `IMAP operation timed out after ${OPERATION_TIMEOUT_MS / 1000}s for ${account.email}`
        ));
      }, OPERATION_TIMEOUT_MS);
    });

    const operationPromise = (async () => {
      try {
        console.log(`[ZohoProvider] Connecting to ${host}:${port} for ${account.email}...`);
        await client.connect();
        console.log(`[ZohoProvider] Connected to ${account.email}`);
        const result = await fn(client);
        return result;
      } finally {
        try { await client.logout(); } catch { /* ignore */ }
        try { client.close(); } catch { /* ignore */ }
      }
    })();

    try {
      return await Promise.race([operationPromise, timeoutPromise]);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  function buildSearchCriteria(params: EmailSearchParams): any {
    const criteria: any = {};

    if (params.from) criteria.from = params.from;
    if (params.to) criteria.to = params.to;
    if (params.subject) criteria.subject = params.subject;
    if (params.after) criteria.since = new Date(params.after);
    if (params.before) criteria.before = new Date(params.before);
    if (params.unreadOnly) criteria.unseen = true;
    if (params.readOnly) criteria.seen = true;
    if (params.query) criteria.body = params.query;

    // If no criteria specified, default to recent messages
    if (Object.keys(criteria).length === 0) {
      // Search last 7 days by default to avoid scanning entire mailbox
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      criteria.since = weekAgo;
    }

    return criteria;
  }

  function parseEnvelope(msg: any): EmailMessage {
    const envelope = msg.envelope;
    return {
      id: msg.uid?.toString() || msg.seq?.toString() || "",
      accountId: account.id,
      accountEmail: account.email,
      accountLabel: account.label || undefined,
      subject: envelope?.subject || "(no subject)",
      from: envelope?.from?.[0]
        ? `${envelope.from[0].name || ""} <${envelope.from[0].address || ""}>`
        : "unknown",
      to: (envelope?.to || []).map(
        (a: any) => `${a.name || ""} <${a.address || ""}>`.trim()
      ),
      cc: (envelope?.cc || []).map(
        (a: any) => `${a.name || ""} <${a.address || ""}>`.trim()
      ),
      date: envelope?.date ? new Date(envelope.date) : new Date(),
      snippet: msg.bodyStructure?.childNodes?.[0]?.description || "",
      isRead: msg.flags?.has("\\Seen") || false,
      labels: [msg.mailbox || "INBOX"],
      hasAttachments: msg.bodyStructure?.childNodes?.length > 1,
    };
  }

  const provider: EmailProvider = {
    async search(params: EmailSearchParams): Promise<EmailMessage[]> {
      return withConnection(async (client) => {
        const mailbox = params.label || "INBOX";
        const lock = await client.getMailboxLock(mailbox);
        try {
          const criteria = buildSearchCriteria(params);
          const limit = params.limit || 50;

          // Two-step: SEARCH for UIDs first (fast), then FETCH only those UIDs
          console.log(`[ZohoProvider] Searching ${mailbox} with criteria:`, JSON.stringify(criteria));
          const searchResult = await client.search(criteria, { uid: true });
          const uids = searchResult || [];
          console.log(`[ZohoProvider] Search returned ${uids.length} UIDs`);

          if (uids.length === 0) return [];

          // Take only the last N UIDs (most recent by UID order)
          const targetUids = uids.slice(-limit);
          const uidRange = targetUids.join(",");

          const messages: EmailMessage[] = [];
          for await (const msg of client.fetch(uidRange, {
            envelope: true,
            flags: true,
            bodyStructure: true,
            uid: true,
          }, { uid: true })) {
            messages.push(parseEnvelope(msg));
          }

          // Sort newest first
          messages.sort((a, b) => b.date.getTime() - a.date.getTime());
          return messages;
        } finally {
          lock.release();
        }
      });
    },

    async getEmail(messageId: string): Promise<EmailMessage | null> {
      return withConnection(async (client) => {
        const lock = await client.getMailboxLock("INBOX");
        try {
          const uid = parseInt(messageId, 10);
          if (isNaN(uid)) return null;

          // Fetch the full message source
          const download = await client.download(uid.toString(), undefined, { uid: true });
          if (!download) return null;

          const chunks: Buffer[] = [];
          for await (const chunk of download.content) {
            chunks.push(Buffer.from(chunk));
          }
          const raw = Buffer.concat(chunks);

          const parsed = await simpleParser(raw);

          return {
            id: messageId,
            accountId: account.id,
            accountEmail: account.email,
            accountLabel: account.label || undefined,
            subject: parsed.subject || "(no subject)",
            from: parsed.from?.text || "unknown",
            to: parsed.to
              ? (Array.isArray(parsed.to) ? parsed.to.map((t) => t.text) : [parsed.to.text])
              : [],
            cc: parsed.cc
              ? (Array.isArray(parsed.cc) ? parsed.cc.map((c) => c.text) : [parsed.cc.text])
              : [],
            date: parsed.date || new Date(),
            body: parsed.text || parsed.html || "",
            snippet: (parsed.text || "").substring(0, 200),
            isRead: true,
            hasAttachments: (parsed.attachments?.length || 0) > 0,
          };
        } finally {
          lock.release();
        }
      });
    },

    async listUnread(limit = 25): Promise<EmailMessage[]> {
      return provider.search({ unreadOnly: true, limit });
    },

    async archive(messageId: string): Promise<boolean> {
      return withConnection(async (client) => {
        const lock = await client.getMailboxLock("INBOX");
        try {
          const uid = parseInt(messageId, 10);
          if (isNaN(uid)) return false;

          // Move to Archive folder (Zoho uses "Archive")
          await client.messageMove(uid.toString(), "Archive", { uid: true });
          return true;
        } catch (error) {
          console.error(`[ZohoProvider] Failed to archive message ${messageId}:`, error);
          return false;
        } finally {
          lock.release();
        }
      });
    },

    async trash(messageId: string): Promise<boolean> {
      return withConnection(async (client) => {
        const lock = await client.getMailboxLock("INBOX");
        try {
          const uid = parseInt(messageId, 10);
          if (isNaN(uid)) return false;

          // Move to Trash folder
          await client.messageMove(uid.toString(), "Trash", { uid: true });
          return true;
        } catch (error) {
          console.error(`[ZohoProvider] Failed to trash message ${messageId}:`, error);
          return false;
        } finally {
          lock.release();
        }
      });
    },

    async disconnect(): Promise<void> {
      // No persistent connection to clean up
    },
  };

  return provider;
}
