import { NextResponse } from "next/server";
import { currentProductUser } from "@/services/productAuth";
import {
  checkEntitlement,
  deleteConversation,
  getConversation,
  getProductCourse,
  saveConversation,
  type ProductConversation,
} from "@/services/productStore";
import { getTutorAvailability, getTutorWelcome, KsTutorError, streamTutorText } from "@/services/ksTutorClient";
import type { Locale } from "@/lib/i18n/config";

export const dynamic = "force-dynamic";

function jsonError(message: string, status: number, code?: string) {
  return NextResponse.json({ ok: false, code, error: message }, { status });
}

export async function GET(request: Request) {
  const user = await currentProductUser();
  if (!user) return jsonError("Sign in is required.", 401);
  const url = new URL(request.url);
  const courseId = url.searchParams.get("courseId") || "";
  const lessonId = url.searchParams.get("lessonId") || undefined;
  const mode = url.searchParams.get("mode") === "socratic" ? "socratic" : "lecture";
  const course = await getProductCourse(courseId);
  if (!course || course.status !== "published") return jsonError("Course not found.", 404);
  const access = await checkEntitlement(user.id, course.id);
  if (!access.allowed) return jsonError("Course access is required.", 403);

  const availability = await getTutorAvailability(course.slug, request.signal);
  if (!availability.reachable) {
    return jsonError("AI Tutor is currently unavailable.", 503, "AI_TUTOR_UNAVAILABLE");
  }
  if (!availability.online) {
    return jsonError("AI Tutor is not available for this course.", 403, "AI_TUTOR_OFFLINE");
  }

  const locale: Locale = url.searchParams.get("locale") === "zh-CN" ? "zh-CN" : "en-GB";
  const [conversation, welcome] = await Promise.all([
    getConversation(user.id, undefined, course.id, lessonId, mode),
    getTutorWelcome(course.slug, locale, request.signal),
  ]);
  return NextResponse.json({
    ok: true,
    conversation: { id: conversation.id, mode: conversation.mode, messages: conversation.messages },
    welcome: mode === "socratic" ? welcome.socratic : welcome.lecture,
  });
}

/** New chat：删除当前用户在该课程/课时/模式下的对话记录（幂等）。 */
export async function DELETE(request: Request) {
  const user = await currentProductUser();
  if (!user) return jsonError("Sign in is required.", 401);
  const url = new URL(request.url);
  const courseId = url.searchParams.get("courseId") || "";
  const lessonId = url.searchParams.get("lessonId") || undefined;
  const mode = url.searchParams.get("mode") === "socratic" ? "socratic" : "lecture";
  const course = await getProductCourse(courseId);
  if (!course || course.status !== "published") return jsonError("Course not found.", 404);
  const access = await checkEntitlement(user.id, course.id);
  if (!access.allowed) return jsonError("Course access is required.", 403);
  await deleteConversation(user.id, course.id, lessonId, mode);
  return NextResponse.json({ ok: true });
}

export async function POST(request: Request) {
  const user = await currentProductUser();
  if (!user) return jsonError("Sign in is required.", 401);
  try {
    const body = await request.json() as {
      courseId?: string;
      lessonId?: string;
      mode?: "lecture" | "socratic";
      message?: string;
      conversationId?: string;
      locale?: "en-GB" | "zh-CN";
    };
    const course = await getProductCourse(body.courseId || "");
    if (!course || course.status !== "published") return jsonError("Course not found.", 404);
    const access = await checkEntitlement(user.id, course.id);
    if (!access.allowed) return jsonError("Course access is required.", 403);

    const lesson = course.sections.flatMap((section) => section.lessons).find((item) => item.id === body.lessonId) || course.sections[0]?.lessons[0];
    if (!lesson) return jsonError("Lesson not found.", 404);
    const message = body.message?.trim();
    if (!message || message.length > 4000) {
      return jsonError("Enter a message of up to 4,000 characters.", 400);
    }

    // Online 状态实时读取：KS 关闭开关后，即使页面未刷新也会阻止新消息。
    const availability = await getTutorAvailability(course.slug, request.signal);
    if (!availability.reachable) {
      return jsonError("AI Tutor is currently unavailable.", 503, "AI_TUTOR_UNAVAILABLE");
    }
    if (!availability.online) {
      return jsonError("AI Tutor is not available for this course.", 403, "AI_TUTOR_OFFLINE");
    }

    const mode = body.mode === "socratic" ? "socratic" : "lecture";
    const locale: Locale = body.locale === "zh-CN" ? "zh-CN" : "en-GB";
    const conversation = await getConversation(user.id, body.conversationId, course.id, lesson.id, mode);
    const history = conversation.messages.slice(-10);

    const generator = streamTutorText({
      externalCourseId: course.slug,
      message,
      mode,
      locale,
      history: history.map((item) => ({ role: item.role, content: item.content })),
      signal: request.signal,
    });
    // 首字节前失败仍可返回标准错误状态；流开始后只能结束响应。
    const first = await generator.next();

    const encoder = new TextEncoder();
    let answer = "";
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          if (!first.done) {
            answer += first.value;
            controller.enqueue(encoder.encode(first.value));
          }
          for await (const delta of generator) {
            answer += delta;
            controller.enqueue(encoder.encode(delta));
          }
          if (answer.trim()) {
            const timestamp = new Date().toISOString();
            const messages: ProductConversation["messages"] = [
              ...history,
              { role: "user", content: message, createdAt: timestamp },
              { role: "assistant", content: answer, createdAt: new Date().toISOString() },
            ];
            await saveConversation({ ...conversation, mode, messages });
          }
          controller.close();
        } catch (error) {
          controller.error(error);
        }
      },
      cancel() {
        void generator.return(undefined);
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Conversation-Id": conversation.id,
        "X-Tutor-Provider": "ks",
      },
    });
  } catch (error) {
    if (error instanceof KsTutorError) {
      const status = error.status === 403 ? 403 : error.status === 404 ? 404 : error.status === 409 ? 409 : error.status === 429 ? 429 : 502;
      return jsonError(error.message, status, error.code);
    }
    return new Response(error instanceof Error ? error.message : "AI Tutor request failed.", {
      status: 502,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}
