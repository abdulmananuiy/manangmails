// /public/[localPart]/[id] — one message from a public inbox. No login.
// The message is shown ONLY when it belongs to the named public address;
// any other combination is a 404. Same OTP banner and sanitized-HTML
// rendering as the private message view.
import { notFound } from "next/navigation";
import { query } from "@/lib/db";
import { getPublicAddress } from "@/lib/public-pool";

export const dynamic = "force-dynamic";

export default async function PublicMessagePage({
  params,
}: {
  params: Promise<{ localPart: string; id: string }>;
}) {
  const { localPart, id } = await params;
  const address = await getPublicAddress(localPart);
  if (!address) notFound();
  const messageId = parseInt(id, 10);
  if (Number.isNaN(messageId)) notFound();

  const { rows } = await query<{
    id: number;
    sender: string;
    subject: string;
    text_body: string;
    safe_html_body: string | null;
    received_at: string;
  }>(
    `SELECT m.id, m.sender, m.subject, m.text_body,
            m.safe_html_body, m.received_at
     FROM messages m
     WHERE m.id = $1 AND m.address_id = $2`,
    [messageId, address.id]
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
        <a href={`/public/${address.local_part}`}>← Back to inbox</a>
      </p>
      <div className="card">
        <h1 style={{ fontSize: 20 }}>{msg.subject || "(no subject)"}</h1>
        <p className="muted">
          From: {msg.sender}
          <br />
          To: {address.full_address}
          <br />
          Received: {new Date(msg.received_at).toLocaleString()}
        </p>
        {otp.rows[0] && (
          <div className="banner info">
            <b>Detected code: {otp.rows[0].code}</b> (confidence{" "}
            {Math.round(parseFloat(otp.rows[0].confidence) * 100)}% —{" "}
            {otp.rows[0].matched_pattern}).
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
