// /api/addresses — user address management.
// GET    list own addresses (with message counts) + ?q= search
// POST   generate a new random address on the configured domain
// PATCH  toggle saved flag  { id, is_saved }
// DELETE delete an address (and its messages) — irreversible
import { getSetting, query } from "@/lib/db";
import { generateLocalPart, normalizeAddress } from "@/lib/addresses";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import {
  checkCsrf, error, json, parseJsonBody, requireUser,
} from "@/lib/api";

export async function GET(request: Request) {
  const auth = await requireUser();
  if (!auth) return error("Not signed in.", 401);
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
  const { rows } = await query<{
    id: number;
    full_address: string;
    local_part: string;
    status: string;
    is_saved: boolean;
    created_at: string;
    message_count: string;
  }>(
    `SELECT a.id, a.full_address, a.local_part, a.status, a.is_saved, a.created_at,
            COUNT(m.id)::text AS message_count
     FROM email_addresses a
     LEFT JOIN messages m ON m.address_id = a.id
     WHERE a.user_id = $1 AND ($2 = '' OR LOWER(a.full_address) LIKE '%' || $2 || '%')
     GROUP BY a.id ORDER BY a.created_at DESC`,
    [auth.user.id, q]
  );
  const domain = await getSetting("domain");
  return json({ addresses: rows, domain });
}

export async function POST(request: Request) {
  const auth = await requireUser();
  if (!auth) return error("Not signed in.", 401);
  const body = await parseJsonBody(request);
  if (body === undefined) return error("Malformed JSON.", 400);
  if (!checkCsrf(auth.session, request, body)) {
    return error("Invalid CSRF token. Refresh the page and try again.", 403);
  }
  const rl = rateLimit(`gen:${auth.user.id}`, 20, 60_000);
  if (!rl.allowed) return error("Too many addresses generated. Wait a minute.", 429);

  const domain = (await getSetting("domain")) ?? "yourdomain.com";
  const maxPerUser = parseInt((await getSetting("max_addresses_per_user")) ?? "50", 10);
  const { rows: countRows } = await query<{ c: string }>(
    "SELECT COUNT(*)::text AS c FROM email_addresses WHERE user_id = $1 AND status = 'active'",
    [auth.user.id]
  );
  if (parseInt(countRows[0].c, 10) >= maxPerUser) {
    return error(`Address limit reached (${maxPerUser} active addresses).`, 403);
  }

  // Retry on the (very unlikely) unique collision; the DB constraint is the
  // final guarantee against duplicates.
  for (let attempt = 0; attempt < 5; attempt++) {
    const localPart = generateLocalPart(12);
    const full = normalizeAddress(localPart, domain);
    try {
      const { rows } = await query<{ id: number; full_address: string }>(
        `INSERT INTO email_addresses (user_id, full_address, local_part)
         VALUES ($1, $2, $3) RETURNING id, full_address`,
        [auth.user.id, full, localPart]
      );
      return json({ ok: true, address: rows[0] }, 201);
    } catch (err) {
      const e = err as { code?: string };
      if (e.code === "23505") continue; // collision — regenerate
      throw err;
    }
  }
  return error("Could not generate a unique address. Try again.", 500);
}

export async function PATCH(request: Request) {
  const auth = await requireUser();
  if (!auth) return error("Not signed in.", 401);
  const body = await parseJsonBody(request);
  if (body === undefined) return error("Malformed JSON.", 400);
  if (!checkCsrf(auth.session, request, body)) {
    return error("Invalid CSRF token. Refresh the page and try again.", 403);
  }
  const { id, is_saved } = body as { id?: unknown; is_saved?: unknown };
  if (typeof id !== "number" || typeof is_saved !== "boolean") {
    return error("id and is_saved are required.", 400);
  }
  const { rowCount } = await query(
    "UPDATE email_addresses SET is_saved = $1 WHERE id = $2 AND user_id = $3",
    [is_saved, id, auth.user.id]
  );
  if (rowCount === 0) return error("Address not found.", 404);
  return json({ ok: true });
}

export async function DELETE(request: Request) {
  const auth = await requireUser();
  if (!auth) return error("Not signed in.", 401);
  const body = await parseJsonBody(request);
  if (body === undefined) return error("Malformed JSON.", 400);
  if (!checkCsrf(auth.session, request, body)) {
    return error("Invalid CSRF token. Refresh the page and try again.", 403);
  }
  const { id } = body as { id?: unknown };
  if (typeof id !== "number") return error("id is required.", 400);
  const { rowCount } = await query(
    "DELETE FROM email_addresses WHERE id = $1 AND user_id = $2",
    [id, auth.user.id]
  );
  if (rowCount === 0) return error("Address not found.", 404);
  return json({ ok: true });
}
