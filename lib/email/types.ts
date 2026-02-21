/**
 * Email integration types and interfaces
 */

export interface EmailMessage {
  id: string; // Provider-specific message ID
  accountId: string; // EmailAccount.id
  accountEmail: string;
  accountLabel?: string;
  subject: string;
  from: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  date: Date;
  snippet?: string; // Short preview text
  body?: string; // Full body (only when fetching detail)
  isRead: boolean;
  labels?: string[]; // Gmail labels or IMAP folders
  threadId?: string; // Gmail thread ID
  hasAttachments?: boolean;
}

export interface EmailSearchParams {
  query?: string; // Free-text search
  from?: string;
  to?: string;
  subject?: string;
  after?: string; // ISO date
  before?: string; // ISO date
  unreadOnly?: boolean;
  readOnly?: boolean; // Only read/seen emails
  label?: string; // Gmail label or IMAP folder
  accountEmail?: string; // Filter to specific account
  limit?: number;
}

export type EmailPermission = "read" | "read_write" | "read_write_delete";

export interface EmailProvider {
  /** Search emails matching criteria */
  search(params: EmailSearchParams): Promise<EmailMessage[]>;

  /** Get full email content by ID */
  getEmail(messageId: string): Promise<EmailMessage | null>;

  /** List unread emails */
  listUnread(limit?: number): Promise<EmailMessage[]>;

  /** Archive an email (remove from inbox) */
  archive(messageId: string): Promise<boolean>;

  /** Move email to trash */
  trash(messageId: string): Promise<boolean>;

  /** Disconnect / cleanup */
  disconnect(): Promise<void>;
}

export interface EmailAccountData {
  id: string;
  userId: string;
  provider: "gmail" | "zoho";
  email: string;
  label: string | null;
  permissions: EmailPermission;
  enabled: boolean;
  // Gmail
  gmailAccessToken: string | null;
  gmailRefreshToken: string | null;
  gmailTokenExpiry: Date | null;
  // Zoho IMAP
  imapHost: string | null;
  imapPort: number | null;
  imapPassword: string | null;
  // Status
  lastConnected: Date | null;
  connectionError: string | null;
}
