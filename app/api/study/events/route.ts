import { NextResponse } from "next/server";
import { studyEventHttpStatus } from "@/lib/studyEventHttpStatus";
import { currentProductUser } from "@/services/productAuth";
import { recordStudyEvent } from "@/services/productStore";
import type { CourseLearningMode } from "@/contracts/course-learning-mode";

export async function POST(request: Request) {
  const user = await currentProductUser();
  if (!user) return NextResponse.json({ ok: false, error: "Sign in is required." }, { status: 401 });
  try {
    const body = await request.json() as { courseId?: string; lessonId?: string; contentId?: string | null; learningMode?: CourseLearningMode; event?: "open" | "video_progress" | "text_progress" | "complete"; seconds?: number; clientEventId?: string; completeLesson?: boolean };
    if (!body.courseId || !body.lessonId || !body.event || !body.clientEventId) return NextResponse.json({ ok: false, error: "Course, lesson, event and client event id are required." }, { status: 400 });
    const record = await recordStudyEvent({ userId: user.id, courseId: body.courseId, lessonId: body.lessonId, contentId: body.contentId, learningMode: body.learningMode, event: body.event, seconds: body.seconds || 0, clientEventId: body.clientEventId, completeLesson: body.completeLesson });
    return NextResponse.json({ ok: true, record });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Study event failed." }, { status: studyEventHttpStatus(error) });
  }
}
