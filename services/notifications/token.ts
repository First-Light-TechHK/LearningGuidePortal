import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

/**
 * Admin → Portal service authentication (design §1).
 * Header X-Notifications-Token, expected value NOTIFICATIONS_SERVICE_TOKEN.
 * Read per request so a rotated environment value takes effect immediately.
 */
export function notificationsServiceTokenValid(request: Request): boolean {
  const expected = process.env.NOTIFICATIONS_SERVICE_TOKEN?.trim();
  if (!expected) return false;
  const provided = request.headers.get("x-notifications-token")?.trim() || "";
  if (!provided) return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(provided), digest(expected));
}

export function requireNotificationsService(request: Request): NextResponse | null {
  if (notificationsServiceTokenValid(request)) return null;
  const configured = Boolean(process.env.NOTIFICATIONS_SERVICE_TOKEN?.trim());
  return NextResponse.json(
    { ok: false, error: configured ? "The service token is missing or invalid." : "Notification integration is not configured on Portal." },
    { status: 401, headers: { "Cache-Control": "private, no-store" } },
  );
}
