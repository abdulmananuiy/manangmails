"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client";

export default function SettingsPage() {
  const router = useRouter();
  const [usage, setUsage] = useState<{
    username: string;
    status: string;
    addresses: number;
    messages: number;
    unread: number;
    storageBytes: number;
  } | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => {
        if (r.status === 401) window.location.href = "/login";
        return r.json();
      })
      .then(setUsage)
      .catch(() => undefined);
  }, []);

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setNotice("");
    const { ok, data } = await api("/api/auth/change-password", "POST", {
      currentPassword,
      newPassword,
    });
    if (!ok) {
      setError((data.error as string) ?? "Failed.");
      return;
    }
    setNotice("Password changed.");
    setCurrentPassword("");
    setNewPassword("");
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  const kb = usage ? (usage.storageBytes / 1024).toFixed(1) : "0";

  return (
    <>
      <h1>Settings</h1>
      <div className="card">
        <h2>Account</h2>
        {usage ? (
          <p>
            Signed in as <b>{usage.username}</b> — status: {usage.status}
            <br />
            Addresses: {usage.addresses} · Messages: {usage.messages} · Unread:{" "}
            {usage.unread}
            <br />
            Storage used: {kb} KB
          </p>
        ) : (
          <p className="muted">Loading…</p>
        )}
        <button className="secondary" onClick={logout}>
          Log out
        </button>
      </div>
      <div className="card">
        <h2>Change password</h2>
        <form onSubmit={changePassword}>
          <label htmlFor="current">Current password</label>
          <input
            id="current"
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
            autoComplete="current-password"
          />
          <label htmlFor="new">New password (min 8 characters)</label>
          <input
            id="new"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
            minLength={8}
            autoComplete="new-password"
          />
          <button type="submit">Change password</button>
          {error && <p className="error-text">{error}</p>}
          {notice && <p className="success-text">{notice}</p>}
        </form>
      </div>
      <div className="card">
        <h2>Forgot your password?</h2>
        <p className="muted">
          There is no recovery email or phone on this platform by design. If
          you forget your password, contact the platform administrator, who
          can reset it through the protected admin procedure. Admins can never
          see your current password — it is stored only as a hash.
        </p>
      </div>
    </>
  );
}
