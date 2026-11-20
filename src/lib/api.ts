// Shared API helpers: JSON responses, auth guards, CSRF enforcement.
import { NextResponse } from "next/server";
import { getSession, type SessionPayload } from "./auth";
import { verifyCsrf, csrfFromBody } from "./csrf";
import { query } from "./db";

export function json(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

export function error(message: string, status = 400): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

export async function requireUser(): Promise<
  { session: SessionPayload; user: { id: number; username: string; status: string } } | null
> {
  const session = await getSession("user");
  if (!session) return null;
  const { rows } = await query<{
    id: number;
    username: string;
    status: string;
  }>("SELECT id, username, status FROM users WHERE id = $1", [session.id]);
  const user = rows[0];
  if (!user || user.status !== "active") return null;
  return { session, user };
}

export async function requireAdmin(): Promise<
  | { session: SessionPayload; admin: { id: number; username: string; role: string; status: string } }
  | null
> {
  const session = await getSession("admin");
  if (!session) return null;
  const { rows } = await query<{
    id: number;
    username: string;
    role: string;
    status: string;
  }>("SELECT id, username, role, status FROM admins WHERE id = $1", [session.id]);
  const admin = rows[0];
  if (!admin || admin.status !== "active") return null;
  return { session, admin };
}

/** Enforce CSRF on a state-changing request. Body may carry _csrf. */
export function checkCsrf(
  session: SessionPayload,
  request: Request,
  body: unknown = null
): boolean {
  if (verifyCsrf(session, request)) return true;
  const fromBody = csrfFromBody(body);
  return !!fromBody && fromBody === session.csrf;
}

export async function maintenanceModeOn(): Promise<boolean> {
  const { rows } = await query<{ setting_value: string }>(
    "SELECT setting_value FROM platform_settings WHERE setting_key = 'maintenance_mode'"
  );
  return rows[0]?.setting_value === "on";
}

export async function parseJsonBody(request: Request): Promise<unknown> {
  try {
    const text = await request.text();
    if (!text) return null;
    return JSON.parse(text);
  } catch {
    return undefined; // signals malformed JSON
  }
}

export function isValidUsername(username: string): boolean {
  return /^[a-zA-Z0-9_.-]{3,50}$/.test(username);
}

export function isValidPassword(password: string): boolean {
  return typeof password === "string" && password.length >= 8 && password.length <= 128;
}
