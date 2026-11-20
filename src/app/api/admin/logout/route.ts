// POST /api/admin/logout — clear the admin session cookie.
import { clearSessionCookie } from "@/lib/auth";
import { json } from "@/lib/api";

export async function POST() {
  await clearSessionCookie("admin");
  return json({ ok: true });
}
