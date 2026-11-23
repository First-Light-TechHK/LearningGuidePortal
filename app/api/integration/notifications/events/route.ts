import { NextResponse } from "next/server";
import { requireNotificationsService } from "@/services/notifications/token";
import { emitNotificationEvent } from "@/services/notifications/service";

export const dynamic = "force-dynamic";

/**
 * POST /api/integration/notifications/events
 * { eventType, eventKey, userId?, email?, params?, isTest? }
 * Admin → Portal event entry (design §3/§4). The service token is required.
 */
export async function POST(request: Request) {
  const denied = requireNotificationsService(request);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Send a JSON body." }, { status: 400 });
  }
  if (!body || typeof body !== "object") return NextResponse.json({ ok: false, error: "Send a JSON body." }, { status: 400 });
  const input = body as Record<string, unknown>;
  if (typeof input.eventType !== "string" || !input.eventType.trim()) {
    return NextResponse.json({ ok: false, error: "eventType is required." }, { status: 400 });
  }
  if (typeof input.eventKey !== "string" || !input.eventKey.trim()) {
    return NextResponse.json({ ok: false, error: "eventKey is required." }, { status: 400 });
  }
  if (input.userId !== undefined && typeof input.userId !== "string") {
    return NextResponse.json({ ok: false, error: "userId must be a string." }, { status: 400 });
  }
  if (input.email !== undefined && (typeof input.email !== "string" || !input.email.includes("@"))) {
    return NextResponse.json({ ok: false, error: "email must be an email address." }, { status: 400 });
  }
  if (input.params !== undefined && (input.params === null || typeof input.params !== "object" || Array.isArray(input.params))) {
    return NextResponse.json({ ok: false, error: "params must be an object." }, { status: 400 });
  }
  if (input.isTest !== undefined && typeof input.isTest !== "boolean") {
    return NextResponse.json({ ok: false, error: "isTest must be a boolean." }, { status: 400 });
  }

  const result = await emitNotificationEvent({
    eventType: input.eventType.trim(),
    eventKey: input.eventKey.trim(),
    userId: typeof input.userId === "string" ? input.userId : null,
    email: typeof input.email === "string" ? input.email : null,
    params: (input.params as Record<string, unknown> | null | undefined) || null,
    isTest: input.isTest === true,
  });

  if (!result.created) {
    if (result.reason === "unknown_event" || result.reason === "unknown_template" || result.reason === "invalid_request") {
      return NextResponse.json({ ok: false, created: false, error: "Unknown event type." }, { status: 400 });
    }
    if (result.reason === "unknown_user") {
      return NextResponse.json({ ok: false, created: false, error: "Recipient not found or inactive." }, { status: 404 });
    }
  }
  return NextResponse.json({ ok: true, ...result }, { headers: { "Cache-Control": "private, no-store" } });
}
