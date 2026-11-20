// GET /api/messages/[id] — one message for the viewer (own messages only).
// The HTML body is already sanitized at ingest; it is served as stored.
import { query } from "@/lib/db";
import { error, json, requireUser } from "@/lib/api";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireUser();
  if (!auth) return error("Not signed in.", 401);
  const { id } = await params;
  const messageId = parseInt(id, 10);
  if (Number.isNaN(messageId)) return error("Invalid message id.", 400);

  const { rows } = await query<{
    id: number;
    address_id: number;
    full_address: string;
    sender: string;
    subject: string;
    text_body: string;
    safe_html_body: string | null;
    received_at: string;
    read_at: string | null;
  }>(
    `SELECT m.id, m.address_id, a.full_address, m.sender, m.subject,
            m.text_body, m.safe_html_body, m.received_at, m.read_at
     FROM messages m JOIN email_addresses a ON a.id = m.address_id
     WHERE m.id = $1 AND a.user_id = $2`,
    [messageId, auth.user.id]
  );
  const msg = rows[0];
  if (!msg) return error("Message not found.", 404);

  const otp = await query<{ code: string; confidence: string; matched_pattern: string }>(
    "SELECT code, confidence, matched_pattern FROM otp_detections WHERE message_id = $1 ORDER BY confidence DESC LIMIT 1",
    [messageId]
  );
  // Mark as read on view.
  await query("UPDATE messages SET read_at = COALESCE(read_at, NOW()) WHERE id = $1", [messageId]);
  return json({ message: msg, otp: otp.rows[0] ?? null });
}
