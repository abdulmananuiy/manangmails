import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/auth";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; addressId?: string; q?: string; unread?: string }>;
}) {
  const session = await getSession("user");
  if (!session) redirect("/login");
  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const addressId = sp.addressId ?? "";
  const q = sp.q ?? "";
  const unreadOnly = sp.unread === "1";

  const params: unknown[] = [session.id];
  let where = "a.user_id = $1";
  if (addressId) {
    params.push(parseInt(addressId, 10));
    where += ` AND m.address_id = $${params.length}`;
  }
  if (unreadOnly) where += " AND m.read_at IS NULL";
  if (q) {
    params.push(`%${q}%`);
    where += ` AND (m.sender ILIKE $${params.length} OR m.subject ILIKE $${params.length})`;
  }
  const { rows } = await query<{
    id: number;
    sender: string;
    subject: string;
    received_at: string;
    read_at: string | null;
    full_address: string;
    has_otp: boolean;
  }>(
    `SELECT m.id, m.sender, m.subject, m.received_at, m.read_at, a.full_address,
            (otp.message_id IS NOT NULL) AS has_otp
     FROM messages m JOIN email_addresses a ON a.id = m.address_id
     LEFT JOIN (SELECT DISTINCT message_id FROM otp_detections) otp
       ON otp.message_id = m.id
     WHERE ${where} ORDER BY m.received_at DESC
     LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`,
    params
  );
  const { rows: countRows } = await query<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM messages m
     JOIN email_addresses a ON a.id = m.address_id WHERE ${where}`,
    params
  );
  const total = parseInt(countRows[0].c, 10);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const addresses = await query<{ id: number; full_address: string }>(
    "SELECT id, full_address FROM email_addresses WHERE user_id = $1 ORDER BY created_at DESC",
    [session.id]
  );

  const link = (p: number) =>
    `/dashboard/inbox?page=${p}${addressId ? `&addressId=${addressId}` : ""}${q ? `&q=${encodeURIComponent(q)}` : ""}${unreadOnly ? "&unread=1" : ""}`;

  return (
    <>
      <h1>Inbox</h1>
      <div className="card">
        <form method="get" action="/dashboard/inbox" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <select name="addressId" defaultValue={addressId}>
            <option value="">All addresses</option>
            {addresses.rows.map((a) => (
              <option key={a.id} value={a.id}>
                {a.full_address}
              </option>
            ))}
          </select>
          <input name="q" defaultValue={q} placeholder="Search sender or subject" />
          <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <input type="checkbox" name="unread" value="1" defaultChecked={unreadOnly} /> Unread only
          </label>
          <button type="submit">Filter</button>
        </form>
      </div>
      <div className="card">
        {rows.length === 0 ? (
          <p className="muted">No messages match. {total === 0 && "When mail arrives for your addresses, it will appear here."}</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>From</th>
                <th>Subject</th>
                <th>To</th>
                <th>Received</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id} className={m.read_at ? "" : "unread"}>
                  <td>{m.sender}</td>
                  <td>
                    <Link href={`/dashboard/inbox/${m.id}`}>{m.subject || "(no subject)"}</Link>
                    {m.has_otp && <span className="badge info"> OTP</span>}
                  </td>
                  <td>{m.full_address}</td>
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
