import { readFile } from "node:fs/promises";
import path from "node:path";
import { getStripe } from "../services/stripeClient";
import { processStripeWebhook } from "../services/stripeWebhookService";
import { checkEntitlement, getCoursePage, listPublishedCourses } from "../services/productStore";
import type { ProductData } from "../services/productStore";

// Repair a missed local test-mode callback using the actual event retrieved from Stripe.
// Never derive payment success or an access grant from a browser redirect.
async function main() {
  if (process.env.APP_ENV !== "DEV" || process.env.STORAGE_BACKEND !== "local"
    || !process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_") || !process.env.STRIPE_WEBHOOK_SECRET) {
    throw new Error("Replay requires DEV, local storage and configured Stripe test credentials.");
  }
  const data = JSON.parse(await readFile(path.join(process.cwd(), "data/knowledge_system/learning_guide/product.json"), "utf8")) as ProductData;
  const orderId = process.argv[2];
  const order = data.orders.find(item => orderId ? item.id === orderId
    : item.planId === "everything-pc-6" && item.paymentMode === "stripe" && item.status === "pending");
  if (!order || order.paymentMode !== "stripe" || !order.stripeCheckoutSessionId) throw new Error("Matching local Stripe order is unavailable.");
  const stripe = getStripe();
  const session = await stripe.checkout.sessions.retrieve(order.stripeCheckoutSessionId);
  if (session.livemode || session.status !== "complete" || session.payment_status !== "paid") throw new Error("Stripe has not confirmed a paid test Checkout.");
  const events = await stripe.events.list({ type: "checkout.session.completed", limit: 100 });
  const matching = events.data.find(event => (event.data.object as { id: string }).id === session.id);
  if (!matching || matching.livemode) throw new Error("The actual completed test event is unavailable for replay.");
  const event = await stripe.events.retrieve(matching.id);
  const raw = JSON.stringify(event);
  // Local delivery only: re-sign the real provider event for the existing verified handler.
  const signature = stripe.webhooks.generateTestHeaderString({ payload: raw, secret: process.env.STRIPE_WEBHOOK_SECRET });
  await processStripeWebhook(raw, signature);
  const courses = await listPublishedCourses();
  const allowed = await Promise.all(courses.map(async course => {
    const access = await checkEntitlement(order.userId, course.id);
    const page = await getCoursePage(course.id, order.userId);
    return access.allowed && page.syllabus.every(lesson => lesson.access === "entitled" && lesson.openable);
  }));
  console.log(JSON.stringify({ replayed: true, publishedCourses: courses.length, entitledCourses: allowed.filter(Boolean).length }));
}

main().catch(error => { console.error(error instanceof Error ? error.message : "Local Stripe replay failed."); process.exitCode = 1; });
