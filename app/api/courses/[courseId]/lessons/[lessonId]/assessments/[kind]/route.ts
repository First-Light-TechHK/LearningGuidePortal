import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { AssessmentError } from "@/contracts/lesson-assessment";
import { currentProductUserFromRequest } from "@/services/productAuth";
import { readAssessmentBundle, writeAssessment } from "@/services/lessonAssessmentService";
type Context = { params: Promise<{ courseId: string; lessonId: string; kind: string }> };
async function respond(request: Request, context: Context, write: boolean) {
  const requestId = randomUUID(), headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
  try {
    const user = await currentProductUserFromRequest(request);
    if (!user) throw new AssessmentError("ASSESSMENT_UNAUTHORISED", 401);
    const { courseId, lessonId, kind } = await context.params;
    if (kind !== "knowledge" && kind !== "application") throw new AssessmentError("ASSESSMENT_NOT_FOUND", 404);
    let input: unknown;
    if (write) { try { input = await request.json(); } catch { throw new AssessmentError("ASSESSMENT_INVALID"); } }
    const result = write ? { data: await writeAssessment(user.id, courseId, lessonId, kind, input) } : await readAssessmentBundle(user.id, courseId, lessonId, kind);
    return NextResponse.json({ ok: true, ...result, requestId }, { headers });
  } catch (error) {
    const failure = error instanceof AssessmentError ? error : new AssessmentError("ASSESSMENT_UNAVAILABLE", 503);
    return NextResponse.json({ ok: false, code: failure.code, message: failure.code, requestId }, { status: failure.status, headers });
  }
}
export const GET = (request: Request, context: Context) => respond(request, context, false);
export const PUT = (request: Request, context: Context) => respond(request, context, true);
