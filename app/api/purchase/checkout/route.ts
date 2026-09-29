import { NextResponse } from "next/server";
import { currentProductUser } from "@/services/productAuth";
import { startPayment, type CheckoutRequest } from "@/services/paymentService";
import { paymentFailure } from "@/services/paymentHttp";
export async function POST(request: Request) {
  const user = await currentProductUser(request);
  if (!user) return NextResponse.json({ ok: false, error: "Sign in is required." }, { status: 401 });
  try {
    const body = await request.json() as CheckoutRequest;
    return NextResponse.json({ ok: true, ...await startPayment(user, body, request, false) });
  } catch (error) { return paymentFailure(error, user.locale); }
}
