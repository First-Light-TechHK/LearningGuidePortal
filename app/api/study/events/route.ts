import { NextResponse } from "next/server";
import { currentProductUser } from "@/services/productAuth";
import { recordStudyEvent } from "@/services/productStore";

export async function POST(request: Request) {
  const user = await currentProductUser();
  if (!user) return NextResponse.json({ ok: false, error: "Sign in is required." }, { status: 401 });
  try {
    const body = await request.json() as { courseId?: string; lessonId?: string; event?: "open" | "video_progress" | "text_progress" | "complete"; seconds?: number; clientEventId?: string };
    const record = await recordStudyEvent({ userId: user.id, courseId: body.courseId || "", lessonId: body.lessonId || "", event: body.event || "open", seconds: body.seconds || 0, clientEventId: body.clientEventId || "" });
    return NextResponse.json({ ok: true, record });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Study event failed." }, { status: 400 });
  }
}
