import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getSetting, query, receiverStatusLabel } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await getSession("user");
  if (!session) redirect("/login");

  const status = await receiverStatusLabel();
  const domain = (await getSetting("domain")) ?? "yourdomain.com";
  const { rows } = await query<{
    addresses: string;
    messages: string;
    unread: string;
    otps: string;
    saved: string;
  }>(
    `SELECT
       (SELECT COUNT(*)::text FROM email_addresses WHERE user_id = $1) AS addresses,
       (SELECT COUNT(*)::text FROM messages m JOIN email_addresses a ON a.id = m.address_id WHERE a.user_id = $1) AS messages,
       (SELECT COUNT(*)::text FROM messages m JOIN email_addresses a ON a.id = m.address_id WHERE a.user_id = $1 AND m.read_at IS NULL) AS unread,
       (SELECT COUNT(*)::text FROM otp_detections o JOIN messages m ON m.id = o.message_id JOIN email_addresses a ON a.id = m.address_id WHERE a.user_id = $1) AS otps,
       (SELECT COUNT(*)::text FROM email_addresses WHERE user_id = $1 AND is_saved) AS saved`,
    [session.id]
  );
  const s = rows[0];
  const recent = await query<{
    id: number;
    sender: string;
    subject: string;
    received_at: string;
    full_address: string;
  }>(
    `SELECT m.id, m.sender, m.subject, m.received_at, a.full_address
     FROM messages m JOIN email_addresses a ON a.id = m.address_id
     WHERE a.user_id = $1 ORDER BY m.received_at DESC LIMIT 5`,
    [session.id]
  );

  return (
    <>
      <h1>Welcome, {session.username}</h1>
      {status !== "CONNECTED" ? (
        <div className="banner warn">
          <b>Receiving: NOT CONFIGURED.</b> No mail receiver is connected yet,
          so addresses on <code>@{domain}</code> cannot receive mail right
          now. You can still create an account, generate addresses and use the
          dashboard — delivery starts only once a receiver is connected
          (Admin → Receiver).
        </div>
      ) : (
        <div className="banner ok">
          <b>Receiving: CONNECTED.</b> Mail for <code>@{domain}</code> is being delivered.
        </div>
      )}
      <div className="grid">
        <div className="stat">
          <b>{s.addresses}</b>Addresses
        </div>
        <div className="stat">
          <b>{s.messages}</b>Messages
        </div>
        <div className="stat">
          <b>{s.unread}</b>Unread
        </div>
        <div className="stat">
          <b>{s.otps}</b>OTP detections
        </div>
        <div className="stat">
          <b>{s.saved}</b>Saved addresses
        </div>
      </div>
      <div className="card">
        <h2>Recent messages</h2>
        {recent.rows.length === 0 ? (
          <p className="muted">No messages yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>From</th>
                <th>Subject</th>
                <th>To</th>
                <th>Received</th>
              </tr>
            </thead>
            <tbody>
              {recent.rows.map((m) => (
                <tr key={m.id}>
                  <td>{m.sender}</td>
                  <td>
                    <a href={`/dashboard/inbox/${m.id}`}>{m.subject || "(no subject)"}</a>
                  </td>
                  <td>{m.full_address}</td>
                  <td>{new Date(m.received_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p>
          <a href="/dashboard/inbox">Open full inbox →</a> ·{" "}
          <a href="/dashboard/addresses">Generate an address →</a>
        </p>
      </div>
    </>
  );
}
