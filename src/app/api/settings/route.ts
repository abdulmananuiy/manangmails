// GET /api/settings — the signed-in user's storage usage + account status.
import { query } from "@/lib/db";
import { error, json, requireUser } from "@/lib/api";

export async function GET() {
  const auth = await requireUser();
  if (!auth) return error("Not signed in.", 401);
  const { rows } = await query<{
    addresses: string;
    messages: string;
    unread: string;
    bytes: string;
  }>(
    `SELECT
       (SELECT COUNT(*)::text FROM email_addresses WHERE user_id = $1) AS addresses,
       (SELECT COUNT(*)::text FROM messages m
          JOIN email_addresses a ON a.id = m.address_id WHERE a.user_id = $1) AS messages,
       (SELECT COUNT(*)::text FROM messages m
          JOIN email_addresses a ON a.id = m.address_id
          WHERE a.user_id = $1 AND m.read_at IS NULL) AS unread,
       (SELECT COALESCE(SUM(octet_length(COALESCE(m.text_body,'')) + octet_length(COALESCE(m.safe_html_body,'')))::text, '0')
          FROM messages m JOIN email_addresses a ON a.id = m.address_id
          WHERE a.user_id = $1) AS bytes`,
    [auth.user.id]
  );
  const r = rows[0];
  return json({
    username: auth.user.username,
    status: auth.user.status,
    addresses: parseInt(r.addresses, 10),
    messages: parseInt(r.messages, 10),
    unread: parseInt(r.unread, 10),
    storageBytes: parseInt(r.bytes, 10),
  });
}
