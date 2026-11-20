// GET /api/public/inbox?address=<full address> — read-only public inbox.
// No login. Returns ONLY the messages of the named PUBLIC address:
//  - 400 when ?address= is missing
//  - 404 when the address is not a public pool address (this also covers
//    private addresses and unknown addresses — a private address is never
//    exposed through this route)
//  - 200 { address, messages, page, pageSize, total, totalPages }
import { getSetting, query } from "@/lib/db";
import { error, json } from "@/lib/api";
import { getPublicAddressByFull, normalizePublicInput } from "@/lib/public-pool";

const PAGE_SIZE = 25;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const raw = (url.searchParams.get("address") ?? "").trim();
  if (!raw) return error("Query parameter ?address= is required.", 400);
  const domain = (await getSetting("domain")) ?? "yourdomain.com";
  const full = normalizePublicInput(raw, domain);
  const address = await getPublicAddressByFull(full);
  if (!address) return error("Address not found.", 404);
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;
  const { rows } = await query<{
    id: number;
    sender: string;
    subject: string;
    received_at: string;
    read_at: string | null;
    has_otp: boolean;
  }>(
    `SELECT m.id, m.sender, m.subject, m.received_at, m.read_at,
            (otp.message_id IS NOT NULL) AS has_otp
     FROM messages m
     LEFT JOIN (SELECT DISTINCT message_id FROM otp_detections) otp
       ON otp.message_id = m.id
     WHERE m.address_id = $1
     ORDER BY m.received_at DESC
     LIMIT ${PAGE_SIZE} OFFSET ${offset}`,
    [address.id]
  );
  const { rows: countRows } = await query<{ c: string }>(
    "SELECT COUNT(*)::text AS c FROM messages WHERE address_id = $1",
    [address.id]
  );
  const total = parseInt(countRows[0].c, 10);
  return json({
    address: address.full_address,
    messages: rows,
    page,
    pageSize: PAGE_SIZE,
    total,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  });
}
