// POST /api/auth/change-password — logged-in user changes their own password.
import { hashPassword, verifyPassword } from "@/lib/auth";
import { query } from "@/lib/db";
import { checkCsrf, error, json, isValidPassword, parseJsonBody, requireUser } from "@/lib/api";

export async function POST(request: Request) {
  const auth = await requireUser();
  if (!auth) return error("Not signed in.", 401);
  const body = await parseJsonBody(request);
  if (body === undefined) return error("Malformed JSON.", 400);
  if (!checkCsrf(auth.session, request, body)) {
    return error("Invalid CSRF token. Refresh the page and try again.", 403);
  }
  const { currentPassword, newPassword } = body as {
    currentPassword?: unknown;
    newPassword?: unknown;
  };
  if (typeof currentPassword !== "string" || typeof newPassword !== "string") {
    return error("Both passwords are required.", 400);
  }
  if (!isValidPassword(newPassword)) {
    return error("New password must be at least 8 characters.", 400);
  }
  const { rows } = await query<{ password_hash: string }>(
    "SELECT password_hash FROM users WHERE id = $1",
    [auth.user.id]
  );
  const ok = await verifyPassword(currentPassword, rows[0]?.password_hash ?? "");
  if (!ok) return error("Current password is incorrect.", 401);
  await query("UPDATE users SET password_hash = $1 WHERE id = $2", [
    await hashPassword(newPassword),
    auth.user.id,
  ]);
  return json({ ok: true });
}
