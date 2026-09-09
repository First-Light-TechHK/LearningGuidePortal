import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { PaymentError } from "@/contracts/payment";
import { getMessages } from "@/lib/i18n/messages";

export function paymentFailure(error: unknown, locale: "en-GB" | "zh-CN" = "en-GB") {
  const requestId = randomUUID();
  const code = error instanceof PaymentError ? error.code : "payment_unavailable";
  const message = getMessages(locale).paymentErrors[code];
  return NextResponse.json({ ok: false, code, error: message, message, requestId }, { status: error instanceof PaymentError ? error.status : 502 });
}
