import { getSetting, query, receiverStatusLabel } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function AdminReceiverPage() {
  const status = await receiverStatusLabel();
  const mode = (process.env.RECEIVER_MODE ?? "none").toLowerCase();
  const domain = (await getSetting("domain")) ?? "yourdomain.com";
  const events = await query<{
    id: number;
    provider_event_id: string | null;
    signature_valid: boolean;
    processing_status: string;
    received_at: string;
    detail: string | null;
  }>(
    `SELECT id, provider_event_id, signature_valid, processing_status,
            received_at, detail
     FROM receiver_events ORDER BY received_at DESC LIMIT 20`
  );

  return (
    <>
      <h1>Receiver status</h1>
      {status === "CONNECTED" ? (
        <div className="banner ok">
          <b>Receiving: CONNECTED.</b> Mode: <code>{mode}</code>. Domain:{" "}
          <code>{domain}</code>.
        </div>
      ) : status === "ERROR" ? (
        <div className="banner error">
          <b>Receiving: ERROR.</b> The receiver reported a problem — check the
          events below and the receiver configuration.
        </div>
      ) : (
        <div className="banner warn">
          <b>Receiving: NOT CONFIGURED.</b> No mail receiver is connected. Mail
          sent to <code>@{domain}</code> will not arrive. Connect Route A (a
          self-hosted mail server, e.g. Postfix) or Route B (an inbound email
          provider) and point it at the secure endpoint{" "}
          <code>POST /api/inbound-email</code> with the shared secret from the
          server environment (<code>INBOUND_API_SECRET</code>). Then set{" "}
          <code>RECEIVER_MODE</code> to <code>provider</code> or{" "}
          <code>selfhosted</code> and set the receiver status to CONNECTED in
          Settings — only after a real test email arrives in the correct inbox.
        </div>
      )}
      <div className="card">
        <h2>How receiving works</h2>
        <ol>
          <li>
            The domain&apos;s MX record points to the mail receiver (not to this
            website).
          </li>
          <li>
            The receiver accepts SMTP mail, validates the recipient, and POSTs a
            signed JSON event to <code>/api/inbound-email</code>.
          </li>
          <li>
            The endpoint verifies the signature, dedupes by message ID, maps
            the recipient to exactly one address, runs OTP detection and stores
            the message.
          </li>
        </ol>
        <p className="muted">
          DNS: add the exact MX/TXT records supplied by your receiver. Do not
          guess record values. SPF/DKIM/DMARC authenticate mail; they do not
          replace MX.
        </p>
      </div>
      <div className="card">
        <h2>Recent receiver events</h2>
        {events.rows.length === 0 ? (
          <p className="muted">No receiver events yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Event ID</th>
                <th>Signature valid</th>
                <th>Status</th>
                <th>Detail</th>
                <th>Received</th>
              </tr>
            </thead>
            <tbody>
              {events.rows.map((e) => (
                <tr key={e.id}>
                  <td>{e.provider_event_id ?? "—"}</td>
                  <td>{e.signature_valid ? "Yes" : "No"}</td>
                  <td>{e.processing_status}</td>
                  <td>{e.detail ?? "—"}</td>
                  <td>{new Date(e.received_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
