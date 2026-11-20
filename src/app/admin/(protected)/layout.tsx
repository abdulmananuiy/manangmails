import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession("admin");
  if (!session) redirect("/admin/login");
  return (
    <>
      <div className="card">
        <b>Admin panel</b> — signed in as {session.username} ({session.role})
        <nav style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 8 }}>
          <a href="/admin">Overview</a>
          <a href="/admin/users">Users</a>
          <a href="/admin/addresses">Addresses</a>
          <a href="/admin/messages">Messages</a>
          <a href="/admin/receiver">Receiver</a>
          <a href="/admin/settings">Settings</a>
          <a href="/admin/audit">Audit log</a>
          <a href="/admin/logout">Log out</a>
        </nav>
      </div>
      {children}
    </>
  );
}
