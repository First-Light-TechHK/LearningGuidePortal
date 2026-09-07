import { NextResponse } from "next/server";
import { currentProductUser } from "@/services/productAuth";
import { cancelSubscription, getLearningOverview } from "@/services/productStore";
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
    const body = await request.json() as { subscriptionId?: string; action?: "cancel"; reasonCode?: "low_usage" | "too_expensive" | "content" | "website" | "other"; reasonText?: string };
    if (!body.subscriptionId || body.action !== "cancel") return NextResponse.json({ ok: false, error: "Subscription and cancellation reason are required." }, { status: 400 });
    const current = (await getLearningOverview(user.id)).subscriptions.find((subscription) => subscription.id === body.subscriptionId);
    if (current?.stripeSubscriptionId && paymentMode() === "stripe") {
      await getStripe().subscriptions.update(current.stripeSubscriptionId, { cancel_at_period_end: true });
    }
    const subscription = await cancelSubscription(user.id, body.subscriptionId, { code: body.reasonCode, text: body.reasonText });
    return NextResponse.json({ ok: true, subscription });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Subscription update failed." }, { status: 400 });
  }
}
