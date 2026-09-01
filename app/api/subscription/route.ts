import { NextResponse } from "next/server";
import { currentProductUser } from "@/services/productAuth";
import { cancelSubscription, getLearningOverview, resumeSubscription } from "@/services/productStore";
import { getStripe } from "@/services/stripeClient";

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
    const body = await request.json() as { subscriptionId?: string; action?: "cancel" | "resume" };
    if (!body.subscriptionId || !body.action) return NextResponse.json({ ok: false, error: "Subscription and action are required." }, { status: 400 });
    const current = (await getLearningOverview(user.id)).subscriptions.find((subscription) => subscription.id === body.subscriptionId);
    if (current?.stripeSubscriptionId && process.env.PAYMENT_MODE === "stripe") {
      await getStripe().subscriptions.update(current.stripeSubscriptionId, { cancel_at_period_end: body.action === "cancel" });
    }
    const subscription = body.action === "cancel" ? await cancelSubscription(user.id, body.subscriptionId) : await resumeSubscription(user.id, body.subscriptionId);
    return NextResponse.json({ ok: true, subscription });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Subscription update failed." }, { status: 400 });
  }
}
