"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client";

interface Address {
  id: number;
  full_address: string;
  status: string;
  is_saved: boolean;
  created_at: string;
  message_count: string;
}

export default function AddressesPage() {
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [domain, setDomain] = useState("");
  const [receiving, setReceiving] = useState("");
  const [q, setQ] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<number | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/addresses?q=${encodeURIComponent(q)}`);
    if (!res.ok) {
      if (res.status === 401) window.location.href = "/login";
      return;
    }
    const data = await res.json();
    setAddresses(data.addresses);
    setDomain(data.domain);
    const health = await fetch("/api/health").then((r) => r.json()).catch(() => null);
    setReceiving(health?.receiverStatus ?? "NOT_CONFIGURED");
  }, [q]);

  useEffect(() => {
    load();
  }, [load]);

  async function generate() {
    setError("");
    setNotice("");
    setBusy(true);
    try {
      const { ok, data } = await api("/api/addresses", "POST", {});
      if (!ok) {
        setError((data.error as string) ?? "Could not generate an address.");
        return;
      }
      setNotice(`Generated ${(data.address as { full_address: string }).full_address}`);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function toggleSave(a: Address) {
    const { ok, data } = await api("/api/addresses", "PATCH", {
      id: a.id,
      is_saved: !a.is_saved,
    });
    if (!ok) setError((data.error as string) ?? "Failed.");
    else await load();
  }

  async function remove(a: Address) {
    if (!confirm(`Delete ${a.full_address} and all its messages? This cannot be undone.`)) return;
    const { ok, data } = await api("/api/addresses", "DELETE", { id: a.id });
    if (!ok) setError((data.error as string) ?? "Failed.");
    else await load();
  }

  function copy(a: Address) {
    navigator.clipboard?.writeText(a.full_address).catch(() => undefined);
    setCopied(a.id);
    setTimeout(() => setCopied(null), 1500);
  }

  return (
    <>
      <h1>My Addresses</h1>
      {receiving === "NOT_CONFIGURED" && (
        <div className="banner warn">
          <b>Receiving: NOT CONFIGURED.</b> Addresses below are real database
          records on <code>@{domain}</code>, but they cannot receive mail until
          a mail receiver is connected. Do not share them as working inboxes yet.
        </div>
      )}
      <div className="card">
        <button onClick={generate} disabled={busy}>
          {busy ? "Generating…" : "Generate a new address"}
        </button>{" "}
        <span className="muted">Random, unique, on @{domain || "…"}</span>
        {notice && <p className="success-text">{notice}</p>}
        {error && <p className="error-text">{error}</p>}
      </div>
      <div className="card">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search addresses"
          style={{ maxWidth: 420 }}
        />
        {addresses.length === 0 ? (
          <p className="muted">No addresses yet. Generate your first one above.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Address</th>
                <th>Status</th>
                <th>Messages</th>
                <th>Saved</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {addresses.map((a) => (
                <tr key={a.id}>
                  <td>
                    <code>{a.full_address}</code>
                  </td>
                  <td>
                    {a.status === "active" ? (
                      <span className="badge ok">Active</span>
                    ) : (
                      <span className="badge bad">Deactivated</span>
                    )}
                  </td>
                  <td>{a.message_count}</td>
                  <td>{a.is_saved ? "★ Saved" : "—"}</td>
                  <td>
                    <button className="secondary" onClick={() => copy(a)}>
                      {copied === a.id ? "Copied!" : "Copy"}
                    </button>{" "}
                    <button className="secondary" onClick={() => toggleSave(a)}>
                      {a.is_saved ? "Unsave" : "Save"}
                    </button>{" "}
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
