// POST /api/auth/login — username/password login for platform users.
// Generic error messages: never reveal whether the username exists.
import { verifyPassword, setSessionCookie } from "@/lib/auth";
import { query } from "@/lib/db";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { error, json, maintenanceModeOn, parseJsonBody } from "@/lib/api";

const GENERIC = "Invalid username or password.";

export async function POST(request: Request) {
  const ip = clientIp(request);
  const rl = rateLimit(`login:${ip}`, 10, 60_000);
  if (!rl.allowed) return error("Too many login attempts. Try again in a minute.", 429);

  const body = await parseJsonBody(request);
  if (body === undefined) return error("Malformed JSON.", 400);
  const { username, password } = (body ?? {}) as { username?: unknown; password?: unknown };
  if (typeof username !== "string" || typeof password !== "string") {
    return error(GENERIC, 401);
  }

  const { rows } = await query<{
    id: number;
    username: string;
    password_hash: string;
    status: string;
  }>("SELECT id, username, password_hash, status FROM users WHERE username = $1", [username]);
  const user = rows[0];
  const ok = user ? await verifyPassword(password, user.password_hash) : false;
  if (!ok) return error(GENERIC, 401);
  if (user.status !== "active") return error("This account is suspended.", 403);
  if (await maintenanceModeOn()) {
    return error("The platform is in maintenance mode. Please try again later.", 503);
  }

  await query("UPDATE users SET last_login_at = NOW() WHERE id = $1", [user.id]);
  const session = await setSessionCookie("user", {
    kind: "user",
    id: user.id,
    username: user.username,
  });
  return json({ ok: true, csrf: session.csrf });
}
