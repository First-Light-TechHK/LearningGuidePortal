import { NextResponse } from "next/server";
import { processStripeWebhook } from "@/services/stripeWebhookService";
export const runtime = "nodejs";
export async function POST(request: Request) {
  if (!process.env.STRIPE_WEBHOOK_SECRET?.trim()) return NextResponse.json({ ok: false, code: "webhook_unavailable" }, { status: 503 });
  const signature = request.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ ok: false, code: "invalid_signature" }, { status: 400 });
  try { return NextResponse.json({ ok: true, ...await processStripeWebhook(await request.text(), signature) }); }
  catch (error) {
    const invalid = error instanceof Error && "type" in error && error.type === "StripeSignatureVerificationError";
    const message = error instanceof Error ? error.message : "";
    const rejected = /Live events are not allowed|order or plan not found|Checkout identity mismatch|Checkout amount|Checkout currency|Checkout does not match|Order is not available/i.test(message);
    return NextResponse.json({ ok: false, code: invalid ? "invalid_signature" : rejected ? "invalid_request" : "payment_sync_failed" }, { status: invalid || rejected ? 400 : 500 });
  }
}
