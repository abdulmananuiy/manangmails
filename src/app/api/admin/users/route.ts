// /api/admin/users — search users, suspend / reactivate (audited).
import { query } from "@/lib/db";
import { auditLog } from "@/lib/audit";
import { checkCsrf, error, json, parseJsonBody, requireAdmin } from "@/lib/api";

export async function GET(request: Request) {
  const auth = await requireAdmin();
  if (!auth) return error("Admin sign-in required.", 401);
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const { rows } = await query<{
    id: number;
    username: string;
    status: string;
    created_at: string;
    last_login_at: string | null;
    address_count: string;
    message_count: string;
  }>(
    `SELECT u.id, u.username, u.status, u.created_at, u.last_login_at,
            COALESCE(ac.address_count, 0)::text AS address_count,
            COALESCE(mc.message_count, 0)::text AS message_count
     FROM users u
     LEFT JOIN (SELECT user_id, COUNT(*) AS address_count FROM email_addresses GROUP BY user_id) ac
       ON ac.user_id = u.id
     LEFT JOIN (
       SELECT a.user_id, COUNT(*) AS message_count FROM messages m
       JOIN email_addresses a ON a.id = m.address_id GROUP BY a.user_id
     ) mc ON mc.user_id = u.id
     WHERE $1 = '' OR u.username ILIKE '%' || $1 || '%'
     ORDER BY u.created_at DESC LIMIT 100`,
    [q]
  );
  return json({ users: rows });
}

export async function PATCH(request: Request) {
  const auth = await requireAdmin();
  if (!auth) return error("Admin sign-in required.", 401);
  const body = await parseJsonBody(request);
  if (body === undefined) return error("Malformed JSON.", 400);
  if (!checkCsrf(auth.session, request, body)) return error("Invalid CSRF token.", 403);
  const { id, status } = body as { id?: unknown; status?: unknown };
  if (typeof id !== "number" || (status !== "active" && status !== "suspended")) {
    return error("id and a valid status are required.", 400);
  }
  const { rowCount } = await query("UPDATE users SET status = $1 WHERE id = $2", [status, id]);
  if (rowCount === 0) return error("User not found.", 404);
  await auditLog(auth.admin.id, "admin", `user_${status}`, "user", String(id));
  return json({ ok: true });
}
