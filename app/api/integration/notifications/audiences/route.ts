import { NextResponse } from "next/server";
import { requireNotificationsService } from "@/services/notifications/token";
import { audienceCounts } from "@/services/notifications/service";

export const dynamic = "force-dynamic";

/** GET /api/integration/notifications/audiences → { all, paid } counts (service token). */
export async function GET(request: Request) {
  const denied = requireNotificationsService(request);
  if (denied) return denied;
  const counts = await audienceCounts();
  return NextResponse.json({ ok: true, ...counts }, { headers: { "Cache-Control": "private, no-store" } });
}
