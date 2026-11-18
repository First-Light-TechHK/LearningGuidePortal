import { NextResponse } from "next/server";
import { currentProductUser } from "@/services/productAuth";
import { getLessonBookmarks, saveLessonBookmark } from "@/services/productStore";
import { LessonBookmarkError } from "@/contracts/lesson-bookmark";
import { checkoutRequestOrigin } from "@/services/paymentService";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
function failure(error: unknown) {
  return NextResponse.json({ ok: false, error: error instanceof LessonBookmarkError ? error.code : "bookmark_unavailable" },
    { status: error instanceof LessonBookmarkError ? error.status : 503, headers });
}
export async function GET(request: Request) {
  try {
    const user = await currentProductUser();
    if (!user) throw new LessonBookmarkError("unauthenticated", 401);
    const courseId = new URL(request.url).searchParams.get("courseId");
    if (!courseId || courseId.length > 255) throw new LessonBookmarkError("invalid_request", 400);
    return NextResponse.json({ ok: true, data: await getLessonBookmarks(user.id, courseId) }, { headers });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    const user = await currentProductUser();
    if (!user) throw new LessonBookmarkError("unauthenticated", 401);
    try { checkoutRequestOrigin(request); } catch { throw new LessonBookmarkError("forbidden_origin", 403); }
    let input: unknown;
    try { input = await request.json(); } catch { throw new LessonBookmarkError("invalid_request", 400); }
    return NextResponse.json({ ok: true, data: await saveLessonBookmark(user.id, input) }, { headers });
  } catch (error) { return failure(error); }
}
