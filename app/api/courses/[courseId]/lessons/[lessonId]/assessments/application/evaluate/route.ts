import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { currentProductUserFromRequest } from "@/services/productAuth";
import { requestOriginMatches } from "@/services/adminHost";
import { AssessmentError } from "@/contracts/lesson-assessment";
import { submitApplicationAssessment } from "@/services/applicationAssessmentService";

export async function POST(request: Request, context: { params: Promise<{ courseId: string; lessonId: string }> }) {
  const requestId = randomUUID(), headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
  try {
    if (!requestOriginMatches(request)) throw new AssessmentError("ASSESSMENT_FORBIDDEN", 403);
    const user = await currentProductUserFromRequest(request);
    if (!user) throw new AssessmentError("ASSESSMENT_UNAUTHORISED", 401);
    let value: unknown;
    try { value = await request.json(); } catch { throw new AssessmentError("ASSESSMENT_INVALID"); }
    const { courseId, lessonId } = await context.params;
    const data = await submitApplicationAssessment(user.id, courseId, lessonId, value);
    return NextResponse.json({ ok: true, data, requestId }, { headers });
  } catch (error) {
    const failure = error instanceof AssessmentError ? error : new AssessmentError("ASSESSMENT_UNAVAILABLE", 503);
    return NextResponse.json({ ok: false, code: failure.code, requestId }, { status: failure.status, headers });
  }
}
