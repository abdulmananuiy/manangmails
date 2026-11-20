// /api/admin/settings — read + update platform settings (audited).
// Allowed keys: domain, max_addresses_per_user, max_message_size_kb,
// retention_days, maintenance_mode, receiver_status.
import { getAllSettings, setSetting } from "@/lib/db";
import { auditLog } from "@/lib/audit";
import { checkCsrf, error, json, parseJsonBody, requireAdmin } from "@/lib/api";

const ALLOWED_KEYS = new Set([
  "domain",
  "max_addresses_per_user",
  "max_message_size_kb",
  "retention_days",
  "maintenance_mode",
  "receiver_status",
]);

export async function GET() {
  const auth = await requireAdmin();
  if (!auth) return error("Admin sign-in required.", 401);
  return json({ settings: await getAllSettings() });
}

export async function PATCH(request: Request) {
  const auth = await requireAdmin();
  if (!auth) return error("Admin sign-in required.", 401);
  const body = await parseJsonBody(request);
  if (body === undefined) return error("Malformed JSON.", 400);
  if (!checkCsrf(auth.session, request, body)) return error("Invalid CSRF token.", 403);
  const { key, value } = body as { key?: unknown; value?: unknown };
  if (typeof key !== "string" || !ALLOWED_KEYS.has(key)) {
    return error("Unknown or disallowed setting key.", 400);
  }
  if (typeof value !== "string" || value.length > 500) {
    return error("value must be a string up to 500 characters.", 400);
  }
  if (key === "domain") {
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(value)) {
      return error("domain must look like example.com.", 400);
    }
  }
  if (key === "maintenance_mode" && value !== "on" && value !== "off") {
    return error("maintenance_mode must be 'on' or 'off'.", 400);
  }
  if (key === "receiver_status" && !["NOT_CONFIGURED", "CONNECTED", "ERROR"].includes(value)) {
    return error("receiver_status must be NOT_CONFIGURED, CONNECTED or ERROR.", 400);
  }
  if (["max_addresses_per_user", "max_message_size_kb", "retention_days"].includes(key)) {
    const n = parseInt(value, 10);
    if (Number.isNaN(n) || n < 0 || n > 100000) {
      return error("value must be a number between 0 and 100000.", 400);
    }
  }
  await setSetting(key, value);
  await auditLog(auth.admin.id, "admin", "setting_update", "platform_setting", key, `${key} = ${value}`);
  return json({ ok: true });
}
