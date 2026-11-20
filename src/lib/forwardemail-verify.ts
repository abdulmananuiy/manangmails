// Sender verification for ForwardEmail webhooks.
//
// The webhook URL is published in a PUBLIC DNS TXT record on the free plan
// (forward-email=<webhook URL>), so the ?token= in that URL is public by
// design and token-only auth is not enough. ForwardEmail's own FAQ
// documents the free-plan verification: reverse-resolve the sending IP —
// it must be mx1.forwardemail.net or mx2.forwardemail.net.
//
// How the sender IP is read (in priority order):
//   1. x-nf-client-connection-ip — set by Netlify's edge to the IP that
//      connected to it. Netlify guarantees this header and says it uses
//      x-forwarded-for internally, so x-forwarded-for is NOT reliable for
//      the client IP on Netlify. Preferring the Netlify header also means a
//      client-supplied x-forwarded-for can never spoof the check in
//      production: Netlify overwrites this header itself.
//   2. x-forwarded-for (first entry) — the conventional source on other
//      hosts and in local development.
//   3. x-real-ip.
//
// Bypass: if NONE of those headers is present, or the sender is a loopback
// address (local dev, tests, direct curl to the origin — Next.js itself
// injects `x-forwarded-for: ::ffff:127.0.0.1` for local requests), the IP
// check is skipped and the token alone authenticates. In production behind
// Netlify the edge always sets x-nf-client-connection-ip to the real
// internet client IP, so the bypass never triggers there. A request that
// carries forwarding headers but fails the reverse lookup is rejected
// (401) — there is no bypass for a present-but-unverifiable sender.
//
// Reverse DNS: node:dns/promises reverse() with a ~3s timeout race. A
// timeout, a lookup error (e.g. ENOTFOUND — no PTR record), or a result
// with no allowed hostname all fail closed (401). Slow DNS therefore
// rejects the delivery instead of hanging the request; ForwardEmail
// retries webhook deliveries, so a transient DNS failure is retried by
// the provider rather than silently accepted or lost.
//
// Test hook: when NODE_ENV !== "production" AND the env var
// FORWARDEMAIL_DNS_STUB is set to a JSON object mapping IP -> [hostnames],
// the stub is used instead of a real reverse lookup (an IP absent from
// the map resolves to no hostnames, i.e. fails). This exists ONLY so the
// HTTP-level tests can control reverse DNS deterministically without
// network access. It is never set in production; the guard on NODE_ENV
// means a stray value cannot weaken a production deployment.
import { reverse } from "node:dns/promises";

export const FORWARDEMAIL_ALLOWED_HOSTNAMES = [
  "mx1.forwardemail.net",
  "mx2.forwardemail.net",
];

const REVERSE_DNS_TIMEOUT_MS = 3000;

export type SenderVerification =
  | { ok: true; mode: "verified" | "bypass-local" }
  | { ok: false; reason: string; ip: string };

function normalizeHostname(h: string): string {
  return h.trim().toLowerCase().replace(/\.$/, "");
}

/** The IP the request claims to come from, or null when no remote sender can be determined. */
function forwardingIp(request: Request): string | null {
  // Netlify's edge sets x-nf-client-connection-ip to the IP that
  // connected to it. Netlify guarantees this header and says it uses
  // x-forwarded-for internally, so x-forwarded-for is NOT reliable for
  // the client IP on Netlify. Preferring the Netlify header also means a
  // client-supplied x-forwarded-for can never spoof the check in
  // production: Netlify overwrites this header itself.
  const nf = request.headers.get("x-nf-client-connection-ip")?.trim();
  if (nf) return loopbackToNull(nf);
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return loopbackToNull(first);
  }
  const real = request.headers.get("x-real-ip")?.trim();
  if (real) return loopbackToNull(real);
  return null;
}

/**
 * Loopback senders (127.0.0.0/8, ::1, ::ffff:127.0.0.1) are local, not a
 * remote mail server: there is no sender to verify, so they are treated
 * as "no remote sender" and the token alone authenticates. This matters
 * because Next.js itself injects `x-forwarded-for: ::ffff:127.0.0.1` for
 * local requests (dev server, direct curl to the origin), so without this
 * rule local dev and tests would always fail the IP check. In production
 * behind Netlify the edge always sets x-nf-client-connection-ip to the
 * real internet client IP, so a loopback value can never appear there.
 */
function loopbackToNull(ip: string): string | null {
  const v = ip.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (v === "::1") return null;
  const v4 = v.startsWith("::ffff:") ? v.slice("::ffff:".length) : v;
  if (v4.startsWith("127.")) return null;
  return ip.trim();
}

/**
 * Test-only reverse-DNS stub (see header comment). Returns null when no
 * stub is configured or when running in production.
 */
function dnsStub(): Record<string, string[]> | null {
  if (process.env.NODE_ENV === "production") return null;
  const raw = process.env.FORWARDEMAIL_DNS_STUB;
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      const out: Record<string, string[]> = {};
      for (const [ip, hosts] of Object.entries(parsed as Record<string, unknown>)) {
        if (Array.isArray(hosts)) {
          out[ip] = hosts.filter((h): h is string => typeof h === "string");
        }
      }
      return out;
    }
  } catch {
    // A malformed stub fails closed: no hostnames resolve.
    return {};
  }
  return null;
}

/** Reverse-resolve an IP to hostnames. Never throws; failures yield []. */
async function reverseHostnames(ip: string): Promise<string[]> {
  const stub = dnsStub();
  if (stub) return stub[ip] ?? [];

  try {
    const hostnames = await Promise.race([
      reverse(ip),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("reverse DNS timeout")), REVERSE_DNS_TIMEOUT_MS)
      ),
    ]);
    return hostnames.map(normalizeHostname);
  } catch {
    // Timeout, ENOTFOUND (no PTR record), or any DNS error: fail closed.
    return [];
  }
}

/**
 * Verify the sender of a ForwardEmail webhook request.
 * - No forwarding headers at all, or a loopback sender (local dev /
 *   tests / direct curl) -> { ok: true, mode: "bypass-local" }. In
 *   production behind Netlify the edge always sets
 *   x-nf-client-connection-ip to the real client IP, so this never
 *   triggers there.
 * - Reverse lookup returns an allowed ForwardEmail hostname -> verified.
 * - Anything else (lookup failure, timeout, non-ForwardEmail host) -> 401.
 */
export async function verifyForwardEmailSender(
  request: Request
): Promise<SenderVerification> {
  const ip = forwardingIp(request);
  if (!ip) return { ok: true, mode: "bypass-local" };

  const hostnames = await reverseHostnames(ip);
  const allowed = hostnames.some((h) => {
    const n = normalizeHostname(h);
    return (
      FORWARDEMAIL_ALLOWED_HOSTNAMES.includes(n) ||
      n.endsWith(".forwardemail.net")
    );
  });
  if (allowed) return { ok: true, mode: "verified" };
  return {
    ok: false,
    reason: "sender IP did not reverse-resolve to mx1/mx2.forwardemail.net",
    ip,
  };
}
