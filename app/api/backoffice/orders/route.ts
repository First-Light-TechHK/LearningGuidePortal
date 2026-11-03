import { currentOperatorUser } from "@/services/productAuth";
import { isOperator, listOperatorOrders } from "@/services/productStore";
import { requestOriginMatches } from "@/services/adminHost";
import { actOnOperatorOrder } from "@/services/operatorOrderService";
import { orderManagementFailure, orderManagementResponse } from "@/services/orderManagementHttp";
import { OrderManagementError } from "@/contracts/order-management";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const user = await currentOperatorUser();
  if (!user || !isOperator(user)) return orderManagementFailure(new OrderManagementError("forbidden", 403), "en-GB");
  try {
    const params = new URL(request.url).searchParams;
    return orderManagementResponse({ ok: true, orders: await listOperatorOrders({ search: params.get("search") || undefined, status: params.get("status") || undefined, paymentMode: params.get("paymentMode") || undefined }) });
  } catch (error) { return orderManagementFailure(error, user.locale); }
}
export async function POST(request: Request) {
  const user = await currentOperatorUser();
  if (!user || !isOperator(user)) return orderManagementFailure(new OrderManagementError("forbidden", 403), "en-GB");
  try {
    if (!requestOriginMatches(request)) throw new OrderManagementError("forbidden_origin", 403);
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body) || typeof body.orderId !== "string" || !/^[a-zA-Z0-9_-]{1,160}$/.test(body.orderId)
      || !["refund", "resynchronise", "cancel"].includes(body.action) || body.reason !== undefined && (typeof body.reason !== "string" || body.reason.length > 1000)) throw new OrderManagementError("invalid_request", 400);
    return orderManagementResponse({ ok: true, ...await actOnOperatorOrder(user, body) });
  } catch (error) { return orderManagementFailure(error, user.locale); }
}
