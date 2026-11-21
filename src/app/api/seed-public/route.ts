// POST /api/seed-public — create the 150-address public pool.
// Body: { setupToken, domain? } — the same SETUP_TOKEN env var as
// POST /api/setup. `domain` is optional: when given and different from the
// current platform domain, the platform domain is switched to it, ALL
// active pool addresses on the old domain are marked 'deactivated', and
// 150 fresh addresses are seeded on the new domain. Idempotent per
// domain: re-running with the same domain creates 0 new addresses and
// returns the same total. Creates NOTHING except pool addresses (no
// arbitrary addresses, no deletions). Wrong or missing token -> 401.
// Invalid domain -> 400. This endpoint does NOT create or touch admin
// accounts; /api/setup keeps that job.
import { error, json, parseJsonBody } from "@/lib/api";
import {
  seedPublicPool,
  isValidPublicDomain,
  PUBLIC_POOL_SIZE,
} from "@/lib/public-pool";

export async function POST(request: Request) {
  const body = await parseJsonBody(request);
  if (body === undefined) return error("Malformed JSON.", 400);
  const { setupToken, domain } = (body ?? {}) as {
    setupToken?: unknown;
    domain?: unknown;
  };
  const expected = process.env.SETUP_TOKEN;
  if (
    !expected ||
    typeof setupToken !== "string" ||
    setupToken !== expected
  ) {
    return error("Invalid setup token.", 401);
  }
  if (domain !== undefined && !isValidPublicDomain(domain)) {
    return error(
      "Invalid domain. Use a bare lowercase hostname, e.g. mail.example.com.",
      400
    );
  }
  try {
    const result = await seedPublicPool(domain);
    return json({
      ok: true,
      ...result,
      poolSize: PUBLIC_POOL_SIZE,
    });
  } catch (err) {
    console.error("seed-public error", err);
    return error("Could not seed the public address pool.", 500);
  }
}
