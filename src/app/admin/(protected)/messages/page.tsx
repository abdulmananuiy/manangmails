"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client";

interface Message {
  id: number;
  full_address: string;
  owner: string;
  sender: string;
  subject: string;
  excerpt: string;
  received_at: string;
  has_otp: boolean;
}

export default function AdminMessagesPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [q, setQ] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/messages?q=${encodeURIComponent(q)}`);
    if (!res.ok) {
      if (res.status === 401) window.location.href = "/admin/login";
      return;
    }
    setMessages((await res.json()).messages);
  }, [q]);

  useEffect(() => {
    load();
  }, [load]);

  async function remove(m: Message) {
    if (!confirm(`Delete message "${m.subject}" from ${m.sender}?`)) return;
    const { ok, data } = await api("/api/admin/messages", "DELETE", { id: m.id }, true);
    if (!ok) setError((data.error as string) ?? "Failed.");
    else await load();
  }

  return (
    <>
      <h1>Messages</h1>
      <p className="muted">
        Moderation view shows metadata and a short excerpt only. Delete abusive
        content under the platform owner&apos;s policy; deletions are audit-logged.
      </p>
      {error && <p className="error-text">{error}</p>}
      <div className="card">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search sender, subject or address" style={{ maxWidth: 420 }} />
        {messages.length === 0 ? (
          <p className="muted">No messages found.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>From</th>
                <th>Subject</th>
                <th>To (owner)</th>
                <th>Excerpt</th>
                <th>Received</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {messages.map((m) => (
                <tr key={m.id}>
                  <td>{m.sender}</td>
                  <td>
                    {m.subject}
                    {m.has_otp && <span className="badge info"> OTP</span>}
                  </td>
                  <td>
                    <code>{m.full_address}</code>
                    <br />
                    <span className="muted">{m.owner}</span>
                  </td>
                  <td>{m.excerpt}</td>
                  <td>{new Date(m.received_at).toLocaleString()}</td>
                  <td>
                    <button className="danger" onClick={() => remove(m)}>
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
