# CSRF Protection Implementation

This application implements CSRF (Cross-Site Request Forgery) protection for all state-changing operations.

## Overview

CSRF protection prevents attackers from tricking authenticated users into performing unwanted actions. We use a double-submit cookie pattern:

1. Server stores CSRF token in the secure, httpOnly session cookie
2. Client retrieves token via API endpoint
3. Client includes token in `X-CSRF-Token` header for all POST/PUT/PATCH/DELETE requests
4. Server validates the header token matches the session token

## Server-Side Implementation

### Protected Routes

The following critical routes have CSRF protection:

- `/api/upload` - File uploads
- `/api/files` - File management (POST/DELETE)
- Additional routes can be protected by adding `requireCsrf(req)`

### How to Protect a Route

```typescript
import { requireCsrf } from "@/lib/csrf";
import { requireAuth } from "@/lib/session";

export async function POST(req: NextRequest) {
  try {
    // Validate CSRF token first
    await requireCsrf(req);

    // Then authenticate
    const session = await requireAuth(req);

    // Your route logic here...

  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes("CSRF")) {
        return NextResponse.json(
          { error: "CSRF validation failed" },
          { status: 403 },
        );
      }
    }
    // Handle other errors...
  }
}
```

### CSRF Token Generation

Tokens are automatically generated when:
- User logs in (session is created)
- Token is requested via `/api/auth/csrf`

## Client-Side Implementation

### 1. Fetch CSRF Token

```typescript
// Fetch token when app initializes or user logs in
const response = await fetch('/api/auth/csrf');
const { csrfToken } = await response.json();

// Store token (e.g., in React state or context)
```

### 2. Include Token in Requests

```typescript
// For all POST/PUT/PATCH/DELETE requests:
const response = await fetch('/api/upload', {
  method: 'POST',
  headers: {
    'X-CSRF-Token': csrfToken,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(data),
});
```

### 3. Handle CSRF Errors

```typescript
if (response.status === 403) {
  const error = await response.json();
  if (error.error === "CSRF validation failed") {
    // Refresh token and retry
    const newToken = await fetchCsrfToken();
    // Retry request with new token
  }
}
```

## Example: React Hook

```typescript
import { useState, useEffect } from 'react';

export function useCsrf() {
  const [csrfToken, setCsrfToken] = useState<string | null>(null);

  useEffect(() => {
    fetchToken();
  }, []);

  const fetchToken = async () => {
    try {
      const res = await fetch('/api/auth/csrf');
      if (res.ok) {
        const data = await res.json();
        setCsrfToken(data.csrfToken);
      }
    } catch (error) {
      console.error('Failed to fetch CSRF token:', error);
    }
  };

  const fetchWithCsrf = async (url: string, options: RequestInit = {}) => {
    if (!csrfToken) {
      throw new Error('CSRF token not available');
    }

    return fetch(url, {
      ...options,
      headers: {
        ...options.headers,
        'X-CSRF-Token': csrfToken,
      },
    });
  };

  return { csrfToken, fetchWithCsrf, refreshToken: fetchToken };
}
```

## Security Considerations

### Why This Approach?

1. **HttpOnly Cookies**: Session cookie cannot be accessed by JavaScript (XSS protection)
2. **Same-Origin**: CSRF token must be retrieved from same origin
3. **Header Validation**: Attackers can't force browsers to set custom headers cross-origin
4. **Token Rotation**: New token generated on login

### Additional Protections

The application also uses:
- `SameSite=lax` cookies (prevents most CSRF)
- Secure cookies in production (HTTPS only)
- Origin validation (implicit via CORS)

### When CSRF Protection is NOT Needed

- GET requests (should never change state)
- Public API endpoints that don't require authentication
- Webhooks (use signature validation instead)

## Troubleshooting

### "CSRF token missing" Error

1. Ensure you're calling `/api/auth/csrf` after login
2. Check that token is included in `X-CSRF-Token` header
3. Verify token is not expired (lasts duration of session)

### "CSRF token mismatch" Error

1. User may have multiple tabs with different sessions
2. Token may have expired - fetch new token
3. Check for race conditions in token fetching

### Token Not Generated

1. Ensure user is authenticated
2. Check session is properly initialized
3. Verify SESSION_SECRET is set in environment

## Future Enhancements

Potential improvements:
- Token rotation on sensitive operations
- Per-request tokens for extra security
- Token expiration separate from session
- CSRF token in forms (for non-SPA pages)
