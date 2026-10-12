import { NextResponse } from "next/server";
import { studyEventHttpStatus } from "@/lib/studyEventHttpStatus";
import { currentProductUser } from "@/services/productAuth";
import { checkEntitlement, recordStudyEvent } from "@/services/productStore";
import type { CourseLearningMode } from "@/contracts/course-learning-mode";

export async function POST(request: Request) {
  const user = await currentProductUser();
  if (!user) return NextResponse.json({ error: "Sign in is required." }, { status: 401 });
  try {
    const body = await request.json() as { courseId?: string; lessonId?: string; contentId?: string | null; learningMode?: CourseLearningMode; clientEventId?: string; event?: string; seconds?: number };
    if (typeof body.courseId !== "string" || typeof body.lessonId !== "string" || !["open", "complete"].includes(body.event || "")) {
      return NextResponse.json({ error: "A course, lesson and preview event are required." }, { status: 400 });
    }
    const event = body.event as "open" | "complete";
    if (body.learningMode !== undefined && (typeof body.clientEventId !== "string" || !body.clientEventId.trim())) return NextResponse.json({ error: "A client event id is required." }, { status: 400 });
    const access = await checkEntitlement(user.id, body.courseId);
    const record = await recordStudyEvent({ userId: user.id, courseId: body.courseId, lessonId: body.lessonId, event,
      contentId: body.contentId, learningMode: body.learningMode,
      seconds: event === "complete" && Number.isFinite(body.seconds) ? Math.max(0, body.seconds!) : 0,
      clientEventId: body.learningMode ? body.clientEventId! : `${event}_${body.courseId}_${body.lessonId}`,
    }, access.allowed ? "paid" : "preview");
    return NextResponse.json({ record });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Preview progress could not be saved." }, { status: studyEventHttpStatus(error) });
  }
}
