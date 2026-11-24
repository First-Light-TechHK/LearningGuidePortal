import { NextResponse } from "next/server";
import { requireNotificationsService } from "@/services/notifications/token";
import { querySendLog, sendLogDetail } from "@/services/notifications/service";
import type { SendLogFilters } from "@/services/notifications/core";
import type { NotificationChannel, NotificationLogStatus } from "@/services/notifications/types";
import { notificationJson } from "../http";

export const dynamic = "force-dynamic";

const CHANNELS = new Set(["in_app", "email"]);
const STATUSES = new Set(["delivered", "read", "withdrawn", "sent", "failed"]);

/**
 * GET /api/integration/notifications/send-log?recipient=&template=&broadcast=&channel=&status=&from=&to=&page=
 * Defaults to the last 7 days, 20 per page; records older than 180 days are
 * never returned (design §2/§7).
 * Also serves ?id=<logId> as a detail shortcut.
 */
export async function GET(request: Request) {
  const denied = requireNotificationsService(request);
  if (denied) return denied;
  const params = new URL(request.url).searchParams;
  const id = params.get("id");
  if (id) {
    const detail = await sendLogDetail(id);
    if (!detail) return notificationJson({ ok: false, code: "not_found", error: "Send-log record not found." }, 404);
    return notificationJson({ ok: true, ...detail });
  }
  const channel = params.get("channel") || "";
  const status = params.get("status") || "";
  if (channel && !CHANNELS.has(channel)) return notificationJson({ ok: false, code: "invalid_request", error: "Unknown channel." }, 400);
  if (status && !STATUSES.has(status)) return notificationJson({ ok: false, code: "invalid_request", error: "Unknown status." }, 400);
  const page = params.get("page") ? Number(params.get("page")) : 1;
  if (!Number.isInteger(page) || page < 1) return notificationJson({ ok: false, code: "invalid_request", error: "page must be a positive integer." }, 400);
  const from = params.get("from") || undefined;
  const to = params.get("to") || undefined;
  for (const [name, value] of [["from", from], ["to", to]] as const) {
    if (value && Number.isNaN(Date.parse(value))) {
      return notificationJson({ ok: false, code: "invalid_request", error: `${name} must be a date.` }, 400);
    }
  }
  const filters: SendLogFilters = {
    recipient: params.get("recipient") || undefined,
    template: params.get("template") || undefined,
    broadcast: params.get("broadcast") || undefined,
    channel: (channel || undefined) as NotificationChannel | undefined,
    status: (status || undefined) as NotificationLogStatus | undefined,
    from,
    to,
    page,
  };
  const result = await querySendLog(filters);
  return NextResponse.json({ ok: true, ...result }, { headers: { "Cache-Control": "private, no-store" } });
}
