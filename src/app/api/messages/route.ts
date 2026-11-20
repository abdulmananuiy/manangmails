// /api/messages — list own messages (paginated) and mark read / delete.
// GET /api/messages?addressId=&page=&unreadOnly=  -> paginated list
// GET /api/messages/[id] is a separate route (viewer data).
// PATCH { id, read: true } marks a message read.
// DELETE { id } deletes one message.
import { query } from "@/lib/db";
import { checkCsrf, error, json, parseJsonBody, requireUser } from "@/lib/api";

const PAGE_SIZE = 25;

export async function GET(request: Request) {
  const auth = await requireUser();
  if (!auth) return error("Not signed in.", 401);
  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
  const addressId = url.searchParams.get("addressId");
  const unreadOnly = url.searchParams.get("unreadOnly") === "1";
  const q = (url.searchParams.get("q") ?? "").trim();

  const params: unknown[] = [auth.user.id];
  let where = "a.user_id = $1";
  if (addressId) {
    params.push(parseInt(addressId, 10));
    where += ` AND m.address_id = $${params.length}`;
  }
  if (unreadOnly) where += " AND m.read_at IS NULL";
  if (q) {
    params.push(`%${q}%`);
    where += ` AND (m.sender ILIKE $${params.length} OR m.subject ILIKE $${params.length})`;
  }
  const offset = (page - 1) * PAGE_SIZE;
  const { rows } = await query<{
    id: number;
    address_id: number;
    full_address: string;
    sender: string;
    subject: string;
    received_at: string;
    read_at: string | null;
    has_otp: boolean;
  }>(
    `SELECT m.id, m.address_id, a.full_address, m.sender, m.subject,
            m.received_at, m.read_at,
            (otp.message_id IS NOT NULL) AS has_otp
     FROM messages m JOIN email_addresses a ON a.id = m.address_id
     LEFT JOIN (SELECT DISTINCT message_id FROM otp_detections) otp
       ON otp.message_id = m.id
     WHERE ${where}
     ORDER BY m.received_at DESC
     LIMIT ${PAGE_SIZE} OFFSET ${offset}`,
    params
  );
  const { rows: countRows } = await query<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM messages m
     JOIN email_addresses a ON a.id = m.address_id WHERE ${where}`,
    params
  );
  const total = parseInt(countRows[0].c, 10);
  return json({
    messages: rows,
    page,
    pageSize: PAGE_SIZE,
    total,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  });
}

export async function PATCH(request: Request) {
  const auth = await requireUser();
  if (!auth) return error("Not signed in.", 401);
  const body = await parseJsonBody(request);
  if (body === undefined) return error("Malformed JSON.", 400);
  if (!checkCsrf(auth.session, request, body)) {
    return error("Invalid CSRF token. Refresh the page and try again.", 403);
  }
  const { id, read } = body as { id?: unknown; read?: unknown };
  if (typeof id !== "number" || typeof read !== "boolean") {
    return error("id and read are required.", 400);
  }
  const { rowCount } = await query(
    `UPDATE messages m SET read_at = CASE WHEN $1 THEN NOW() ELSE NULL END
     FROM email_addresses a
     WHERE m.id = $2 AND m.address_id = a.id AND a.user_id = $3`,
    [read, id, auth.user.id]
  );
  if (rowCount === 0) return error("Message not found.", 404);
  return json({ ok: true });
}

export async function DELETE(request: Request) {
  const auth = await requireUser();
  if (!auth) return error("Not signed in.", 401);
  const body = await parseJsonBody(request);
  if (body === undefined) return error("Malformed JSON.", 400);
  if (!checkCsrf(auth.session, request, body)) {
    return error("Invalid CSRF token. Refresh the page and try again.", 403);
  }
  const { id } = body as { id?: unknown };
  if (typeof id !== "number") return error("id is required.", 400);
  const { rowCount } = await query(
    `DELETE FROM messages m USING email_addresses a
     WHERE m.id = $1 AND m.address_id = a.id AND a.user_id = $2`,
    [id, auth.user.id]
  );
  if (rowCount === 0) return error("Message not found.", 404);
  return json({ ok: true });
}
