// GET /api/admin/overview — dashboard stats for the admin panel.
import { query } from "@/lib/db";
import { error, json, requireAdmin } from "@/lib/api";

export async function GET() {
  const auth = await requireAdmin();
  if (!auth) return error("Admin sign-in required.", 401);
  const { rows } = await query<{
    users: string;
    active_users: string;
    addresses: string;
    messages: string;
    unread: string;
    otps: string;
    storage_bytes: string;
    events_24h: string;
  }>(
    `SELECT
       (SELECT COUNT(*)::text FROM users) AS users,
       (SELECT COUNT(*)::text FROM users WHERE status = 'active') AS active_users,
       (SELECT COUNT(*)::text FROM email_addresses) AS addresses,
       (SELECT COUNT(*)::text FROM messages) AS messages,
       (SELECT COUNT(*)::text FROM messages WHERE read_at IS NULL) AS unread,
       (SELECT COUNT(*)::text FROM otp_detections) AS otps,
       (SELECT COALESCE(SUM(octet_length(COALESCE(text_body,'')) + octet_length(COALESCE(safe_html_body,'')))::text, '0') FROM messages) AS storage_bytes,
       (SELECT COUNT(*)::text FROM receiver_events WHERE received_at > NOW() - INTERVAL '24 hours') AS events_24h`
  );
  const r = rows[0];
  return json({
    users: parseInt(r.users, 10),
    activeUsers: parseInt(r.active_users, 10),
    addresses: parseInt(r.addresses, 10),
    messages: parseInt(r.messages, 10),
    unread: parseInt(r.unread, 10),
    otps: parseInt(r.otps, 10),
    storageBytes: parseInt(r.storage_bytes, 10),
    receiverEvents24h: parseInt(r.events_24h, 10),
  });
}
