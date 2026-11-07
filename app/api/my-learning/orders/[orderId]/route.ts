import { currentProductUser } from "@/services/productAuth";
import { manageOrderPayment } from "@/services/orderPaymentService";
import { checkoutRequestOrigin } from "@/services/paymentService";
import { orderManagementFailure, orderManagementResponse } from "@/services/orderManagementHttp";
import { OrderManagementError, parseOrderAction } from "@/contracts/order-management";

export async function POST(request: Request, context: { params: Promise<{ orderId: string }> }) {
  let locale: "en-GB" | "zh-CN" = new URL(request.url).searchParams.get("locale") === "zh-CN" ? "zh-CN" : "en-GB";
  try {
    const user = await currentProductUser();
    if (!user) throw new OrderManagementError("unauthenticated", 401);
    locale = new URL(request.url).searchParams.has("locale") ? locale : user.locale;
    try { checkoutRequestOrigin(request); } catch { throw new OrderManagementError("forbidden_origin", 403); }
    const { action } = parseOrderAction(await request.json());
    const { orderId } = await context.params;
    if (!/^[a-zA-Z0-9_-]{1,160}$/.test(orderId)) throw new OrderManagementError("invalid_request", 400);
    return orderManagementResponse({ ok: true, data: await manageOrderPayment(user.id, orderId, action, { locale }) });
  } catch (error) { return orderManagementFailure(error, locale); }
}
