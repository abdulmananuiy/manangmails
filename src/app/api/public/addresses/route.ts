// GET /api/public/addresses — list the public address pool. No login.
// Returns only pool addresses; private addresses are never listed.
import { getSetting } from "@/lib/db";
import { json } from "@/lib/api";
import { listPublicAddresses } from "@/lib/public-pool";

export async function GET() {
  const addresses = await listPublicAddresses();
  const domain = (await getSetting("domain")) ?? "yourdomain.com";
  return json({ addresses, domain, total: addresses.length });
}
