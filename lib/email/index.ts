/**
 * Email provider factory and helpers
 */

import { EmailAccountData, EmailPermission, EmailProvider } from "./types";
import { createZohoProvider } from "./zohoProvider";
import { createGmailProvider } from "./gmailProvider";

/**
 * Create an EmailProvider instance for the given account
 */
export function createEmailProvider(account: EmailAccountData): EmailProvider {
  switch (account.provider) {
    case "zoho":
      return createZohoProvider(account);
    case "gmail":
      return createGmailProvider(account);
    default:
      throw new Error(`Unknown email provider: ${account.provider}`);
  }
}

/**
 * Permission hierarchy: read < read_write < read_write_delete
 */
const PERMISSION_LEVELS: Record<EmailPermission, number> = {
  read: 1,
  read_write: 2,
  read_write_delete: 3,
};

/**
 * Check if an account has sufficient permission for an action
 */
export function checkPermission(
  accountPermission: EmailPermission,
  requiredPermission: EmailPermission
): boolean {
  return PERMISSION_LEVELS[accountPermission] >= PERMISSION_LEVELS[requiredPermission];
}

/**
 * Get a human-readable description of what a permission level allows
 */
export function describePermission(permission: EmailPermission): string {
  switch (permission) {
    case "read":
      return "Read only (search, view)";
    case "read_write":
      return "Read & write (search, view, archive)";
    case "read_write_delete":
      return "Full access (search, view, archive, delete)";
  }
}
