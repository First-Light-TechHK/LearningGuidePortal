import { currentOperatorRequest } from "@/services/productAuth";
import { studyGroupLiveKitHealth } from "@/modules/group-study/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!await currentOperatorRequest(request)) {
    return Response.json({ ok: false, error: "Operator access is required." }, { status: 403, headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } });
  }
  try {
    const health = await studyGroupLiveKitHealth();
    return Response.json({ ok: health.ready, data: health }, { status: health.ready ? 200 : 503, headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } });
  } catch {
    return Response.json({ ok: false, error: "LiveKit configuration health check failed." }, { status: 503, headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } });
  }
}
