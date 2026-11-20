// POST /api/seed-public — create the 150-address public pool.
// Body: { setupToken } — the same SETUP_TOKEN env var as POST /api/setup.
// Idempotent: re-running creates 0 new addresses and returns the same
// total. Creates NOTHING except pool addresses (no arbitrary addresses, no
// deletions). Wrong or missing token -> 401. This endpoint does NOT create
// or touch admin accounts; /api/setup keeps that job.
import { error, json, parseJsonBody } from "@/lib/api";
import { seedPublicPool, PUBLIC_POOL_SIZE } from "@/lib/public-pool";

export async function POST(request: Request) {
  const body = await parseJsonBody(request);
  if (body === undefined) return error("Malformed JSON.", 400);
  const { setupToken } = (body ?? {}) as { setupToken?: unknown };
  const expected = process.env.SETUP_TOKEN;
  if (
    !expected ||
    typeof setupToken !== "string" ||
    setupToken !== expected
  ) {
    return error("Invalid setup token.", 401);
  }
  try {
    const { created, existing, total } = await seedPublicPool();
    return json({
      ok: true,
      created,
      existing,
      total,
      poolSize: PUBLIC_POOL_SIZE,
    });
  } catch (err) {
    console.error("seed-public error", err);
    return error("Could not seed the public address pool.", 500);
  }
}
