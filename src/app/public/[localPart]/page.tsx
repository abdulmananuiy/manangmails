// /public/[localPart] — public inbox of one pool address. No login.
// Only that address's messages are ever shown; anything that is not a
// public pool address (private address, unknown address) is a 404.
import { notFound } from "next/navigation";
import Link from "next/link";
import { query } from "@/lib/db";
import { getPublicAddress } from "@/lib/public-pool";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

export default async function PublicInboxPage({
  params,
  searchParams,
}: {
  params: Promise<{ localPart: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { localPart } = await params;
  const address = await getPublicAddress(localPart);
  if (!address) notFound();
  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;
  const { rows } = await query<{
    id: number;
    sender: string;
    subject: string;
    received_at: string;
    read_at: string | null;
    has_otp: boolean;
  }>(
    `SELECT m.id, m.sender, m.subject, m.received_at, m.read_at,
            (otp.message_id IS NOT NULL) AS has_otp
     FROM messages m
     LEFT JOIN (SELECT DISTINCT message_id FROM otp_detections) otp
       ON otp.message_id = m.id
     WHERE m.address_id = $1
     ORDER BY m.received_at DESC
     LIMIT ${PAGE_SIZE} OFFSET ${offset}`,
    [address.id]
  );
  const { rows: countRows } = await query<{ c: string }>(
    "SELECT COUNT(*)::text AS c FROM messages WHERE address_id = $1",
    [address.id]
  );
  const total = parseInt(countRows[0].c, 10);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const link = (p: number) => `/public/${address.local_part}?page=${p}`;

  return (
    <>
      <p>
        <a href="/public">← All public addresses</a>
      </p>
      <h1>
        Inbox: <code>{address.full_address}</code>
      </h1>
      <p className="muted">
        This is a public inbox — anyone with this link can read these
        messages. Never use a public address for anything private.
      </p>
      <div className="card">
        {rows.length === 0 ? (
          <p className="muted">
            No messages yet. When mail arrives for {address.full_address}, it
            will appear here.
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>From</th>
                <th>Subject</th>
                <th>Received</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id} className={m.read_at ? "" : "unread"}>
                  <td>{m.sender}</td>
                  <td>
                    <Link href={`/public/${address.local_part}/${m.id}`}>
                      {m.subject || "(no subject)"}
                    </Link>
                    {m.has_otp && <span className="badge info"> OTP</span>}
                  </td>
                  <td>{new Date(m.received_at).toLocaleString()}</td>
                  <td>{m.read_at ? "" : <span className="badge warn">Unread</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="pagination">
          <span className="muted">
            Page {page} of {totalPages} ({total} messages)
          </span>
          {page > 1 && <Link href={link(page - 1)}>← Previous</Link>}
          {page < totalPages && <Link href={link(page + 1)}>Next →</Link>}
        </div>
      </div>
    </>
  );
}
