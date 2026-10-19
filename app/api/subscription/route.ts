import { NextResponse } from "next/server";
import { currentProductUser } from "@/services/productAuth";
import { cancelSubscription, getLearningOverview, resumeSubscription } from "@/services/productStore";
import { getStripe } from "@/services/stripeClient";
import { paymentMode } from "@/services/runtimeConfig";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await currentProductUser();
  if (!user) return NextResponse.json({ ok: false, error: "Sign in is required." }, { status: 401 });
  return NextResponse.json({ ok: true, subscriptions: (await getLearningOverview(user.id)).subscriptions });
}

export async function POST(request: Request) {
  const user = await currentProductUser();
  if (!user) return NextResponse.json({ ok: false, error: "Sign in is required." }, { status: 401 });
  try {
    const body = await request.json() as { subscriptionId?: string; action?: "cancel" | "resume"; reasonCode?: "low_usage" | "too_expensive" | "content" | "website" | "other"; reasonText?: string };
    if (!body.subscriptionId || !["cancel", "resume"].includes(body.action || "")) return NextResponse.json({ ok: false, error: "Subscription and a valid action are required." }, { status: 400 });
    const current = (await getLearningOverview(user.id)).subscriptions.find((subscription) => subscription.id === body.subscriptionId);
    if (!current) return NextResponse.json({ ok: false, error: "Subscription not found." }, { status: 404 });
    if (body.action === "resume" && current.source === "purchase") return NextResponse.json({ ok: false, error: "Auto-renewal cannot be restored. You can purchase a new plan after the current period ends." }, { status: 400 });
    if (current.stripeSubscriptionId && paymentMode() === "stripe") {
      await getStripe().subscriptions.update(current.stripeSubscriptionId, { cancel_at_period_end: body.action === "cancel" });
    }
    const subscription = body.action === "cancel"
      ? await cancelSubscription(user.id, body.subscriptionId, { code: body.reasonCode, text: body.reasonText })
      : await resumeSubscription(user.id, body.subscriptionId);
    return NextResponse.json({ ok: true, subscription });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Subscription update failed." }, { status: 400 });
  }
}
