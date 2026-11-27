import { requireNotificationsService } from "@/services/notifications/token";
import { sendLogDetail } from "@/services/notifications/service";
import { notificationJson } from "../../http";

export const dynamic = "force-dynamic";

/** GET /api/integration/notifications/send-log/:id → View detail (NTF-LOG-005), 180-day window. */
export async function GET(request: Request, context: { params: Promise<Record<string, string>> }) {
  const denied = requireNotificationsService(request);
  if (denied) return denied;
  const id = (await context.params).id || "";
  const detail = await sendLogDetail(id);
  if (!detail) return notificationJson({ ok: false, code: "not_found", error: "Send-log record not found." }, 404);
  return notificationJson({ ok: true, ...detail });
}
