// Audit logging for admin actions (guide section 14).
import { query } from "./db";

export async function auditLog(
  actorId: number | null,
  actorType: "admin" | "user" | "system",
  action: string,
  targetType?: string | null,
  targetId?: string | null,
  detail?: string | null
): Promise<void> {
  try {
    await query(
      `INSERT INTO audit_logs (actor_id, actor_type, action, target_type, target_id, detail)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [actorId, actorType, action, targetType ?? null, targetId ?? null, detail ?? null]
    );
  } catch (err) {
    console.error("audit log failed", err);
  }
}
