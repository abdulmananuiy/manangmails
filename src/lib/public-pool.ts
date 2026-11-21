// Public address pool — 150 ready-made addresses usable WITHOUT login.
//
// Ownership design (no schema change): the pool is owned by a dedicated
// system user ("public-pool"). email_addresses.user_id is NOT NULL, so every
// public address is an ordinary address row whose owner is that user. The
// pool user's password is a random bcrypt hash generated at seed time and
// immediately discarded — nobody can ever sign in as it — and signup
// rejects the reserved username, so no real user can claim the account.
//
// Separation guarantees (enforced by every query in this module):
//  - public reads filter by user_id = the pool owner's id, so a private
//    address can NEVER appear in the public list or a public inbox;
//  - private reads filter by user_id = the signed-in user's id (see
//    /api/addresses and /api/messages), so pool addresses never leak there;
//  - the inbound API resolves mail by full_address only, so mail sent to a
//    pool address is stored exactly like mail to a private address.
import { hashPassword, randomToken } from "@/lib/auth";
import { generateLocalPart, normalizeAddress } from "@/lib/addresses";
import { getSetting, query, setSetting } from "@/lib/db";

/** Reserved username of the system account that owns the public pool. */
export const PUBLIC_POOL_USERNAME = "public-pool";

/** Fixed size of the public pool. Seeding caps at this number. */
export const PUBLIC_POOL_SIZE = 150;

/**
 * Strict domain validation for a platform email domain: a bare hostname
 * only — lowercase, at least one dot, labels of [a-z0-9-] that never start
 * or end with a hyphen, each at most 63 chars, total at most 253 chars.
 * Anything else (protocol, slashes, spaces, uppercase, port, trailing
 * dot, missing dot) is rejected. Used by POST /api/seed-public.
 */
export function isValidPublicDomain(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value.length === 0 || value.length > 253) return false;
  const labels = value.split(".");
  if (labels.length < 2) return false;
  for (const label of labels) {
    if (label.length === 0 || label.length > 63) return false;
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(label)) return false;
  }
  return true;
}

export interface PublicAddressRow {
  id: number;
  full_address: string;
  local_part: string;
  status: string;
  created_at: string;
  message_count: string;
}

/** Id of the pool owner user, or null when the pool has not been seeded. */
export async function getPublicOwnerId(): Promise<number | null> {
  const { rows } = await query<{ id: number }>(
    "SELECT id FROM users WHERE username = $1",
    [PUBLIC_POOL_USERNAME]
  );
  return rows[0]?.id ?? null;
}

/** Find the pool owner, creating the system account on first use. */
export async function ensurePublicOwner(): Promise<number> {
  const existing = await getPublicOwnerId();
  if (existing !== null) return existing;
  // Random password, hashed and immediately discarded: the account can
  // never be signed in to. bcrypt cost matches hashPassword() (12).
  const passwordHash = await hashPassword(randomToken(48));
  try {
    const { rows } = await query<{ id: number }>(
      `INSERT INTO users (username, password_hash, status)
       VALUES ($1, $2, 'active') RETURNING id`,
      [PUBLIC_POOL_USERNAME, passwordHash]
    );
    return rows[0].id;
  } catch (err) {
    const e = err as { code?: string };
    if (e.code === "23505") {
      // Lost a race with a concurrent seed — re-read the winner's row.
      const winner = await getPublicOwnerId();
      if (winner !== null) return winner;
    }
    throw err;
  }
}

/** All public (pool) addresses on the CURRENT platform domain with active
 *  status, newest last, with message counts. Addresses from a previous
 *  domain (deactivated by a domain switch) never appear here. */
export async function listPublicAddresses(): Promise<PublicAddressRow[]> {
  const ownerId = await getPublicOwnerId();
  if (ownerId === null) return [];
  const domain = ((await getSetting("domain")) ?? "yourdomain.com").toLowerCase();
  // NOTE: GROUP BY lists every selected column, not just the id.
  // Real Postgres would resolve the rest via the primary-key functional
  // dependency, but pg-mem (used by `npm test`) returns NULL for
  // non-grouped, non-aggregated columns — grouping by all of them returns
  // identical results on both.
  // The local-part alphabet is [a-z0-9] only, so '%@' || domain matches
  // exactly one domain suffix — never a subdomain of it.
  const { rows } = await query<PublicAddressRow>(
    `SELECT a.id, a.full_address, a.local_part, a.status, a.created_at,
            COUNT(m.id)::text AS message_count
     FROM email_addresses a
     LEFT JOIN messages m ON m.address_id = a.id
     WHERE a.user_id = $1 AND a.status = 'active'
       AND LOWER(a.full_address) LIKE '%@' || $2
     GROUP BY a.id, a.full_address, a.local_part, a.status, a.created_at
     ORDER BY a.full_address ASC`,
    [ownerId, domain]
  );
  return rows;
}

/** Resolve a user-supplied address for public lookups: a full address is
 *  used as-is (lowercased); a bare local-part gets the platform domain. */
export function normalizePublicInput(raw: string, domain: string): string {
  const value = raw.trim().toLowerCase();
  if (value.includes("@")) return value;
  return `${value}@${domain.trim().toLowerCase()}`;
}

/** One ACTIVE public address by local-part (case-insensitive), or null.
 *  Deactivated addresses (e.g. from a previous domain) are never returned,
 *  so their public inbox pages 404. */
export async function getPublicAddress(
  localPart: string
): Promise<PublicAddressRow | null> {
  const ownerId = await getPublicOwnerId();
  if (ownerId === null) return null;
  const { rows } = await query<PublicAddressRow>(
    `SELECT a.id, a.full_address, a.local_part, a.status, a.created_at,
            COUNT(m.id)::text AS message_count
     FROM email_addresses a
     LEFT JOIN messages m ON m.address_id = a.id
     WHERE a.user_id = $1 AND a.status = 'active' AND LOWER(a.local_part) = $2
     GROUP BY a.id, a.full_address, a.local_part, a.status, a.created_at`,
    [ownerId, localPart.trim().toLowerCase()]
  );
  return rows[0] ?? null;
}

/** One ACTIVE public address by full address (case-insensitive), or null.
 *  Deactivated addresses (e.g. from a previous domain) are never returned,
 *  so the public inbox API 404s for them. */
export async function getPublicAddressByFull(
  fullAddress: string
): Promise<PublicAddressRow | null> {
  const ownerId = await getPublicOwnerId();
  if (ownerId === null) return null;
  const { rows } = await query<PublicAddressRow>(
    `SELECT a.id, a.full_address, a.local_part, a.status, a.created_at,
            COUNT(m.id)::text AS message_count
     FROM email_addresses a
     LEFT JOIN messages m ON m.address_id = a.id
     WHERE a.user_id = $1 AND a.status = 'active' AND LOWER(a.full_address) = $2
     GROUP BY a.id, a.full_address, a.local_part, a.status, a.created_at`,
    [ownerId, fullAddress.trim().toLowerCase()]
  );
  return rows[0] ?? null;
}

/**
 * Create pool addresses until the pool holds PUBLIC_POOL_SIZE active
 * addresses on the target domain. Idempotent per domain: re-running with
 * the same domain creates 0 new addresses. Never deletes anything and
 * never creates an address outside the pool. Returns counts for the seed
 * endpoint's response.
 *
 * Domain switch: when `targetDomain` is given and differs from the current
 * platform_settings.domain, the setting is updated first, then ALL active
 * pool addresses on the old domain are marked 'deactivated' (the existing
 * status value — no schema change), and 150 fresh unique addresses are
 * seeded on the new domain. Old-domain addresses keep their stored mail
 * but stop showing anywhere public. Re-running the switch with the same
 * new domain is a no-op (switched=false, created=0).
 */
export async function seedPublicPool(targetDomain?: string): Promise<{
  created: number;
  existing: number;
  total: number;
  domain: string;
  switched: boolean;
  deactivated: number;
}> {
  const ownerId = await ensurePublicOwner();
  const currentDomain = (await getSetting("domain")) ?? "yourdomain.com";
  let domain = currentDomain;
  let switched = false;
  let deactivated = 0;
  if (targetDomain !== undefined) {
    if (!isValidPublicDomain(targetDomain)) {
      throw new Error("Invalid domain.");
    }
    domain = targetDomain;
    if (domain !== currentDomain) {
      switched = true;
      // Point the platform at the new domain, then retire the old pool.
      // Deactivation is scoped to the old domain so nothing else is
      // touched; by construction only pool addresses on the old domain
      // are active at this point.
      await setSetting("domain", domain);
      const { rowCount } = await query(
        `UPDATE email_addresses SET status = 'deactivated'
         WHERE user_id = $1 AND status = 'active'
           AND LOWER(full_address) LIKE '%@' || $2`,
        [ownerId, currentDomain.toLowerCase()]
      );
      deactivated = rowCount;
    }
  }
  // Active pool addresses on the (possibly new) domain only — after a
  // switch this is 0, so a full fresh pool of 150 is created below.
  const { rows: countRows } = await query<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM email_addresses
     WHERE user_id = $1 AND status = 'active'
       AND LOWER(full_address) LIKE '%@' || $2`,
    [ownerId, domain.toLowerCase()]
  );
  const existing = parseInt(countRows[0].c, 10);
  let created = 0;
  // Generate one by one; the UNIQUE constraint on full_address plus the
  // retry loop is the final guarantee against duplicates (same pattern as
  // POST /api/addresses for private users).
  while (existing + created < PUBLIC_POOL_SIZE) {
    let inserted = false;
    for (let attempt = 0; attempt < 5 && !inserted; attempt++) {
      const localPart = generateLocalPart(12);
      const full = normalizeAddress(localPart, domain);
      try {
        await query(
          `INSERT INTO email_addresses (user_id, full_address, local_part)
           VALUES ($1, $2, $3)`,
          [ownerId, full, localPart]
        );
        inserted = true;
        created++;
      } catch (err) {
        const e = err as { code?: string };
        if (e.code === "23505") continue; // collision — regenerate
        throw err;
      }
    }
    if (!inserted) {
      throw new Error("Could not generate a unique public address.");
    }
  }
  return { created, existing, total: existing + created, domain, switched, deactivated };
}
