import { NextResponse } from "next/server";
import { CourseLearningModeError, isCourseLearningMode } from "@/contracts/course-learning-mode";
import { currentProductUserFromRequest } from "@/services/productAuth";
import { requestOriginMatches } from "@/services/adminHost";
import { saveCourseLearningMode } from "@/services/productStore";

export async function PUT(request: Request, { params }: { params: Promise<{ courseId: string }> }) {
  if (!requestOriginMatches(request)) return NextResponse.json({ ok: false, code: "forbidden", message: "Request origin is not allowed." }, { status: 403 });
  const user = await currentProductUserFromRequest(request);
  if (!user) return NextResponse.json({ ok: false, code: "unauthorised", message: "Sign in is required." }, { status: 401 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ ok: false, code: "invalid", message: "Choose a learning mode." }, { status: 400 }); }
  if (!body || typeof body !== "object" || !("mode" in body) || !isCourseLearningMode(body.mode)) {
    return NextResponse.json({ ok: false, code: "invalid", message: "Choose a learning mode." }, { status: 400 });
  }
  try {
    const data = await saveCourseLearningMode(user.id, (await params).courseId, body.mode);
    return NextResponse.json({ ok: true, code: "saved", message: "Learning mode saved.", data });
  } catch (error) {
    if (error instanceof CourseLearningModeError) return NextResponse.json({ ok: false, code: error.code, message: error.message }, { status: { invalid: 400, notFound: 404, unauthorised: 401 }[error.code] });
    return NextResponse.json({ ok: false, code: "failed", message: "Learning mode could not be saved." }, { status: 500 });
  }
}
