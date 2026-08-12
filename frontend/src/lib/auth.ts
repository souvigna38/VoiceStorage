// =============================================================================
// API Route Authentication — simple API key guard for all mutating routes
// =============================================================================
// Since this is a personal/local inventory tool, we use a simple API key
// approach. The key is checked from:
//   1. X-API-Key header
//   2. Cookie "invstorage_session"
//
// Set INVSTORAGE_API_KEY in .env to enable. If unset, auth is bypassed
// (development mode / backward-compatible).
// =============================================================================

import { NextResponse } from "next/server";

const API_KEY = process.env.INVSTORAGE_API_KEY || "";

/**
 * Validates the incoming request has a valid API key.
 * Returns null if authorized, or a NextResponse 401 if not.
 *
 * If INVSTORAGE_API_KEY is not set, all requests are allowed (dev mode).
 */
export function requireAuth(request: Request): NextResponse | null {
  // If no API key configured, skip auth (dev/local mode)
  if (!API_KEY) return null;

  const headerKey = request.headers.get("x-api-key");
  if (headerKey === API_KEY) return null;

  // Check cookie-based session
  const cookie = request.headers.get("cookie") || "";
  const match = cookie.match(/invstorage_session=([^;]+)/);
  if (match && match[1] === API_KEY) return null;

  return NextResponse.json(
    { success: false, error: "Unauthorized — valid API key required" },
    { status: 401 }
  );
}

/** The default admin user ID used for audit logs. */
export const ADMIN_USER_ID = 1;

/**
 * Server Action auth guard.
 *
 * API-route auth (`requireAuth`) works on a `Request`, but Server Actions have
 * no request object, so they read the `invstorage_session` cookie instead.
 *
 * If INVSTORAGE_API_KEY is not set, all calls are allowed (dev/local mode),
 * matching `requireAuth`'s behavior. Returns true when authorized.
 */
export async function isActionAuthorized(): Promise<boolean> {
  if (!API_KEY) return true;
  // Imported lazily so this module stays usable from non-request contexts.
  const { cookies } = await import("next/headers");
  const store = await cookies();
  return store.get("invstorage_session")?.value === API_KEY;
}

/** Throwing variant for Server Actions. */
export async function assertActionAuthorized(): Promise<void> {
  if (!(await isActionAuthorized())) {
    throw new Error("Unauthorized — valid session required");
  }
}
