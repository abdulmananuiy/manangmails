// GET /api/admin/session — same as user session, for the admin panel.
import { json, requireAdmin, error } from "@/lib/api";
import { csrfTokenFor } from "@/lib/csrf";

export async function GET() {
  const auth = await requireAdmin();
  if (!auth) return error("Admin sign-in required.", 401);
  return json({
    username: auth.admin.username,
    role: auth.admin.role,
    csrf: csrfTokenFor(auth.session),
  });
}
