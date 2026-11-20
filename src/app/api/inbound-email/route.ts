// POST /api/inbound-email — secure ingestion endpoint for the mail receiver.
// The receiver (Route A self-hosted server or Route B provider) POSTs a signed
// JSON event after accepting an SMTP message. This endpoint:
//  - accepts only POST + application/json
//  - authenticates via `x-api-secret` (shared secret) or `x-signature`
//    (HMAC-SHA256 hex of the raw body, keyed by the same secret)
//  - validates recipient/sender/messageId/timestamps and size limits
//  - rejects duplicate message IDs (409) and unknown recipients (404)
//  - maps the recipient to exactly ONE active address/user
//  - runs OTP detection, stores the message, marks it unread
//  - logs the receiver event (without secrets or full bodies)
//  - returns accurate HTTP codes; never returns success if storage failed.
// No receiver is connected yet (Route C): this endpoint exists and is fully
// working for when a receiver is connected. It does NOT accept raw SMTP.
import { createHmac, timingSafeEqual } from "crypto";
import { getSetting, query, withTransaction } from "@/lib/db";
import { detectOtp } from "@/lib/otp";
import { sanitizeEmailHtml } from "@/lib/sanitize";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { error, json } from "@/lib/api";

const MAX_BODY_BYTES = 5 * 1024 * 1024; // hard cap on the JSON event itself

function secretsEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

async function logEvent(
  providerEventId: string | null,
  signatureValid: boolean,
  status: string,
  detail?: string
): Promise<void> {
  try {
    await query(
      `INSERT INTO receiver_events (provider_event_id, signature_valid, processing_status, detail)
       VALUES ($1, $2, $3, $4)`,
      [providerEventId, signatureValid, status, detail ?? null]
    );
  } catch (e) {
    console.error("receiver_events log failed", e);
  }
}

export async function POST(request: Request) {
  const ip = clientIp(request);
  const rl = rateLimit(`inbound:${ip}`, 120, 60_000);
  if (!rl.allowed) return error("Rate limit exceeded.", 429);

  const secret = process.env.INBOUND_API_SECRET;
  if (!secret) {
    console.error("INBOUND_API_SECRET is not configured");
    return error("Inbound endpoint is not configured.", 503);
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return error("Content-Type must be application/json.", 415);
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return error("Event too large.", 413);
  }

  // --- Authentication: shared secret header OR HMAC signature ----------
  const apiSecret = request.headers.get("x-api-secret") ?? "";
  const signature = request.headers.get("x-signature") ?? "";
  let signatureValid = false;
  if (apiSecret && secretsEqual(apiSecret, secret)) signatureValid = true;
  if (!signatureValid && signature) {
    const expected = createHmac("sha256", secret).update(raw).digest("hex");
    if (secretsEqual(signature.toLowerCase(), expected)) signatureValid = true;
  }
  if (!signatureValid) {
    await logEvent(null, false, "rejected_auth", "invalid signature/secret");
    return error("Invalid signature.", 401);
  }

  // --- Parse + validate --------------------------------------------------
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    await logEvent(null, true, "rejected_malformed", "invalid JSON");
    return error("Malformed JSON.", 400);
  }

  const providerEventId =
    typeof body.eventId === "string" ? body.eventId : null;
  const recipient = typeof body.recipient === "string" ? body.recipient.trim().toLowerCase() : "";
  const sender = typeof body.sender === "string" ? body.sender.trim() : "";
  const subject = typeof body.subject === "string" ? body.subject : "";
  const messageId = typeof body.messageId === "string" ? body.messageId.trim() : "";
  const textBody = typeof body.textBody === "string" ? body.textBody : "";
  const htmlBody = typeof body.htmlBody === "string" ? body.htmlBody : null;
  const receivedAt =
    typeof body.receivedAt === "string" ? body.receivedAt : null;

  if (!recipient || !recipient.includes("@")) {
    await logEvent(providerEventId, true, "rejected_validation", "bad recipient");
    return error("recipient is required and must be an email address.", 400);
  }
  if (!sender || !sender.includes("@")) {
    await logEvent(providerEventId, true, "rejected_validation", "bad sender");
    return error("sender is required and must be an email address.", 400);
  }
  if (!messageId) {
    await logEvent(providerEventId, true, "rejected_validation", "missing messageId");
    return error("messageId is required.", 400);
  }
  if (receivedAt) {
    const ts = Date.parse(receivedAt);
    if (Number.isNaN(ts)) {
      await logEvent(providerEventId, true, "rejected_validation", "bad receivedAt");
      return error("receivedAt must be an ISO timestamp.", 400);
    }
    // Replay protection: reject events older than 24h or from the future.
    const age = Date.now() - ts;
    if (age > 24 * 3600 * 1000 || age < -5 * 60 * 1000) {
      await logEvent(providerEventId, true, "rejected_stale", "timestamp out of range");
      return error("Event timestamp is out of range.", 400);
    }
  }

  const maxKb = parseInt((await getSetting("max_message_size_kb")) ?? "1024", 10);
  const totalBytes = Buffer.byteLength(textBody, "utf8") + Buffer.byteLength(htmlBody ?? "", "utf8");
  if (totalBytes > maxKb * 1024) {
    await logEvent(providerEventId, true, "rejected_size", `message exceeds ${maxKb} KB`);
    return error(`Message exceeds the ${maxKb} KB size limit.`, 413);
  }

  // Maintenance mode: refuse ingestion, do not lose the event silently.
  const maintenance = await getSetting("maintenance_mode");
  if (maintenance === "on") {
    await logEvent(providerEventId, true, "rejected_maintenance");
    return error("Platform is in maintenance mode.", 503);
  }

  // --- Dedupe + recipient mapping + store (one transaction) --------------
  try {
    const result = await withTransaction(async (db) => {
      const dup = await db.query<{ id: number }>(
        "SELECT id FROM messages WHERE message_id = $1",
        [messageId]
      );
      if (dup.rows.length > 0) return { status: "duplicate" as const };

      const addr = await db.query<{ id: number; user_id: number; status: string }>(
        "SELECT id, user_id, status FROM email_addresses WHERE LOWER(full_address) = $1",
        [recipient]
      );
      if (addr.rows.length === 0) return { status: "unknown_recipient" as const };
      const address = addr.rows[0];
      if (address.status !== "active") return { status: "address_inactive" as const };

      const safeHtml = htmlBody ? sanitizeEmailHtml(htmlBody) : null;
      const { rows } = await db.query<{ id: number }>(
        `INSERT INTO messages
           (address_id, message_id, sender, subject, text_body, safe_html_body, received_at)
         VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::timestamptz, NOW()))
         RETURNING id`,
        [
          address.id,
          messageId,
          sender,
          subject.slice(0, 1000),
          textBody,
          safeHtml,
          receivedAt,
        ]
      );
      const storedId = rows[0].id;
      const otp = detectOtp(subject, textBody);
      if (otp) {
        await db.query(
          `INSERT INTO otp_detections (message_id, code, confidence, matched_pattern)
           VALUES ($1, $2, $3, $4)`,
          [storedId, otp.code, otp.confidence, otp.matchedPattern]
        );
      }
      return { status: "stored" as const, id: storedId, otp: otp?.code ?? null };
    });

    if (result.status === "duplicate") {
      await logEvent(providerEventId, true, "duplicate", messageId);
      return error("Duplicate messageId — already stored.", 409);
    }
    if (result.status === "unknown_recipient") {
      await logEvent(providerEventId, true, "rejected_unknown_recipient", recipient);
      return error("Unknown recipient address.", 404);
    }
    if (result.status === "address_inactive") {
      await logEvent(providerEventId, true, "rejected_inactive_address", recipient);
      return error("Recipient address is deactivated.", 404);
    }
    await logEvent(providerEventId, true, "stored", messageId);
    return json({ ok: true, messageDbId: result.id, otpDetected: result.otp }, 200);
  } catch (err) {
    const e = err as { code?: string };
    if (e.code === "23505") {
      // Unique-constraint race on message_id.
      await logEvent(providerEventId, true, "duplicate", messageId);
      return error("Duplicate messageId — already stored.", 409);
    }
    console.error("inbound-email storage error", err);
    await logEvent(providerEventId, true, "error", "storage failed");
    return error("Failed to store the message.", 500);
  }
}
