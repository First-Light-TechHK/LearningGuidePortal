import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { AssessmentError } from "@/contracts/lesson-assessment";
import { currentProductUserFromRequest } from "@/services/productAuth";
import { getUnderstandingOverview } from "@/services/understandingOverview";
export async function GET(request: Request, { params }: { params: Promise<{ courseId: string }> }) {
  const requestId = randomUUID(), headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
  try {
    const user = await currentProductUserFromRequest(request);
    if (!user) throw new AssessmentError("ASSESSMENT_UNAUTHORISED", 401);
    return NextResponse.json({ ok: true, data: await getUnderstandingOverview(user.id, (await params).courseId), requestId }, { headers });
  } catch (error) {
    const failure = error instanceof AssessmentError ? error : new AssessmentError("ASSESSMENT_UNAVAILABLE", 503);
    return NextResponse.json({ ok: false, code: failure.code, message: failure.code, requestId }, { status: failure.status, headers });
  }
}
