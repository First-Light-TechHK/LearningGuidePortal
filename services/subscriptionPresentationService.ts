import type { StripePriceSnapshot } from "@/contracts/payment";
import { localSubscriptionProductImage } from "@/lib/subscriptionProductImages";
import { getHistoricalProductPresentation } from "./stripePriceService";

export async function presentSubscriptionOrders<T extends { price?: StripePriceSnapshot; plan?: { name: string; scope?: string; scopeId?: string | null; category?: string | null; termMonths?: number } | null }>(orders: T[]) {
  const products = new Map<string, ReturnType<typeof getHistoricalProductPresentation>>();
  return Promise.all(orders.map(async order => {
    const price = order.price;
    let product = { productName: price?.productName, productImage: price?.productImage };
    if (price?.stripePriceId && (!price.productName || !price.productImage)) {
      if (!products.has(price.stripePriceId)) products.set(price.stripePriceId, getHistoricalProductPresentation(price.stripePriceId));
      const historical = await products.get(price.stripePriceId)!;
      product = { productName: product.productName || historical.productName, productImage: product.productImage || historical.productImage };
    }
    const plan = order.plan;
    const name = product.productName || (plan?.scope === "category" ? plan.scopeId || plan.category : plan?.scope === "everything" ? "Everything" : null) || plan?.name || "";
    return { ...order, presentation: { name, image: product.productImage || localSubscriptionProductImage(plan) || null, termMonths: price?.termMonths || plan?.termMonths || null } };
  }));
}
