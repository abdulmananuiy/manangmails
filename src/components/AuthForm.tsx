"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function AuthForm({
  mode,
  admin = false,
}: {
  mode: "login" | "signup";
  admin?: boolean;
}) {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const endpoint = admin
    ? "/api/admin/login"
    : mode === "login"
      ? "/api/auth/login"
      : "/api/auth/signup";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError((data as { error?: string }).error ?? "Something went wrong.");
        return;
      }
      router.push(admin ? "/admin" : "/dashboard");
      router.refresh();
    } catch {
      setError("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h1>
        {admin ? "Admin sign in" : mode === "login" ? "Log in" : "Create account"}
      </h1>
      <form onSubmit={submit}>
        <label htmlFor="username">Username</label>
        <input
          id="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          required
          minLength={3}
          maxLength={50}
        />
        <label htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          required
          minLength={8}
        />
        <p className="muted">
          {mode === "signup"
            ? "Password must be at least 8 characters. It is stored only as a secure hash."
            : "Your password is verified against its secure hash — it is never stored in plain text."}
        </p>
        <button type="submit" disabled={busy}>
          {busy ? "Please wait…" : admin ? "Sign in as admin" : mode === "login" ? "Log in" : "Create account"}
        </button>
        {error && <p className="error-text">{error}</p>}
      </form>
      {!admin && mode === "login" && (
        <p>
          No account yet? <a href="/signup">Create one</a>
        </p>
      )}
      {!admin && mode === "signup" && (
        <p>
          Already have an account? <a href="/login">Log in</a>
        </p>
      )}
    </div>
  );
}
