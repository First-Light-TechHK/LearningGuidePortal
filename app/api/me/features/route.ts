import { NextResponse } from "next/server";
import { myFeatures } from "@/modules/student-management/service";
import { currentProductUserFromRequest } from "@/services/productAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/me/features → MyFeaturesResponse for the signed-in learner: whether improve_tutor and
 * ai_support_assistant are available to them now, and why. The AI Tutor reads this for Improve Tutor.
 */
export async function GET(request: Request) {
  const user = await currentProductUserFromRequest(request);
  if (!user) return NextResponse.json({ ok: false, error: "Sign in is required." }, { status: 401, headers: { "Cache-Control": "private, no-store" } });
  return NextResponse.json(await myFeatures(user.id), { headers: { "Cache-Control": "private, no-store" } });
}
