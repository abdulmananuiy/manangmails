"use client";

import { useRouter } from "next/navigation";

export default function AdminLogoutPage() {
  const router = useRouter();
  async function logout() {
    await fetch("/api/admin/logout", { method: "POST" });
    router.push("/admin/login");
    router.refresh();
  }
  return (
    <div className="card">
      <h1>Log out of admin</h1>
      <button onClick={logout}>Log out</button>
    </div>
  );
}
