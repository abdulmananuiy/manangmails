// GET /api/health — public health + honest receiver status.
import { getAllSettings, receiverStatusLabel } from "@/lib/db";
import { json } from "@/lib/api";

export async function GET() {
  try {
    const settings = await getAllSettings();
    const status = await receiverStatusLabel();
    return json({
      ok: true,
      receiverStatus: status,
      domain: settings.domain ?? "yourdomain.com",
      maintenanceMode: settings.maintenance_mode ?? "off",
    });
  } catch (err) {
    return json({ ok: false, error: "Database unavailable." }, 503);
  }
}
