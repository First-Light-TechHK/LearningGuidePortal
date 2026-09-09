import { NextResponse } from "next/server";
import { currentProductUser } from "@/services/productAuth";
import { addLessonToCourse, isOperator, setCourseStatus } from "@/services/productStore";

export async function PATCH(request: Request, { params }: { params: Promise<{ courseId: string }> }) {
  const user = await currentProductUser();
  if (!user || !isOperator(user)) return NextResponse.json({ ok: false, error: "Course Manager/Operator access is required." }, { status: 403 });
  try {
    const { courseId } = await params;
    const body = await request.json() as { status?: "draft" | "published" };
    if (body.status !== "draft" && body.status !== "published") return NextResponse.json({ ok: false, error: "Invalid course status." }, { status: 400 });
    return NextResponse.json({ ok: true, course: await setCourseStatus(courseId, body.status) });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Course update failed." }, { status: 400 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ courseId: string }> }) {
  const user = await currentProductUser();
  if (!user || !isOperator(user)) return NextResponse.json({ ok: false, error: "Course Manager/Operator access is required." }, { status: 403 });
  try {
    const { courseId } = await params;
    const body = await request.json() as { title?: string; body?: string; durationMinutes?: number; videoDurationSeconds?: number | null; isPublic?: boolean };
    return NextResponse.json({ ok: true, lesson: await addLessonToCourse({ courseId, title: body.title || "", body: body.body || "", durationMinutes: body.durationMinutes || 0, videoDurationSeconds: body.videoDurationSeconds, isPublic: body.isPublic }) });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Lesson creation failed." }, { status: 400 });
  }
}
