// POST /api/admin/login — separate admin authentication (guide section 14).
import { verifyPassword, setSessionCookie } from "@/lib/auth";
import { query } from "@/lib/db";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { error, json, parseJsonBody } from "@/lib/api";

export async function POST(request: Request) {
  const ip = clientIp(request);
  const rl = rateLimit(`admin-login:${ip}`, 10, 60_000);
  if (!rl.allowed) return error("Too many login attempts. Try again in a minute.", 429);
  const body = await parseJsonBody(request);
  if (body === undefined) return error("Malformed JSON.", 400);
  const { username, password } = body as { username?: unknown; password?: unknown };
  if (typeof username !== "string" || typeof password !== "string") {
    return error("Invalid username or password.", 401);
  }
  const { rows } = await query<{
    id: number;
    username: string;
    password_hash: string;
    role: string;
    status: string;
  }>("SELECT id, username, password_hash, role, status FROM admins WHERE username = $1", [username]);
  const admin = rows[0];
  const ok = admin ? await verifyPassword(password, admin.password_hash) : false;
  if (!ok) return error("Invalid username or password.", 401);
  if (admin.status !== "active") return error("This admin account is suspended.", 403);
  await query("UPDATE admins SET last_login_at = NOW() WHERE id = $1", [admin.id]);
  const session = await setSessionCookie("admin", {
    kind: "admin",
    id: admin.id,
    username: admin.username,
    role: admin.role,
  });
  return json({ ok: true, csrf: session.csrf, role: admin.role });
}
