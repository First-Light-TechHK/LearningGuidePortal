import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { PaymentError } from "@/contracts/payment";
import { getMessages } from "@/lib/i18n/messages";

const CLIENT_PAYMENT = /already has active access|already been used|Plan not found|trial has ended|Only an active PC|source subscription|upgrade quote|does not include a trial|quote has expired|cannot be completed|cannot be resumed|cannot be restored|Trial order not found|Payment order not found/i;

export function paymentFailure(error: unknown, locale: "en-GB" | "zh-CN" = "en-GB") {
  const requestId = randomUUID();
  if (error instanceof PaymentError) {
    const message = getMessages(locale).paymentErrors[error.code];
    return NextResponse.json({ ok: false, code: error.code, error: message, message, requestId }, { status: error.status });
  }
  const detail = error instanceof Error ? error.message : "Payment unavailable.";
  if (CLIENT_PAYMENT.test(detail)) {
    return NextResponse.json({ ok: false, code: "invalid_request", error: detail, message: detail, requestId }, { status: 400 });
  }
  const message = getMessages(locale).paymentErrors.payment_unavailable;
  return NextResponse.json({ ok: false, code: "payment_unavailable", error: message, message, requestId }, { status: 502 });
}
