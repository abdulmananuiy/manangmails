// CSRF protection: double-submit token bound to the session.
// The token is issued with the session (payload.csrf) and must be sent back
// as the `x-csrf-token` header (or `_csrf` form field) on state-changing requests.
import type { SessionPayload } from "./auth";

export function csrfTokenFor(session: SessionPayload): string {
  return session.csrf;
}

export function verifyCsrf(
  session: SessionPayload | null,
  request: Request
): boolean {
  if (!session) return false;
  const header = request.headers.get("x-csrf-token");
  // Form posts may carry _csrf in the body; handlers pass it via header instead.
  return !!header && header.length > 0 && header === session.csrf;
}

/** Extract a CSRF token from a JSON body ({ _csrf }) if present. */
export function csrfFromBody(body: unknown): string | null {
  if (body && typeof body === "object" && "_csrf" in body) {
    const v = (body as Record<string, unknown>)._csrf;
    return typeof v === "string" ? v : null;
  }
  return null;
}
