// v4 Part A (helpdesk-v4-order-and-chat-end.md): the read-only order
// projection for the BackOffice "Order" block and the ownership check of a new
// enquiry's orderId. Pure code over the order owner's records: it never
// writes, never changes payment logic, and passes on only the listed fields
// (no card data, Stripe ids or secrets, addresses). The AI agent never calls
// this; order data flows Portal store -> this projection -> integration API ->
// BackOffice UI only.
import { ORDER_KINDS, ORDER_STATUSES, PAYMENT_MODES, type OrderProjection } from "@/contracts/helpdesk";
import type { ProductOrder, ProductPlan } from "@/services/productStore";

export type OrderSource = {
  orders: Array<Pick<ProductOrder, "id" | "userId" | "planId" | "status" | "amountMinor" | "currency" | "paymentMode" | "createdAt"> & Partial<Pick<ProductOrder, "kind" | "planSnapshot">>>;
  plans: Array<Pick<ProductPlan, "id" | "name">>;
};

/** Every key of OrderProjection, in contract order (tests pin that nothing else is sent). */
export const ORDER_PROJECTION_FIELDS = ["id", "status", "amount", "currency", "planName", "kind", "createdAt", "paymentMode"] as const satisfies ReadonlyArray<keyof OrderProjection>;

const oneOf = <T extends string>(values: readonly T[], value: unknown, fallback: T): T => ((values as readonly unknown[]).includes(value) ? value as T : fallback);

/** The learner's own order as the BackOffice may see it, or null when it is not theirs or does not exist. */
export function projectOrder(source: OrderSource, userId: string, orderId: string): OrderProjection | null {
  const order = source.orders.find((item) => item.id === orderId && item.userId === userId);
  if (!order) return null;
  const plan = source.plans.find((item) => item.id === order.planId);
  return {
    id: order.id,
    status: oneOf(ORDER_STATUSES, order.status, "pending"),
    amount: order.amountMinor,
    currency: order.currency,
    // The plan the order was bought under (its snapshot), else the current plan, else its id.
    planName: order.planSnapshot?.name || plan?.name || order.planId,
    // Orders written before kinds existed are purchases (services/productStore.ts).
    kind: oneOf(ORDER_KINDS, order.kind, "purchase"),
    createdAt: order.createdAt,
    paymentMode: oneOf(PAYMENT_MODES, order.paymentMode, "demo")
  };
}
