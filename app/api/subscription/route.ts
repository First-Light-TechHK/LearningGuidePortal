import { NextResponse } from "next/server";
import { currentProductUser } from "@/services/productAuth";
import { getLearningOverview } from "@/services/productStore";
import { changeLearnerSubscription } from "@/services/subscriptionPaymentService";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await currentProductUser(request);
  if (!user) return NextResponse.json({ ok: false, error: "Sign in is required." }, { status: 401 });
  return NextResponse.json({ ok: true, subscriptions: (await getLearningOverview(user.id)).subscriptions });
}

export async function POST(request: Request) {
  const user = await currentProductUser(request);
  if (!user) return NextResponse.json({ ok: false, error: "Sign in is required." }, { status: 401 });
  try {
    const body = await request.json() as { subscriptionId?: string; action?: "cancel" | "resume"; reasonCode?: "low_usage" | "too_expensive" | "content" | "website" | "other"; reasonText?: string };
    if (!body.subscriptionId || !["cancel", "resume"].includes(body.action || "")) return NextResponse.json({ ok: false, error: "Subscription and a valid action are required." }, { status: 400 });
    const subscription = await changeLearnerSubscription(user.id, { subscriptionId: body.subscriptionId, action: body.action as "cancel" | "resume", reasonCode: body.reasonCode, reasonText: body.reasonText });
    return NextResponse.json({ ok: true, subscription });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Subscription update failed." }, { status: 400 });
  }
}
