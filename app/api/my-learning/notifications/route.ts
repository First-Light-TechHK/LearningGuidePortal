import { NextResponse } from "next/server";
import { currentProductUserFromRequest } from "@/services/productAuth";
import { listLearnerNotifications } from "@/services/notifications/service";

export const dynamic = "force-dynamic";

/**
 * GET /api/my-learning/notifications?filter=all|unread&limit=20&cursor=
 * → { ok, items, unreadCount, nextCursor } (PRD §9; design §3).
 */
export async function GET(request: Request) {
  const user = await currentProductUserFromRequest(request);
  if (!user) return NextResponse.json({ ok: false, error: "Sign in is required." }, { status: 401 });

  const url = new URL(request.url);
  const filter = url.searchParams.get("filter") || "all";
  if (filter !== "all" && filter !== "unread") {
    return NextResponse.json({ ok: false, error: "filter must be all or unread." }, { status: 400 });
  }
  const rawLimit = url.searchParams.get("limit");
  const limit = rawLimit === null ? 20 : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    return NextResponse.json({ ok: false, error: "limit must be between 1 and 50." }, { status: 400 });
  }
  const cursor = url.searchParams.get("cursor");

  try {
    const result = await listLearnerNotifications(user.id, { filter, limit, cursor });
    return NextResponse.json({ ok: true, ...result }, { headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } });
  } catch {
    return NextResponse.json({ ok: false, error: "Notifications could not be loaded." }, { status: 500 });
  }
}
