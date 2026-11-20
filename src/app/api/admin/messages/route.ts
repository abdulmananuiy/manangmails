// /api/admin/messages — search message metadata and remove abusive content.
// Admins see metadata + a short text excerpt only, never full bodies by
// default; deletion is audited.
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
    sender: string;
    subject: string;
    excerpt: string;
    received_at: string;
    has_otp: boolean;
  }>(
    `SELECT m.id, a.full_address, u.username AS owner, m.sender, m.subject,
            LEFT(m.text_body, 120) AS excerpt, m.received_at,
            (otp.message_id IS NOT NULL) AS has_otp
     FROM messages m
     JOIN email_addresses a ON a.id = m.address_id
     JOIN users u ON u.id = a.user_id
     LEFT JOIN (SELECT DISTINCT message_id FROM otp_detections) otp
       ON otp.message_id = m.id
     WHERE $1 = '' OR m.sender ILIKE '%' || $1 || '%' OR m.subject ILIKE '%' || $1 || '%'
        OR a.full_address ILIKE '%' || $1 || '%'
     ORDER BY m.received_at DESC LIMIT 100`,
    [q]
  );
  return json({ messages: rows });
}

export async function DELETE(request: Request) {
  const auth = await requireAdmin();
  if (!auth) return error("Admin sign-in required.", 401);
  const body = await parseJsonBody(request);
  if (body === undefined) return error("Malformed JSON.", 400);
  if (!checkCsrf(auth.session, request, body)) return error("Invalid CSRF token.", 403);
  const { id } = body as { id?: unknown };
  if (typeof id !== "number") return error("id is required.", 400);
  const { rowCount } = await query("DELETE FROM messages WHERE id = $1", [id]);
  if (rowCount === 0) return error("Message not found.", 404);
  await auditLog(auth.admin.id, "admin", "message_delete", "message", String(id));
  return json({ ok: true });
}
