import { currentOperatorRequest } from "@/services/productAuth";
import { studyGroupService } from "@/modules/group-study/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// The AI Tutor's health on this instance (tutor infra 2026-10-20): whether
// rooms are offered the Tutor and why not, the last hour's answers and
// failure classes, latency, today's spend, and models marked gone or
// tool-less. Counts, classes and model names only.
export async function GET(request: Request) {
  const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
  if (!await currentOperatorRequest(request)) {
    return Response.json({ ok: false, error: "Operator access is required." }, { status: 403, headers });
  }
  try {
    const health = await studyGroupService().tutorHealthSnapshot();
    return Response.json({ ok: health.availability.available, data: health }, { status: 200, headers });
  } catch {
    return Response.json({ ok: false, error: "AI Tutor health check failed." }, { status: 503, headers });
  }
}
