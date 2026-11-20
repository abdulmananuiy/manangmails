import { redirect, notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function MessagePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getSession("user");
  if (!session) redirect("/login");
  const { id } = await params;
  const messageId = parseInt(id, 10);
  if (Number.isNaN(messageId)) notFound();

  const { rows } = await query<{
    id: number;
    full_address: string;
    sender: string;
    subject: string;
    text_body: string;
    safe_html_body: string | null;
    received_at: string;
  }>(
    `SELECT m.id, a.full_address, m.sender, m.subject, m.text_body,
            m.safe_html_body, m.received_at
     FROM messages m JOIN email_addresses a ON a.id = m.address_id
     WHERE m.id = $1 AND a.user_id = $2`,
    [messageId, session.id]
  );
  const msg = rows[0];
  if (!msg) notFound();

  const otp = await query<{ code: string; confidence: string; matched_pattern: string }>(
    "SELECT code, confidence, matched_pattern FROM otp_detections WHERE message_id = $1 ORDER BY confidence DESC LIMIT 1",
    [messageId]
  );
  await query("UPDATE messages SET read_at = COALESCE(read_at, NOW()) WHERE id = $1", [messageId]);

  return (
    <>
      <p>
        <a href="/dashboard/inbox">← Back to inbox</a>
      </p>
      <div className="card">
        <h1 style={{ fontSize: 20 }}>{msg.subject || "(no subject)"}</h1>
        <p className="muted">
          From: {msg.sender}
          <br />
          To: {msg.full_address}
          <br />
          Received: {new Date(msg.received_at).toLocaleString()}
        </p>
        {otp.rows[0] && (
          <div className="banner info">
            <b>Detected code: {otp.rows[0].code}</b> (confidence{" "}
            {Math.round(parseFloat(otp.rows[0].confidence) * 100)}% —{" "}
            {otp.rows[0].matched_pattern}).{" "}
            <a href="/dashboard/otp">See all OTP messages →</a>
          </div>
        )}
      </div>
      <div className="message-body">
        {msg.safe_html_body ? (
          // safe_html_body was sanitized at ingest (scripts, event handlers
          // and remote images removed). Never render raw HTML here.
          <div dangerouslySetInnerHTML={{ __html: msg.safe_html_body }} />
        ) : (
          <pre style={{ whiteSpace: "pre-wrap", background: "none", padding: 0 }}>
            {msg.text_body}
          </pre>
        )}
      </div>
    </>
  );
}
