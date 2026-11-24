import { NextResponse } from "next/server";
import { currentProductUserFromRequest } from "@/services/productAuth";
import { requestOriginMatches } from "@/services/adminHost";
import { setNotificationRead } from "@/services/notifications/service";

export const dynamic = "force-dynamic";

/**
 * POST /api/my-learning/notifications/read { notificationId, read }
 * → { ok, notification, unreadCount } (PRD §9.2 NTF-FE-013).
 */
export async function POST(request: Request) {
  if (!requestOriginMatches(request)) {
    return NextResponse.json({ ok: false, error: "Request origin is not allowed." }, { status: 403 });
  }
  const user = await currentProductUserFromRequest(request);
  if (!user) return NextResponse.json({ ok: false, error: "Sign in is required." }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Send a JSON body." }, { status: 400 });
  }
  if (!body || typeof body !== "object") return NextResponse.json({ ok: false, error: "Send a JSON body." }, { status: 400 });
  const notificationId = (body as { notificationId?: unknown }).notificationId;
  const read = (body as { read?: unknown }).read;
  if (typeof notificationId !== "string" || !notificationId.trim() || typeof read !== "boolean") {
    return NextResponse.json({ ok: false, error: "notificationId and read are required." }, { status: 400 });
  }

  try {
    const result = await setNotificationRead(user.id, notificationId, read);
    return NextResponse.json({
      ok: true,
      notification: { id: result.notification.id, read: Boolean(result.notification.readAt), readAt: result.notification.readAt },
      unreadCount: result.unreadCount,
    }, { headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } });
  } catch (error) {
    if (error instanceof Error && /not found/i.test(error.message)) {
      return NextResponse.json({ ok: false, error: "Notification not found." }, { status: 404 });
    }
    return NextResponse.json({ ok: false, error: "Notification could not be updated." }, { status: 500 });
  }
}
