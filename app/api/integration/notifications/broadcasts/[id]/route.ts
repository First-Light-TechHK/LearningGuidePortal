import { requireNotificationsService } from "@/services/notifications/token";
import { broadcastDetail } from "@/services/notifications/service";
import { notificationJson, readNotificationJson } from "../../http";
import { patchBroadcastResponse } from "../patch";

export const dynamic = "force-dynamic";

/** GET /api/integration/notifications/broadcasts/:id → View detail with read rate and status times. */
export async function GET(request: Request, context: { params: Promise<Record<string, string>> }) {
  const denied = requireNotificationsService(request);
  if (denied) return denied;
  const id = (await context.params).id || "";
  const detail = await broadcastDetail(id);
  if (!detail) return notificationJson({ ok: false, code: "not_found", error: "Broadcast not found." }, 404);
  return notificationJson({ ok: true, ...detail });
}

/** PATCH /api/integration/notifications/broadcasts/:id { operator, action, ... } */
export async function PATCH(request: Request, context: { params: Promise<Record<string, string>> }) {
  const denied = requireNotificationsService(request);
  if (denied) return denied;
  const parsed = await readNotificationJson(request);
  if (!parsed.ok) return parsed.response;
  const id = (await context.params).id || "";
  return patchBroadcastResponse(request, id, parsed.body);
}
