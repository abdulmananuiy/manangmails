// POST /api/inbound-email/forwardemail — ForwardEmail webhook adapter.
//
// ForwardEmail (free plan) POSTs each incoming email as JSON — the output of
// mailparser's simpleParser — to the webhook URL configured in a DNS TXT
// record. The free plan sends no X-Webhook-Signature header, so this route
// authenticates with a secret query parameter instead:
//
//   https://manangmails.netlify.app/api/inbound-email/forwardemail?token=<INBOUND_API_SECRET>
//
// The token is compared to INBOUND_API_SECRET with timingSafeEqual; a
// wrong or missing token is rejected (401) and the token is never logged.
//
// Payload shape (mailparser output): attachments[], headers, headerLines[],
// html, text, textAsHtml, date (ISO string), from/to { value: [{ address,
// name }], html, text }, subject, messageId, raw, recipients[] (every
// address sharing the endpoint — ONE request carries all of them), session
// { recipient, remoteAddress, clientHostname, sender, mta, arrivalDate }.
//
// Mapping:
//  - one message is stored PER recipient address in recipients[] (fallback:
//    session.recipient, else to.value[0].address). messages.message_id is
//    UNIQUE, so recipients after the first are stored under a deterministic
//    suffixed id "<messageId>#<recipient>" — a replayed webhook still
//    dedupes (409) instead of creating a second row.
//  - sender = from.value[0].address (fallback: session.sender); subject
//    defaults to "(no subject)"; textBody = text, or plain text derived
//    from html when text is absent; receivedAt = session.arrivalDate,
//    else the mail Date header, else now.
//  - messageId missing -> derived stable id "fe-" + sha256(raw body)[0:32].
//  - attachments are NOT stored (the messages table has no attachment
//    column); they are ignored.
//
// Guards mirror the main /api/inbound-email route: JSON only (415), body
// cap 5 MB (413), per-IP rate limit, unknown recipient (404), duplicate
// (409), success (200). A receiver_events row is logged per recipient
// outcome. Success is never returned when storage failed.
//
// Receiving status is NOT flipped here: RECEIVER_MODE / receiver_status
// stay NOT_CONFIGURED until a real test email lands in the correct inbox
// and an admin marks the receiver connected.
import { createHash } from "crypto";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { error, json } from "@/lib/api";
import { htmlToText } from "@/lib/sanitize";
import {
  logReceiverEvent,
  secretsEqual,
  storeInboundMessage,
  type InboundStoreResult,
} from "@/lib/inbound";

const MAX_BODY_BYTES = 5 * 1024 * 1024; // hard cap on the JSON event itself

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function asString(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

/** First address from a mailparser address object { value: [{ address }] }. */
function firstAddress(container: unknown): string | null {
  const rec = asRecord(container);
  const value = rec?.value;
  if (Array.isArray(value) && value.length > 0) {
    const entry = asRecord(value[0]);
    const addr = asString(entry?.address);
    return addr ? addr.trim() : null;
  }
  return null;
}

/** All recipient addresses, deduped and lowercased, in delivery order. */
function extractRecipients(body: Record<string, unknown>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (addr: string | null | undefined) => {
    if (!addr) return;
    const a = addr.trim().toLowerCase();
    if (a.includes("@") && !seen.has(a)) {
      seen.add(a);
      out.push(a);
    }
  };
  const recips = body.recipients;
  if (Array.isArray(recips)) {
    for (const r of recips) push(typeof r === "string" ? r : null);
  }
  if (out.length === 0) {
    const session = asRecord(body.session);
    push(asString(session?.recipient));
  }
  if (out.length === 0) push(firstAddress(body.to));
  return out;
}

type RecipientOutcome = {
  recipient: string;
  status: InboundStoreResult["status"];
  messageDbId?: number;
  otpDetected?: string | null;
};

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

  // --- Authentication: secret query param (no signature on free plan) ----
  const url = new URL(request.url);
  const token = url.searchParams.get("token") ?? "";
  const tokenValid = token !== "" && secretsEqual(token, secret);
  if (!tokenValid) {
    // Never log the token value.
    await logReceiverEvent(null, false, "rejected_auth", "invalid token");
    return error("Invalid token.", 401);
  }

  // --- Parse ---------------------------------------------------------------
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    await logReceiverEvent(null, true, "rejected_malformed", "invalid JSON");
    return error("Malformed JSON.", 400);
  }

  const recipients = extractRecipients(body);
  if (recipients.length === 0) {
    await logReceiverEvent(null, true, "rejected_validation", "no recipient");
    return error("No recipient address found in payload.", 400);
  }

  const session = asRecord(body.session);
  const sender =
    firstAddress(body.from) ?? asString(session?.sender)?.trim() ?? "";
  const subject = asString(body.subject) ?? "(no subject)";
  const htmlBody = asString(body.html);
  const textBody =
    asString(body.text) ?? (htmlBody ? htmlToText(htmlBody) : "");
  const receivedAt =
    asString(session?.arrivalDate) ?? asString(body.date) ?? null;

  // messageId: mailparser's Message-ID, or a stable derived id so dedupe
  // still works when the provider omits it (same payload -> same id).
  const rawMessageId = asString(body.messageId)?.trim() ?? "";
  const messageId =
    rawMessageId ||
    `fe-${createHash("sha256").update(raw).digest("hex").slice(0, 32)}`;

  // --- Store one message per recipient --------------------------------------
  const outcomes: RecipientOutcome[] = [];
  for (let i = 0; i < recipients.length; i++) {
    const recipient = recipients[i];
    // messages.message_id is UNIQUE: only the first recipient keeps the
    // bare messageId; later recipients get a deterministic suffix.
    const storedMessageId =
      i === 0 ? messageId : `${messageId}#${recipient}`;
    const result = await storeInboundMessage({
      providerEventId: messageId,
      recipient,
      sender,
      subject,
      messageId: storedMessageId,
      textBody,
      htmlBody,
      receivedAt,
    });

    const outcome: RecipientOutcome = {
      recipient,
      status: result.status,
    };
    if (result.status === "stored") {
      outcome.messageDbId = result.id;
      outcome.otpDetected = result.otp;
      await logReceiverEvent(messageId, true, "stored", recipient);
    } else if (result.status === "duplicate") {
      await logReceiverEvent(messageId, true, "duplicate", storedMessageId);
    } else if (result.status === "unknown_recipient") {
      await logReceiverEvent(
        messageId,
        true,
        "rejected_unknown_recipient",
        recipient
      );
    } else if (result.status === "address_inactive") {
      await logReceiverEvent(
        messageId,
        true,
        "rejected_inactive_address",
        recipient
      );
    } else if (result.status === "validation_error") {
      await logReceiverEvent(
        messageId,
        true,
        "rejected_validation",
        result.logDetail
      );
    } else if (result.status === "stale") {
      await logReceiverEvent(messageId, true, "rejected_stale", result.logDetail);
    } else if (result.status === "too_large") {
      await logReceiverEvent(messageId, true, "rejected_size", result.logDetail);
    } else if (result.status === "maintenance") {
      await logReceiverEvent(messageId, true, "rejected_maintenance");
    } else {
      await logReceiverEvent(messageId, true, "error", "storage failed");
    }
    outcomes.push(outcome);
  }

  // --- Aggregate -------------------------------------------------------------
  // At least one stored -> 200 (a retry would only re-create duplicates).
  // Otherwise the most actionable failure wins: duplicate, unknown
  // recipient, validation, size, maintenance, storage error.
  if (outcomes.some((o) => o.status === "stored")) {
    return json({ ok: true, results: outcomes }, 200);
  }
  const statuses = new Set(outcomes.map((o) => o.status));
  if (statuses.has("duplicate")) {
    return json(
      { ok: false, error: "Duplicate messageId — already stored.", results: outcomes },
      409
    );
  }
  if (statuses.has("unknown_recipient") || statuses.has("address_inactive")) {
    return json(
      { ok: false, error: "Unknown recipient address.", results: outcomes },
      404
    );
  }
  if (statuses.has("validation_error") || statuses.has("stale")) {
    return json(
      { ok: false, error: "Invalid ForwardEmail payload.", results: outcomes },
      400
    );
  }
  if (statuses.has("too_large")) {
    return json(
      { ok: false, error: "Message exceeds the size limit.", results: outcomes },
      413
    );
  }
  if (statuses.has("maintenance")) {
    return json(
      { ok: false, error: "Platform is in maintenance mode.", results: outcomes },
      503
    );
  }
  return json(
    { ok: false, error: "Failed to store the message.", results: outcomes },
    500
  );
}
