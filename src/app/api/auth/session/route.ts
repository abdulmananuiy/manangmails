// GET /api/auth/session — returns the signed-in user's name + CSRF token
// for client-side forms. Requires a valid session cookie; the token is
// only ever revealed to the authenticated owner of the session.
import { json, requireUser } from "@/lib/api";
import { csrfTokenFor } from "@/lib/csrf";
import { error } from "@/lib/api";

export async function GET() {
  const auth = await requireUser();
  if (!auth) return error("Not signed in.", 401);
  return json({ username: auth.user.username, csrf: csrfTokenFor(auth.session) });
}
