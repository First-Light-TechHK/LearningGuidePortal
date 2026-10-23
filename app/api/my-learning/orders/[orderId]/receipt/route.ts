import { getMessages } from "@/lib/i18n/messages";
import { currentProductUser } from "@/services/productAuth";
import { getOrderForUser } from "@/services/productStore";
import { stripeOrderReceipt } from "@/services/paymentService";
import { orderReceiptHtml } from "@/lib/orderReceiptHtml";
import type { OrderReceipt } from "@/contracts/order-receipt";
import { isLocale, localeFrom } from "@/lib/i18n/config";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const user = await currentProductUser();
  const requestedLocale = new URL(request.url).searchParams.get("locale");
  const locale = requestedLocale && isLocale(requestedLocale) ? requestedLocale : localeFrom(user?.locale);
  const copy = getMessages(locale).orderReceipt;
  const headers = { "Cache-Control": "private, no-store", "Vary": "Cookie" };
  if (!user) return new Response(copy.signIn, { status: 401, headers });
  const order = await getOrderForUser(user.id, (await params).orderId);
  if (!order || order.status !== "paid" || order.kind === "trial_activation") return new Response(copy.unavailable, { status: 404, headers });

  let receipt: OrderReceipt | null;
  if (order.paymentMode === "stripe") {
    try {
      receipt = await stripeOrderReceipt(order);
    } catch {
      return new Response(copy.providerError, { status: 503, headers });
    }
  } else {
    receipt = { orderId: order.id, planName: order.plan?.name || "", amountMinor: order.amountMinor, currency: order.currency, paidAt: null, paymentMode: "demo" };
  }
  if (!receipt) return new Response(copy.unavailable, { status: 404, headers });
  return new Response(orderReceiptHtml(receipt, locale), { headers: { ...headers, "Content-Type": "text/html; charset=utf-8", "Content-Disposition": "inline", "X-Content-Type-Options": "nosniff" } });
}
