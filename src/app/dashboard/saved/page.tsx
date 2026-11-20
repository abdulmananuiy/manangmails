import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function SavedPage() {
  const session = await getSession("user");
  if (!session) redirect("/login");
  const { rows } = await query<{
    id: number;
    full_address: string;
    status: string;
    created_at: string;
    message_count: string;
  }>(
    `SELECT a.id, a.full_address, a.status, a.created_at,
            COALESCE(mc.message_count, 0)::text AS message_count
     FROM email_addresses a
     LEFT JOIN (SELECT address_id, COUNT(*) AS message_count FROM messages GROUP BY address_id) mc
       ON mc.address_id = a.id
     WHERE a.user_id = $1 AND a.is_saved = TRUE
     ORDER BY a.created_at DESC`,
    [session.id]
  );
  return (
    <>
      <h1>Saved Addresses</h1>
      <p className="muted">
        Saved addresses are kept in the database and keep receiving mail while
        active, according to the platform retention policy. Deleting a saved
        address removes it and its messages.
      </p>
      <div className="card">
        {rows.length === 0 ? (
          <p className="muted">
            No saved addresses yet. Save one from <a href="/dashboard/addresses">My Addresses</a>.
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Address</th>
                <th>Status</th>
                <th>Messages</th>
                <th>Saved on</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id}>
                  <td>
                    <code>{a.full_address}</code>
                  </td>
                  <td>{a.status}</td>
                  <td>{a.message_count}</td>
                  <td>{new Date(a.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
