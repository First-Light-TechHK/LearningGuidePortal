import { NextResponse } from "next/server";
import { currentProductUser } from "@/services/productAuth";
import { getLearningOverview } from "@/services/productStore";
import { createCustomerPortalSession } from "@/services/stripeClient";

export async function POST(request: Request) {
  const user = await currentProductUser();
  if (!user) return NextResponse.json({ ok: false, error: "Sign in is required." }, { status: 401 });
  if (process.env.PAYMENT_MODE !== "stripe") return NextResponse.json({ ok: false, error: "Billing is in demo mode." }, { status: 400 });
  try {
    const body = await request.json() as { locale?: "en-GB" | "zh-CN" };
    const locale = body.locale === "zh-CN" ? "zh-CN" : "en-GB";
    const subscription = (await getLearningOverview(user.id)).subscriptions.find((item) => item.source === "purchase" && item.stripeCustomerId);
    if (!subscription?.stripeCustomerId) throw new Error("A Stripe customer is not available for this account yet.");
    const origin = process.env.NEXT_PUBLIC_APP_URL?.trim() || new URL(request.url).origin;
    const url = await createCustomerPortalSession({ customerId: subscription.stripeCustomerId, returnUrl: `${origin}/${locale}/account/my-learning/subscription`, locale });
    return NextResponse.json({ ok: true, url });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Stripe customer portal could not be opened." }, { status: 400 });
  }
}
