// GET /api/otp — the user's detected OTPs, newest first (paginated).
import { query } from "@/lib/db";
import { error, json, requireUser } from "@/lib/api";

export async function GET(request: Request) {
  const auth = await requireUser();
  if (!auth) return error("Not signed in.", 401);
  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
  const pageSize = 25;
  const { rows } = await query<{
    id: number;
    message_id: number;
    code: string;
    confidence: string;
    matched_pattern: string;
    created_at: string;
    sender: string;
    subject: string;
    full_address: string;
  }>(
    `SELECT o.id, o.message_id, o.code, o.confidence, o.matched_pattern, o.created_at,
            m.sender, m.subject, a.full_address
     FROM otp_detections o
     JOIN messages m ON m.id = o.message_id
     JOIN email_addresses a ON a.id = m.address_id
     WHERE a.user_id = $1
     ORDER BY o.created_at DESC
     LIMIT $2 OFFSET $3`,
    [auth.user.id, pageSize, (page - 1) * pageSize]
  );
  const { rows: countRows } = await query<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM otp_detections o
     JOIN messages m ON m.id = o.message_id
     JOIN email_addresses a ON a.id = m.address_id
     WHERE a.user_id = $1`,
    [auth.user.id]
  );
  return json({ otps: rows, page, total: parseInt(countRows[0].c, 10) });
}
