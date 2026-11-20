// POST /api/auth/logout — clear the user session cookie.
import { clearSessionCookie } from "@/lib/auth";
import { json } from "@/lib/api";

export async function POST() {
  await clearSessionCookie("user");
  return json({ ok: true });
}
