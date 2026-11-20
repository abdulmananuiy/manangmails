// Authentication: bcrypt password hashing + HMAC-signed session cookies.
// Passwords are stored ONLY as hashes and are never shown to admins.
// Sessions are stateless signed cookies (no server-side session store), so
// they work on Vercel serverless functions.
import bcrypt from "bcryptjs";
import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";

const SESSION_COOKIE = "ep_session";
const ADMIN_COOKIE = "ep_admin_session";
const MAX_AGE_SECONDS = 7 * 24 * 60 * 60; // 7 days

export type SessionKind = "user" | "admin";

export interface SessionPayload {
  kind: SessionKind;
  id: number;
  username: string;
  role?: string;
  iat: number;
  exp: number;
  csrf: string;
}

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) {
    throw new Error("SESSION_SECRET must be set to at least 32 characters");
  }
  return s;
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12);
}

export async function verifyPassword(
  plain: string,
  hash: string
): Promise<boolean> {
  if (!plain || !hash) return false;
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}

function b64url(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}

function sign(data: string): string {
  return createHmac("sha256", secret()).update(data).digest("base64url");
}

export function createSessionToken(payload: Omit<SessionPayload, "iat" | "exp" | "csrf">): string {
  const full: SessionPayload = {
    ...payload,
    csrf: randomToken(24),
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + MAX_AGE_SECONDS,
  };
  const body = b64url(JSON.stringify(full));
  return `${body}.${sign(body)}`;
}

export function verifySessionToken(
  token: string | undefined | null,
  expectedKind: SessionKind
): SessionPayload | null {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = sign(body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8")
    ) as SessionPayload;
    if (payload.kind !== expectedKind) return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function setSessionCookie(
  kind: SessionKind,
  payload: Omit<SessionPayload, "iat" | "exp" | "csrf">
): Promise<SessionPayload> {
  const token = createSessionToken(payload);
  const verified = verifySessionToken(token, kind)!;
  const store = await cookies();
  store.set(kind === "admin" ? ADMIN_COOKIE : SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
  return verified;
}

export async function clearSessionCookie(kind: SessionKind): Promise<void> {
  const store = await cookies();
  store.delete(kind === "admin" ? ADMIN_COOKIE : SESSION_COOKIE);
}

export async function getSession(kind: SessionKind): Promise<SessionPayload | null> {
  const store = await cookies();
  const token = store.get(kind === "admin" ? ADMIN_COOKIE : SESSION_COOKIE)?.value;
  return verifySessionToken(token, kind);
}

export function randomToken(bytes = 32): string {
  return require("crypto").randomBytes(bytes).toString("hex");
}
