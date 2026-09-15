import { NextResponse } from "next/server";
import { currentProductUserFromRequest } from "@/services/productAuth";
import { isOperator, saveCourseDraftForOperator } from "@/services/productStore";
import { AuthoringError } from "@/services/courseAuthoring";
import type { CourseDraftInput } from "@/contracts/course-authoring";

export async function PUT(request: Request, { params }: { params: Promise<{ courseId: string }> }) {
  const requestId = crypto.randomUUID();
  const fail = (code: string, status: number) => NextResponse.json({ ok: false, code, requestId }, { status });
  const user = await currentProductUserFromRequest(request);
  if (!user || !isOperator(user)) return fail("restricted", 403);
  // Next.js can reconstruct request.url with the internal listener hostname.
  // Compare with the HTTP Host seen by the browser, not that internal URL.
  const origin = request.headers.get("origin");
  try {
    const parsed = new URL(origin || "");
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.origin !== origin || parsed.host !== (request.headers.get("host") || new URL(request.url).host)) return fail("restricted", 403);
  } catch { return fail("restricted", 403); }
  try {
    const raw = await request.text();
    if (raw.length > 2000000) return fail("invalid", 413);
    const input = JSON.parse(raw) as CourseDraftInput;
    if (!input || typeof input !== "object") return fail("invalid", 400);
    const course = await saveCourseDraftForOperator(user.id, (await params).courseId, input);
    return NextResponse.json({ ok: true, data: course, requestId });
  } catch (error) {
    if (error instanceof AuthoringError) return fail(error.code, error.code === "conflict" ? 409 : error.code === "restricted" ? 403 : error.code === "notFound" ? 404 : 400);
    if (error instanceof SyntaxError) return fail("invalid", 400);
    return fail("failed", 500);
  }
}
