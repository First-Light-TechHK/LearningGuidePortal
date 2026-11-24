import { NextResponse } from "next/server";
import { requireNotificationsService } from "@/services/notifications/token";
import { listTemplates } from "@/services/notifications/service";
import { templateVariables } from "@/services/notifications/templates";
import { notificationJson, readNotificationJson } from "../http";
import { putTemplateResponse } from "./update";

export const dynamic = "force-dynamic";

/**
 * GET /api/integration/notifications/templates → the fixed 13-template
 * catalogue (service token). `variables` is the per-template allowlist the
 * Backoffice offers as insert tags (NTF-BO-016).
 */
export async function GET(request: Request) {
  const denied = requireNotificationsService(request);
  if (denied) return denied;
  const templates = (await listTemplates()).map((template) => ({ ...template, variables: templateVariables(template.id) }));
  return NextResponse.json({ ok: true, templates }, { headers: { "Cache-Control": "private, no-store" } });
}

/**
 * PUT /api/integration/notifications/templates
 * { id, operator, expectedUpdatedAt?, enabled?, en?, zh? }
 * Convenience form of PUT /templates/:id.
 */
export async function PUT(request: Request) {
  const denied = requireNotificationsService(request);
  if (denied) return denied;
  const parsed = await readNotificationJson(request);
  if (!parsed.ok) return parsed.response;
  const id = typeof parsed.body.id === "string" ? parsed.body.id.trim() : "";
  if (!id) return notificationJson({ ok: false, code: "invalid_request", error: "id is required." }, 400);
  return putTemplateResponse(request, id, parsed.body);
}
