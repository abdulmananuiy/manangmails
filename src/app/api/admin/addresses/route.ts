// /api/admin/addresses — search addresses, deactivate / delete (audited).
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
    full_address: string;
    owner: string;
    status: string;
    is_saved: boolean;
    created_at: string;
    message_count: string;
  }>(
    `SELECT a.id, a.full_address, u.username AS owner, a.status, a.is_saved, a.created_at,
            COALESCE(mc.message_count, 0)::text AS message_count
     FROM email_addresses a JOIN users u ON u.id = a.user_id
     LEFT JOIN (SELECT address_id, COUNT(*) AS message_count FROM messages GROUP BY address_id) mc
       ON mc.address_id = a.id
     WHERE $1 = '' OR a.full_address ILIKE '%' || $1 || '%' OR u.username ILIKE '%' || $1 || '%'
     ORDER BY a.created_at DESC LIMIT 100`,
    [q]
  );
  return json({ addresses: rows });
}

export async function PATCH(request: Request) {
  const auth = await requireAdmin();
  if (!auth) return error("Admin sign-in required.", 401);
  const body = await parseJsonBody(request);
  if (body === undefined) return error("Malformed JSON.", 400);
  if (!checkCsrf(auth.session, request, body)) return error("Invalid CSRF token.", 403);
  const { id, status } = body as { id?: unknown; status?: unknown };
  if (typeof id !== "number" || (status !== "active" && status !== "deactivated")) {
    return error("id and a valid status are required.", 400);
  }
  const { rowCount } = await query(
    "UPDATE email_addresses SET status = $1 WHERE id = $2",
    [status, id]
  );
  if (rowCount === 0) return error("Address not found.", 404);
  await auditLog(auth.admin.id, "admin", `address_${status}`, "email_address", String(id));
  return json({ ok: true });
}

export async function DELETE(request: Request) {
  const auth = await requireAdmin();
  if (!auth) return error("Admin sign-in required.", 401);
  const body = await parseJsonBody(request);
  if (body === undefined) return error("Malformed JSON.", 400);
  if (!checkCsrf(auth.session, request, body)) return error("Invalid CSRF token.", 403);
  const { id } = body as { id?: unknown };
  if (typeof id !== "number") return error("id is required.", 400);
  const { rowCount } = await query("DELETE FROM email_addresses WHERE id = $1", [id]);
  if (rowCount === 0) return error("Address not found.", 404);
  await auditLog(auth.admin.id, "admin", "address_delete", "email_address", String(id));
  return json({ ok: true });
}
