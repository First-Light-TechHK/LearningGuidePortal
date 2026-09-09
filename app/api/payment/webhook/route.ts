import { NextResponse } from "next/server";
import { processStripeWebhook } from "@/services/stripeWebhookService";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ ok: false, code: "invalid_signature" }, { status: 400 });
  try { return NextResponse.json({ ok: true, ...await processStripeWebhook(await request.text(), signature) }); }
  catch (error) {
    const invalid = error instanceof Error && "type" in error && error.type === "StripeSignatureVerificationError";
    return NextResponse.json({ ok: false, code: invalid ? "invalid_signature" : "payment_sync_failed" }, { status: invalid ? 400 : 500 });
  }
}
