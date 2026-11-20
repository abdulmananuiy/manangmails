"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client";

interface User {
  id: number;
  username: string;
  status: string;
  created_at: string;
  last_login_at: string | null;
  address_count: string;
  message_count: string;
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [q, setQ] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/users?q=${encodeURIComponent(q)}`);
    if (!res.ok) {
      if (res.status === 401) window.location.href = "/admin/login";
      return;
    }
    setUsers((await res.json()).users);
  }, [q]);

  useEffect(() => {
    load();
  }, [load]);

  async function setStatus(u: User, status: "active" | "suspended") {
    const { ok, data } = await api("/api/admin/users", "PATCH", { id: u.id, status }, true);
    if (!ok) setError((data.error as string) ?? "Failed.");
    else await load();
  }

  return (
    <>
      <h1>Users</h1>
      {error && <p className="error-text">{error}</p>}
      <div className="card">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search username" style={{ maxWidth: 420 }} />
        {users.length === 0 ? (
          <p className="muted">No users found.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Username</th>
                <th>Status</th>
                <th>Addresses</th>
                <th>Messages</th>
                <th>Created</th>
                <th>Last login</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>{u.username}</td>
                  <td>
                    {u.status === "active" ? (
                      <span className="badge ok">Active</span>
                    ) : (
                      <span className="badge bad">Suspended</span>
                    )}
                  </td>
                  <td>{u.address_count}</td>
                  <td>{u.message_count}</td>
                  <td>{new Date(u.created_at).toLocaleString()}</td>
                  <td>{u.last_login_at ? new Date(u.last_login_at).toLocaleString() : "—"}</td>
                  <td>
                    {u.status === "active" ? (
                      <button className="danger" onClick={() => setStatus(u, "suspended")}>
                        Suspend
                      </button>
                    ) : (
                      <button onClick={() => setStatus(u, "active")}>Reactivate</button>
                    )}
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
