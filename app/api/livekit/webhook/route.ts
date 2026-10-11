import { NextResponse } from "next/server";
import { studyGroupService } from "@/modules/group-study/runtime";
import { StudyGroupWebhookError } from "@/modules/group-study/service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const rawBody = await request.text();
  const authHeader = request.headers.get("authorization");
  try {
    // No session: the provider signature is the authentication (design §2).
    const outcome = await studyGroupService().handleLiveKitWebhook({ rawBody, authHeader });
    return NextResponse.json({ ok: true, status: outcome.status });
  } catch (error) {
    if (error instanceof StudyGroupWebhookError) {
      return NextResponse.json({ ok: false, code: error.code }, { status: error.code === "invalid_signature" ? 400 : 503 });
    }
    return NextResponse.json({ ok: false, code: "webhook_failed" }, { status: 500 });
  }
}
