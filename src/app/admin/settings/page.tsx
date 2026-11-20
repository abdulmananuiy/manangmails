"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client";

const FIELDS: { key: string; label: string; hint: string }[] = [
  {
    key: "domain",
    label: "Domain (after @ in generated addresses)",
    hint: "Current domain: manangmails.is-a.dev (is-a.dev subdomain chosen by the owner; registration PR https://github.com/is-a-dev/register/pull/62166 is Open, awaiting maintainer approval — NOT live yet). Change this only to a domain you own and control DNS for. Receiving stays NOT CONFIGURED until a mail receiver is connected.",
  },
  { key: "max_addresses_per_user", label: "Max addresses per user", hint: "Default 50." },
  { key: "max_message_size_kb", label: "Max message size (KB)", hint: "Messages larger than this are rejected by the inbound API. Default 1024." },
  { key: "retention_days", label: "Retention (days, 0 = keep until deleted)", hint: "0 means no automatic deletion." },
  { key: "maintenance_mode", label: "Maintenance mode (on/off)", hint: "When on, user login/signup and inbound mail are refused with a clear message." },
  { key: "receiver_status", label: "Receiver status (NOT_CONFIGURED / CONNECTED / ERROR)", hint: "Set to CONNECTED only after a real receiver is connected AND a real test email has arrived." },
];

export default function AdminSettingsPage() {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    fetch("/api/admin/settings")
      .then((r) => {
        if (r.status === 401) window.location.href = "/admin/login";
        return r.json();
      })
      .then((d) => {
        setSettings(d.settings);
        setDrafts(d.settings);
      })
      .catch(() => undefined);
  }, []);

  async function save(key: string) {
    setError("");
    setNotice("");
    const { ok, data } = await api("/api/admin/settings", "PATCH", { key, value: drafts[key] }, true);
    if (!ok) {
      setError((data.error as string) ?? "Failed.");
      return;
    }
    setSettings((s) => ({ ...s, [key]: drafts[key] }));
    setNotice(`${key} updated.`);
  }

  return (
    <>
      <h1>Settings</h1>
      {error && <p className="error-text">{error}</p>}
      {notice && <p className="success-text">{notice}</p>}
      {FIELDS.map((f) => (
        <div className="card" key={f.key}>
          <label htmlFor={f.key}>{f.label}</label>
          <input
            id={f.key}
            value={drafts[f.key] ?? ""}
            onChange={(e) => setDrafts((d) => ({ ...d, [f.key]: e.target.value }))}
          />
          <p className="muted">{f.hint}</p>
          <p className="muted">Current stored value: <code>{settings[f.key] ?? "—"}</code></p>
          <button onClick={() => save(f.key)}>Save {f.key}</button>
        </div>
      ))}
    </>
  );
}
