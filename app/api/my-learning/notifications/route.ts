import { NextResponse } from "next/server";
import { currentProductUserFromRequest } from "@/services/productAuth";
import { listLearnerNotifications } from "@/services/notifications/service";

export const dynamic = "force-dynamic";

/**
 * GET /api/my-learning/notifications?filter=all|unread&limit=20&cursor=
 * &locale=en-GB|zh-CN (optional) → { ok, items, unreadCount, total, nextCursor } (PRD §9; design §3).
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
  // Only the category label and the relative time follow the page language; title and body stay as stored.
  const locale = url.searchParams.get("locale");
  const language = locale === "zh-CN" ? "zh" : locale === "en-GB" ? "en" : undefined;

  try {
    const result = await listLearnerNotifications(user.id, { filter, limit, cursor, language });
    return NextResponse.json({ ok: true, ...result }, { headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } });
  } catch {
    return NextResponse.json({ ok: false, error: "Notifications could not be loaded." }, { status: 500 });
  }
}
