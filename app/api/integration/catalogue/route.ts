import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { listPublishedCourses } from "@/services/productStore";

export const dynamic = "force-dynamic";

function authorised(request: Request) {
  const expected = process.env.PORTAL_INTEGRATION_TOKEN?.trim();
  if (!expected) return false;
  const provided = request.headers.get("x-api-key")?.trim() || "";
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  if (expectedBuffer.length !== providedBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, providedBuffer);
}

/**
 * Portal → KnowledgeSystem 课程目录（2026-10-22）。
 * 仅返回已发布课程与课时标题；不返回正文、媒体或会员数据。
 */
export async function GET(request: Request) {
  const expected = process.env.PORTAL_INTEGRATION_TOKEN?.trim();
  if (!expected) {
    return NextResponse.json(
      { ok: false, code: "INTEGRATION_DISABLED", error: "Portal integration token is not configured." },
      { status: 503 },
    );
  }
  if (!authorised(request)) {
    return NextResponse.json(
      { ok: false, code: "UNAUTHORIZED", error: "Invalid integration token." },
      { status: 401 },
    );
  }

  const courses = await listPublishedCourses();
  return NextResponse.json(
    {
      courses: courses
        .filter((course) => !course.archivedAt)
        .map((course) => ({
          externalId: course.slug,
          title: course.title,
          lessons: course.sections
            .filter((section) => !section.archivedAt)
            .flatMap((section) => section.lessons)
            .map((lesson) => ({ externalId: lesson.id, title: lesson.title })),
        })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
