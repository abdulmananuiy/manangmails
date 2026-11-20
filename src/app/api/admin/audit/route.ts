// GET /api/admin/audit — recent audit log entries (admin only).
import { query } from "@/lib/db";
import { error, json, requireAdmin } from "@/lib/api";

export async function GET(request: Request) {
  const auth = await requireAdmin();
  if (!auth) return error("Admin sign-in required.", 401);
  const url = new URL(request.url);
  const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get("limit") ?? "100", 10) || 100));
  const { rows } = await query<{
    id: number;
    actor_id: number | null;
    actor_type: string;
    action: string;
    target_type: string | null;
    target_id: string | null;
    detail: string | null;
    created_at: string;
  }>(
    `SELECT id, actor_id, actor_type, action, target_type, target_id, detail, created_at
     FROM audit_logs ORDER BY created_at DESC LIMIT $1`,
    [limit]
  );
  return json({ logs: rows });
}
