import { paymentFailure } from "@/services/paymentHttp";
import { NextResponse } from "next/server";
import { currentProductUser } from "@/services/productAuth";
import { createQuote, createUpgradeQuote } from "@/services/productStore";

export async function POST(request: Request) {
  const user = await currentProductUser();
  if (!user) return NextResponse.json({ ok: false, error: "Sign in is required." }, { status: 401 });
  try {
    const body = await request.json() as { planId?: string; kind?: "purchase" | "trial" | "upgrade"; subscriptionId?: string };
    if (body.kind === "upgrade") {
      const result = await createUpgradeQuote(user.id, body.subscriptionId || "");
      return NextResponse.json({ ok: true, quote: result.quote, plan: result.plan });
    }
    const result = await createQuote(user.id, body.planId || "", body.kind === "trial" ? "trial" : "purchase");
    return NextResponse.json({ ok: true, quote: result.quote, plan: result.plan });
  } catch (error) {
    return paymentFailure(error, user.locale);
  }
}
