"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client";

interface Address {
  id: number;
  full_address: string;
  owner: string;
  status: string;
  is_saved: boolean;
  created_at: string;
  message_count: string;
}

export default function AdminAddressesPage() {
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [q, setQ] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/addresses?q=${encodeURIComponent(q)}`);
    if (!res.ok) {
      if (res.status === 401) window.location.href = "/admin/login";
      return;
    }
    setAddresses((await res.json()).addresses);
  }, [q]);

  useEffect(() => {
    load();
  }, [load]);

  async function setStatus(a: Address, status: "active" | "deactivated") {
    const { ok, data } = await api("/api/admin/addresses", "PATCH", { id: a.id, status }, true);
    if (!ok) setError((data.error as string) ?? "Failed.");
    else await load();
  }

  async function remove(a: Address) {
    if (!confirm(`Delete ${a.full_address} and all its messages?`)) return;
    const { ok, data } = await api("/api/admin/addresses", "DELETE", { id: a.id }, true);
    if (!ok) setError((data.error as string) ?? "Failed.");
    else await load();
  }

  return (
    <>
      <h1>Addresses</h1>
      {error && <p className="error-text">{error}</p>}
      <div className="card">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search address or owner" style={{ maxWidth: 420 }} />
        {addresses.length === 0 ? (
          <p className="muted">No addresses found.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Address</th>
                <th>Owner</th>
                <th>Status</th>
                <th>Saved</th>
                <th>Messages</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {addresses.map((a) => (
                <tr key={a.id}>
                  <td><code>{a.full_address}</code></td>
                  <td>{a.owner}</td>
                  <td>{a.status}</td>
                  <td>{a.is_saved ? "★" : "—"}</td>
                  <td>{a.message_count}</td>
                  <td>{new Date(a.created_at).toLocaleString()}</td>
                  <td>
                    {a.status === "active" ? (
                      <button className="secondary" onClick={() => setStatus(a, "deactivated")}>
                        Deactivate
                      </button>
                    ) : (
                      <button className="secondary" onClick={() => setStatus(a, "active")}>
                        Activate
                      </button>
                    )}{" "}
                    <button className="danger" onClick={() => remove(a)}>
                      Delete
                    </button>
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
