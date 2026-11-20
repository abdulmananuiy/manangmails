import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function AdminAuditPage() {
  const { rows } = await query<{
    id: number;
    actor_id: number | null;
    actor_type: string;
    action: string;
    target_type: string | null;
    target_id: string | null;
    detail: string | null;
    created_at: string;
  }>(
    `SELECT id, actor_id, actor_type, action, target_type, target_id, detail, created_at
     FROM audit_logs ORDER BY created_at DESC LIMIT 200`
  );
  return (
    <>
      <h1>Audit log</h1>
      <div className="card">
        {rows.length === 0 ? (
          <p className="muted">No audit entries yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Actor</th>
                <th>Action</th>
                <th>Target</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l.id}>
                  <td>{new Date(l.created_at).toLocaleString()}</td>
                  <td>
                    {l.actor_type} #{l.actor_id ?? "—"}
                  </td>
                  <td>{l.action}</td>
                  <td>
                    {l.target_type ?? "—"} {l.target_id ?? ""}
                  </td>
                  <td>{l.detail ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
