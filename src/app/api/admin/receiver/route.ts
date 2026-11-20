// GET /api/admin/receiver — receiver health, reported honestly.
// Status comes from RECEIVER_MODE env + platform_settings.receiver_status.
// It is NEVER claimed CONNECTED unless a receiver is actually configured.
import { getSetting, query, receiverStatusLabel } from "@/lib/db";
import { error, json, requireAdmin } from "@/lib/api";

export async function GET() {
  const auth = await requireAdmin();
  if (!auth) return error("Admin sign-in required.", 401);
  const status = await receiverStatusLabel();
  const mode = (process.env.RECEIVER_MODE ?? "none").toLowerCase();
  const domain = await getSetting("domain");
  const { rows } = await query<{
    id: number;
    provider_event_id: string | null;
    signature_valid: boolean;
    processing_status: string;
    received_at: string;
    detail: string | null;
  }>(
    `SELECT id, provider_event_id, signature_valid, processing_status,
            received_at, detail
     FROM receiver_events ORDER BY received_at DESC LIMIT 20`
  );
  return json({
    status,
    mode,
    domain,
    inboundEndpoint: "/api/inbound-email",
    recentEvents: rows,
    note:
      status === "NOT_CONFIGURED"
        ? "No mail receiver is connected. Generated addresses cannot receive mail until Route A (self-hosted mail server) or Route B (inbound email provider) is connected and posts signed events to /api/inbound-email."
        : "Receiver mode is configured. Verify with a real test email before claiming delivery works.",
  });
}
