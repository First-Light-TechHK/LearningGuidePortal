import { NextResponse } from "next/server";
import { BroadcastError } from "@/services/notifications/core";
import { requireNotificationsService } from "@/services/notifications/token";
import { createBroadcastDraft, listBroadcasts } from "@/services/notifications/service";
import { missingOperatorResponse, notificationJson, operatorFrom, readNotificationJson } from "../http";
import { patchBroadcastResponse } from "./patch";

export const dynamic = "force-dynamic";

/** GET /api/integration/notifications/broadcasts?page=1 → newest first, 20 per page. */
export async function GET(request: Request) {
  const denied = requireNotificationsService(request);
  if (denied) return denied;
  const rawPage = new URL(request.url).searchParams.get("page");
  const page = rawPage === null || rawPage === "" ? 1 : Number(rawPage);
  if (!Number.isInteger(page) || page < 1) return notificationJson({ ok: false, code: "invalid_request", error: "page must be a positive integer." }, 400);
  const result = await listBroadcasts(page);
  return NextResponse.json(
    { ok: true, broadcasts: result.items, total: result.total, page: result.page, pageSize: result.pageSize },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

/** POST /api/integration/notifications/broadcasts → save a draft (operator required). */
export async function POST(request: Request) {
  const denied = requireNotificationsService(request);
  if (denied) return denied;
  const parsed = await readNotificationJson(request);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;
  const operator = operatorFrom(request, body);
  if (!operator) return missingOperatorResponse();
  try {
    const broadcast = await createBroadcastDraft({
      titleEn: typeof body.titleEn === "string" ? body.titleEn : "",
      bodyEn: typeof body.bodyEn === "string" ? body.bodyEn : "",
      titleZh: typeof body.titleZh === "string" ? body.titleZh : null,
      bodyZh: typeof body.bodyZh === "string" ? body.bodyZh : null,
      buttonText: typeof body.buttonText === "string" ? body.buttonText : null,
      buttonLink: typeof body.buttonLink === "string" ? body.buttonLink : null,
      audience: (body.audience === "paid" ? "paid" : body.audience === "all" ? "all" : body.audience) as "all" | "paid",
      createdBy: operator,
    });
    return notificationJson({ ok: true, broadcast }, 200);
  } catch (error) {
    if (error instanceof BroadcastError) return notificationJson({ ok: false, code: error.code, error: error.message }, error.code === "invalid" ? 400 : 404);
    throw error;
  }
}

/** PATCH /api/integration/notifications/broadcasts { id, operator, action, ... } */
export async function PATCH(request: Request) {
  const denied = requireNotificationsService(request);
  if (denied) return denied;
  const parsed = await readNotificationJson(request);
  if (!parsed.ok) return parsed.response;
  const id = typeof parsed.body.id === "string" ? parsed.body.id.trim() : "";
  if (!id) return notificationJson({ ok: false, code: "invalid_request", error: "id is required." }, 400);
  return patchBroadcastResponse(request, id, parsed.body);
}
