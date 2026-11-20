// POST /api/setup — one-time first-admin creation (guide section 19).
// Body: { setupToken, username, password }.
// Works ONLY while no admin exists; afterwards it is permanently disabled.
// The SETUP_TOKEN comes from the environment and is never stored.
import { hashPassword } from "@/lib/auth";
import { query } from "@/lib/db";
import { error, json, isValidPassword, isValidUsername, parseJsonBody } from "@/lib/api";

export async function POST(request: Request) {
  const body = await parseJsonBody(request);
  if (body === undefined) return error("Malformed JSON.", 400);
  const { setupToken, username, password } = body as {
    setupToken?: unknown;
    username?: unknown;
    password?: unknown;
  };
  const expected = process.env.SETUP_TOKEN;
  if (!expected || typeof setupToken !== "string" || setupToken !== expected) {
    return error("Invalid setup token.", 403);
  }
  const { rows } = await query<{ c: string }>(
    "SELECT COUNT(*)::text AS c FROM admins"
  );
  if (parseInt(rows[0].c, 10) > 0) {
    return error("Setup is disabled — an admin already exists.", 403);
  }
  if (typeof username !== "string" || !isValidUsername(username)) {
    return error("Username must be 3–50 characters: letters, numbers, _ . -", 400);
  }
  if (typeof password !== "string" || !isValidPassword(password)) {
    return error("Password must be at least 8 characters.", 400);
  }
  await query(
    `INSERT INTO admins (username, password_hash, role) VALUES ($1, $2, 'superadmin')`,
    [username, await hashPassword(password)]
  );
  return json({ ok: true }, 201);
}
