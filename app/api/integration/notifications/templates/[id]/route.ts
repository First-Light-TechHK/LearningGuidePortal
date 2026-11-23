import { requireNotificationsService } from "@/services/notifications/token";
import { readNotificationJson } from "../../http";
import { putTemplateResponse } from "../update";

export const dynamic = "force-dynamic";

/** PUT /api/integration/notifications/templates/:id (design §3, NTF-BO-020/021). */
export async function PUT(request: Request, context: { params: Promise<Record<string, string>> }) {
  const denied = requireNotificationsService(request);
  if (denied) return denied;
  const parsed = await readNotificationJson(request);
  if (!parsed.ok) return parsed.response;
  const id = (await context.params).id || "";
  return putTemplateResponse(request, id, parsed.body);
}
