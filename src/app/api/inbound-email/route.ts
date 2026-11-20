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
//
// Ingestion itself lives in @/lib/inbound (shared with provider adapters
// such as the ForwardEmail webhook) so validation, dedupe, OTP detection
// and storage behave identically everywhere.
import { createHmac } from "crypto";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { error, json } from "@/lib/api";
import {
  logReceiverEvent,
  secretsEqual,
  storeInboundMessage,
} from "@/lib/inbound";

const MAX_BODY_BYTES = 5 * 1024 * 1024; // hard cap on the JSON event itself

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
    await logReceiverEvent(null, false, "rejected_auth", "invalid signature/secret");
    return error("Invalid signature.", 401);
  }

  // --- Parse + validate --------------------------------------------------
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    await logReceiverEvent(null, true, "rejected_malformed", "invalid JSON");
    return error("Malformed JSON.", 400);
  }

  const providerEventId =
    typeof body.eventId === "string" ? body.eventId : null;
  const recipient =
    typeof body.recipient === "string" ? body.recipient.trim().toLowerCase() : "";
  const sender = typeof body.sender === "string" ? body.sender.trim() : "";
  const subject = typeof body.subject === "string" ? body.subject : "";
  const messageId =
    typeof body.messageId === "string" ? body.messageId.trim() : "";
  const textBody = typeof body.textBody === "string" ? body.textBody : "";
  const htmlBody = typeof body.htmlBody === "string" ? body.htmlBody : null;
  const receivedAt =
    typeof body.receivedAt === "string" ? body.receivedAt : null;

  const result = await storeInboundMessage({
    providerEventId,
    recipient,
    sender,
    subject,
    messageId,
    textBody,
    htmlBody,
    receivedAt,
  });

  switch (result.status) {
    case "stored":
      await logReceiverEvent(providerEventId, true, "stored", messageId);
      return json(
        { ok: true, messageDbId: result.id, otpDetected: result.otp },
        200
      );
    case "duplicate":
      await logReceiverEvent(providerEventId, true, "duplicate", messageId);
      return error("Duplicate messageId — already stored.", 409);
    case "unknown_recipient":
      await logReceiverEvent(
        providerEventId,
        true,
        "rejected_unknown_recipient",
        recipient
      );
      return error("Unknown recipient address.", 404);
    case "address_inactive":
      await logReceiverEvent(
        providerEventId,
        true,
        "rejected_inactive_address",
        recipient
      );
      return error("Recipient address is deactivated.", 404);
    case "validation_error":
      await logReceiverEvent(
        providerEventId,
        true,
        "rejected_validation",
        result.logDetail
      );
      return error(result.message, 400);
    case "stale":
      await logReceiverEvent(
        providerEventId,
        true,
        "rejected_stale",
        result.logDetail
      );
      return error(result.message, 400);
    case "too_large":
      await logReceiverEvent(
        providerEventId,
        true,
        "rejected_size",
        result.logDetail
      );
      return error(result.message, 413);
    case "maintenance":
      await logReceiverEvent(providerEventId, true, "rejected_maintenance");
      return error("Platform is in maintenance mode.", 503);
    case "error":
    default:
      await logReceiverEvent(providerEventId, true, "error", "storage failed");
      return error("Failed to store the message.", 500);
  }
}
