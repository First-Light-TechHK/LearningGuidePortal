import { quoteFailure } from "@/services/paymentHttp";
import { NextResponse } from "next/server";
import { currentProductUser } from "@/services/productAuth";
import { createQuote, createUpgradeQuote, getQuoteForUser } from "@/services/productStore";

export async function GET(request: Request) {
  const user = await currentProductUser(request);
  if (!user) return NextResponse.json({ ok: false, error: "Sign in is required." }, { status: 401 });
  const quoteId = new URL(request.url).searchParams.get("quoteId") || "";
  const result = await getQuoteForUser(user.id, quoteId);
  if (!result) return NextResponse.json({ ok: false, error: "Quote not found or expired." }, { status: 404 });
  return NextResponse.json({ ok: true, quote: result.quote, plan: result.plan });
}

export async function POST(request: Request) {
  const user = await currentProductUser(request);
  if (!user) return NextResponse.json({ ok: false, error: "Sign in is required." }, { status: 401 });
  try {
    const body = await request.json() as { planId?: string; subscriptionId?: string; kind?: "purchase" | "trial" | "upgrade" };
    const result = body.kind === "upgrade"
      ? await createUpgradeQuote(user.id, body.subscriptionId || "")
      : await createQuote(user.id, body.planId || "", body.kind === "trial" ? "trial" : "purchase");
    return NextResponse.json({ ok: true, quote: result.quote, plan: result.plan });
  } catch (error) {
    return quoteFailure(error, user.locale);
  }
}
