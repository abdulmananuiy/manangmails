import { getSession } from "@/lib/auth";
import { query, receiverStatusLabel } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function AdminOverview() {
  const session = await getSession("admin");
  const status = await receiverStatusLabel();
  const { rows } = await query<{
    users: string;
    addresses: string;
    messages: string;
    unread: string;
    otps: string;
    storage_bytes: string;
    events_24h: string;
  }>(
    `SELECT
       (SELECT COUNT(*)::text FROM users) AS users,
       (SELECT COUNT(*)::text FROM email_addresses) AS addresses,
       (SELECT COUNT(*)::text FROM messages) AS messages,
       (SELECT COUNT(*)::text FROM messages WHERE read_at IS NULL) AS unread,
       (SELECT COUNT(*)::text FROM otp_detections) AS otps,
       (SELECT COALESCE(SUM(octet_length(COALESCE(text_body,'')) + octet_length(COALESCE(safe_html_body,'')))::text, '0') FROM messages) AS storage_bytes,
       (SELECT COUNT(*)::text FROM receiver_events WHERE received_at > NOW() - INTERVAL '24 hours') AS events_24h`
  );
  const r = rows[0];
  return (
    <>
      <h1>Admin overview</h1>
      <div className="banner warn">
        <b>Receiving: {status}.</b>{" "}
        {status !== "CONNECTED"
          ? "No mail receiver is connected. Generated addresses cannot receive mail yet."
          : "A receiver is configured. Verify with a real test email."}
      </div>
      <div className="grid">
        <div className="stat"><b>{r.users}</b>Users</div>
        <div className="stat"><b>{r.addresses}</b>Addresses</div>
        <div className="stat"><b>{r.messages}</b>Messages</div>
        <div className="stat"><b>{r.unread}</b>Unread</div>
        <div className="stat"><b>{r.otps}</b>OTP detections</div>
        <div className="stat">
          <b>{(parseInt(r.storage_bytes, 10) / 1024).toFixed(1)} KB</b>Storage used
        </div>
        <div className="stat"><b>{r.events_24h}</b>Receiver events (24h)</div>
      </div>
      <p className="muted">
        Signed in as {session?.username}. Admins can never see user passwords —
        they are stored only as hashes.
      </p>
    </>
  );
}
