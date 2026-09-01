import { NextResponse } from "next/server";
import { currentProductUser } from "@/services/productAuth";
import { checkEntitlement, getConversation, getProductCourse } from "@/services/productStore";
import { createTutorResponse } from "@/services/productTutor";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await currentProductUser();
  if (!user) return NextResponse.json({ ok: false, error: "Sign in is required." }, { status: 401 });
  const url = new URL(request.url);
  const courseId = url.searchParams.get("courseId") || "";
  const lessonId = url.searchParams.get("lessonId") || undefined;
  const mode = url.searchParams.get("mode") === "socratic" ? "socratic" : "lecture";
  const course = await getProductCourse(courseId);
  if (!course || course.status !== "published") return NextResponse.json({ ok: false, error: "Course not found." }, { status: 404 });
  const access = await checkEntitlement(user.id, course.id);
  if (!access.allowed) return NextResponse.json({ ok: false, error: "Course access is required." }, { status: 403 });
  const conversation = await getConversation(user.id, undefined, course.id, lessonId, mode);
  return NextResponse.json({ ok: true, conversation: { id: conversation.id, mode: conversation.mode, messages: conversation.messages } });
}

export async function POST(request: Request) {
  const user = await currentProductUser();
  if (!user) return NextResponse.json({ ok: false, error: "Sign in is required." }, { status: 401 });
  try {
    const body = await request.json() as { courseId?: string; lessonId?: string; mode?: "lecture" | "socratic"; message?: string; conversationId?: string; locale?: "en-GB" | "zh-CN" };
    const course = await getProductCourse(body.courseId || "");
    if (!course || course.status !== "published") return NextResponse.json({ ok: false, error: "Course not found." }, { status: 404 });
    const access = await checkEntitlement(user.id, course.id);
    if (!access.allowed) return NextResponse.json({ ok: false, error: "Course access is required." }, { status: 403 });
    const lesson = course.sections.flatMap((section) => section.lessons).find((item) => item.id === body.lessonId) || course.sections[0]?.lessons[0];
    if (!lesson) return NextResponse.json({ ok: false, error: "Lesson not found." }, { status: 404 });
    const message = body.message?.trim();
    if (!message || message.length > 4000) return NextResponse.json({ ok: false, error: "Enter a message of up to 4,000 characters." }, { status: 400 });
    const result = await createTutorResponse({ userId: user.id, course, lesson, mode: body.mode === "socratic" ? "socratic" : "lecture", message, conversationId: body.conversationId, locale: body.locale === "zh-CN" ? "zh-CN" : "en-GB" });
    return new Response(result.stream, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Conversation-Id": result.conversationId, "X-Tutor-Provider": result.provider } });
  } catch (error) {
    return new Response(error instanceof Error ? error.message : "AI Tutor request failed.", { status: 502, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
}
