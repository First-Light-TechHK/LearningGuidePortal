import { NextResponse } from "next/server";
import { currentProductUser } from "@/services/productAuth";
import { recordStudyEvent } from "@/services/productStore";

export async function POST(request: Request) {
  const user = await currentProductUser();
  if (!user) return NextResponse.json({ ok: false, error: "Sign in is required." }, { status: 401 });
  try {
    const body = await request.json() as { courseId?: string; lessonId?: string; event?: string; seconds?: number };
    if (typeof body.courseId !== "string" || typeof body.lessonId !== "string" || !["open", "complete"].includes(body.event || "")) {
      return NextResponse.json({ error: "A course, lesson and preview event are required." }, { status: 400 });
    }
    const event = body.event as "open" | "complete";
    const record = await recordStudyEvent({ userId: user.id, courseId: body.courseId, lessonId: body.lessonId, event,
      seconds: event === "complete" && Number.isFinite(body.seconds) ? Math.max(0, body.seconds!) : 0,
      clientEventId: `${event}_${body.courseId}_${body.lessonId}`,
    }, "preview");
    return NextResponse.json({ record });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Preview progress could not be saved." }, { status: 400 });
  }
}
