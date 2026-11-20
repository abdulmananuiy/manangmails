// Shared inbound-mail ingestion core.
//
// Used by POST /api/inbound-email (signed JSON events from a receiver) and
// by provider adapters such as POST /api/inbound-email/forwardemail
// (ForwardEmail webhook JSON). All validation, sanitization, dedupe, OTP
// detection, storage and HTTP-code mapping live here so every receiver
// behaves identically; the routes themselves only handle transport-level
// concerns (content type, body size, authentication, rate limiting).
//
// Dedupe note: messages.message_id is UNIQUE on its own (see db/schema.sql),
// so one SMTP message delivered to several of our addresses cannot be stored
// twice under the same message_id. Adapters that fan one event out to
// several recipients must therefore store a suffixed provider message id
// for every recipient after the first, e.g. "<messageId>#<recipient>".
// The suffix is deterministic (derived from the recipient address), so a
// replayed webhook still dedupes instead of creating a second row. The
// first recipient always keeps the bare messageId, so single-recipient
// deliveries are byte-identical to the main route's behaviour.
import { timingSafeEqual } from "crypto";
import { getSetting, query, withTransaction } from "@/lib/db";
import { detectOtp } from "@/lib/otp";
import { sanitizeEmailHtml } from "@/lib/sanitize";

/** Constant-time comparison of two secret strings. */
export function secretsEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** Best-effort audit row for a receiver event. Never throws. */
export async function logReceiverEvent(
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

export interface InboundMessageInput {
  /** Provider event id for audit logging (may be null). */
  providerEventId: string | null;
  /** Recipient address (lowercased by the caller or here — validated). */
  recipient: string;
  sender: string;
  subject: string;
  /** Provider message id; must already be suffixed per recipient when the
   *  same SMTP message is fanned out to several addresses. */
  messageId: string;
  textBody: string;
  htmlBody: string | null;
  /** ISO timestamp or null (defaults to NOW() in storage). */
  receivedAt: string | null;
}

export type InboundStoreResult =
  | { status: "stored"; id: number; otp: string | null }
  | { status: "duplicate" }
  | { status: "unknown_recipient" }
  | { status: "address_inactive" }
  | { status: "validation_error"; message: string; logDetail: string }
  | { status: "stale"; message: string; logDetail: string }
  | { status: "too_large"; message: string; logDetail: string }
  | { status: "maintenance" }
  | { status: "error" };

/**
 * Validate, dedupe and store one inbound message, running OTP detection.
 * Returns a discriminated result; callers map it to HTTP codes and log a
 * receiver_events row. The messages.message_id UNIQUE constraint is the
 * last line of defence against races — a 23505 is reported as "duplicate".
 */
export async function storeInboundMessage(
  input: InboundMessageInput
): Promise<InboundStoreResult> {
  const recipient = input.recipient.trim().toLowerCase();
  const sender = input.sender.trim();
  const subject = input.subject;
  const messageId = input.messageId.trim();
  const textBody = input.textBody;
  const htmlBody = input.htmlBody;
  const receivedAt = input.receivedAt;

  if (!recipient || !recipient.includes("@")) {
    return {
      status: "validation_error",
      message: "recipient is required and must be an email address.",
      logDetail: "bad recipient",
    };
  }
  if (!sender || !sender.includes("@")) {
    return {
      status: "validation_error",
      message: "sender is required and must be an email address.",
      logDetail: "bad sender",
    };
  }
  if (!messageId) {
    return {
      status: "validation_error",
      message: "messageId is required.",
      logDetail: "missing messageId",
    };
  }
  if (receivedAt) {
    const ts = Date.parse(receivedAt);
    if (Number.isNaN(ts)) {
      return {
        status: "validation_error",
        message: "receivedAt must be an ISO timestamp.",
        logDetail: "bad receivedAt",
      };
    }
    // Replay protection: reject events older than 24h or from the future.
    const age = Date.now() - ts;
    if (age > 24 * 3600 * 1000 || age < -5 * 60 * 1000) {
      return {
        status: "stale",
        message: "Event timestamp is out of range.",
        logDetail: "timestamp out of range",
      };
    }
  }

  const maxKb = parseInt(
    (await getSetting("max_message_size_kb")) ?? "1024",
    10
  );
  const totalBytes =
    Buffer.byteLength(textBody, "utf8") +
    Buffer.byteLength(htmlBody ?? "", "utf8");
  if (totalBytes > maxKb * 1024) {
    return {
      status: "too_large",
      message: `Message exceeds the ${maxKb} KB size limit.`,
      logDetail: `message exceeds ${maxKb} KB`,
    };
  }

  // Maintenance mode: refuse ingestion, do not lose the event silently.
  const maintenance = await getSetting("maintenance_mode");
  if (maintenance === "on") {
    return { status: "maintenance" };
  }

  // --- Dedupe + recipient mapping + store (one transaction) --------------
  try {
    const result = await withTransaction(async (db) => {
      const dup = await db.query<{ id: number }>(
        "SELECT id FROM messages WHERE message_id = $1",
        [messageId]
      );
      if (dup.rows.length > 0) return { status: "duplicate" as const };

      const addr = await db.query<{
        id: number;
        user_id: number;
        status: string;
      }>(
        "SELECT id, user_id, status FROM email_addresses WHERE LOWER(full_address) = $1",
        [recipient]
      );
      if (addr.rows.length === 0)
        return { status: "unknown_recipient" as const };
      const address = addr.rows[0];
      if (address.status !== "active")
        return { status: "address_inactive" as const };

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
      return {
        status: "stored" as const,
        id: storedId,
        otp: otp?.code ?? null,
      };
    });

    return result;
  } catch (err) {
    const e = err as { code?: string };
    if (e.code === "23505") {
      // Unique-constraint race on message_id.
      return { status: "duplicate" };
    }
    console.error("inbound-email storage error", err);
    return { status: "error" };
  }
}
