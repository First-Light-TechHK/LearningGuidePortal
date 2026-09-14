import type { StripePriceSnapshot } from "@/contracts/payment";
import { getHistoricalProductPresentation } from "./stripePriceService";

export async function presentSubscriptionOrders<T extends { price?: StripePriceSnapshot; plan?: { name: string; scope?: string; scopeId?: string | null; category?: string | null; termMonths?: number } | null }>(orders: T[]) {
  const products = new Map<string, ReturnType<typeof getHistoricalProductPresentation>>();
  return Promise.all(orders.map(async order => {
    const price = order.price;
    let product = { productName: price?.productName, productImage: price?.productImage };
    if (price?.stripePriceId && !price.productName) {
      if (!products.has(price.stripePriceId)) products.set(price.stripePriceId, getHistoricalProductPresentation(price.stripePriceId));
      product = { ...product, ...await products.get(price.stripePriceId)! };
    }
    const plan = order.plan;
    const name = product.productName || (plan?.scope === "category" ? plan.scopeId || plan.category : plan?.scope === "everything" ? "Everything" : null) || plan?.name || "";
    return { ...order, presentation: { name, image: product.productImage || null, termMonths: price?.termMonths || plan?.termMonths || null } };
  }));
}
