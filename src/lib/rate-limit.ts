// Simple in-memory rate limiter (token bucket per key).
// NOTE: on Vercel serverless functions this is per-instance best-effort, not
// a distributed limiter. It still stops casual abuse and brute force from a
// single instance. For stronger guarantees, front the app with a managed
// rate limiter (e.g. Vercel Firewall / Upstash Ratelimit).
interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

export function rateLimit(
  key: string,
  maxRequests: number,
  windowMs: number
): { allowed: boolean; remaining: number; resetInMs: number } {
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + windowMs };
    buckets.set(key, bucket);
  }
  bucket.count += 1;
  const allowed = bucket.count <= maxRequests;
  return {
    allowed,
    remaining: Math.max(0, maxRequests - bucket.count),
    resetInMs: bucket.resetAt - now,
  };
}

/** Prune old buckets occasionally to bound memory. */
export function pruneRateLimitBuckets(): void {
  const now = Date.now();
  for (const [key, b] of buckets) {
    if (now >= b.resetAt) buckets.delete(key);
  }
}

export function clientIp(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}
