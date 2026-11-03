import { NextResponse } from "next/server";
import { OrderManagementError } from "@/contracts/order-management";
import { getMessages } from "@/lib/i18n/messages";

export function orderManagementResponse(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } });
}
export function orderManagementFailure(error: unknown, locale: "en-GB" | "zh-CN") {
  const failure = error instanceof OrderManagementError ? error : error instanceof SyntaxError
    ? new OrderManagementError("invalid_request", 400) : new OrderManagementError("payment_unavailable", 503);
  const message = getMessages(locale).orderManagement.errors[failure.code];
  return orderManagementResponse({ ok: false, code: failure.code, message, error: message }, failure.status);
}
