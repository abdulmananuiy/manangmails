import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function OtpPage() {
  const session = await getSession("user");
  if (!session) redirect("/login");
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
     ORDER BY o.created_at DESC LIMIT 50`,
    [session.id]
  );
  return (
    <>
      <h1>OTP Messages</h1>
      <p className="muted">
        Verification codes detected in your mail. A code is only listed when it
        appears near words like “OTP”, “verification code” or “security code” —
        bare numbers are never treated as codes. Codes are shown only to you,
        the owner of the inbox.
      </p>
      <div className="card">
        {rows.length === 0 ? (
          <p className="muted">No OTP codes detected yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Confidence</th>
                <th>From</th>
                <th>Subject</th>
                <th>To</th>
                <th>Detected</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => (
                <tr key={o.id}>
                  <td>
                    <code style={{ fontSize: 16 }}>{o.code}</code>
                  </td>
                  <td>{Math.round(parseFloat(o.confidence) * 100)}%</td>
                  <td>{o.sender}</td>
                  <td>{o.subject}</td>
                  <td>{o.full_address}</td>
                  <td>{new Date(o.created_at).toLocaleString()}</td>
                  <td>
                    <a href={`/dashboard/inbox/${o.message_id}`}>Open message →</a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
