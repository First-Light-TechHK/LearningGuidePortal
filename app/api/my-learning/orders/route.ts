import { currentProductUser } from "@/services/productAuth";
import { listManagedOrders } from "@/services/orderPaymentService";
import { orderManagementFailure, orderManagementResponse } from "@/services/orderManagementHttp";
import { OrderManagementError } from "@/contracts/order-management";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  let locale: "en-GB" | "zh-CN" = new URL(request.url).searchParams.get("locale") === "zh-CN" ? "zh-CN" : "en-GB";
  try {
    const user = await currentProductUser();
    if (!user) throw new OrderManagementError("unauthenticated", 401);
    locale = new URL(request.url).searchParams.has("locale") ? locale : user.locale;
    return orderManagementResponse({ ok: true, data: { orders: await listManagedOrders(user.id) } });
  } catch (error) { return orderManagementFailure(error, locale); }
}
