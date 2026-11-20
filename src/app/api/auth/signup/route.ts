// POST /api/auth/signup — create a user account.
// Body: { username, password, _csrf? } — CSRF is not required pre-login;
// signup/login are rate-limited instead. Username must be unique.
import { NextResponse } from "next/server";
import { hashPassword } from "@/lib/auth";
import { PUBLIC_POOL_USERNAME } from "@/lib/public-pool";
import { query, getSetting } from "@/lib/db";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { error, json, isValidPassword, isValidUsername, maintenanceModeOn, parseJsonBody } from "@/lib/api";

export async function POST(request: Request) {
  const ip = clientIp(request);
  const rl = rateLimit(`signup:${ip}`, 10, 60_000);
  if (!rl.allowed) return error("Too many signup attempts. Try again shortly.", 429);

  const body = await parseJsonBody(request);
  if (body === undefined) return error("Malformed JSON.", 400);
  const { username, password } = (body ?? {}) as { username?: unknown; password?: unknown };

  if (typeof username !== "string" || !isValidUsername(username)) {
    return error("Username must be 3–50 characters: letters, numbers, _ . -", 400);
  }
  if (username === PUBLIC_POOL_USERNAME) {
    // Reserved: the system account that owns the public address pool.
    return error("That username is reserved. Choose another one.", 400);
  }
  if (typeof password !== "string" || !isValidPassword(password)) {
    return error("Password must be at least 8 characters.", 400);
  }
  if (await maintenanceModeOn()) {
    return error("The platform is in maintenance mode. Signup is temporarily disabled.", 503);
  }

  const passwordHash = await hashPassword(password);
  try {
    const { rows } = await query<{ id: number }>(
      `INSERT INTO users (username, password_hash) VALUES ($1, $2)
       RETURNING id`,
      [username, passwordHash]
    );
    return json({ ok: true, userId: rows[0].id }, 201);
  } catch (err) {
    const e = err as { code?: string };
    if (e.code === "23505") {
      return error("That username is already taken. Choose another one.", 409);
    }
    console.error("signup error", err);
    return error("Could not create the account. Try again later.", 500);
  }
}
