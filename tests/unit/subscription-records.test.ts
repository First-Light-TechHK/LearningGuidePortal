import assert from "node:assert/strict";
import { test } from "node:test";
import { groupSubscriptionRecords } from "../../services/subscriptionRecords";
import type { SubscriptionRecordOrder as Order, SubscriptionRecordSubscription as Subscription } from "../../contracts/subscription-records";

const subscription = (id: string, stripeSubscriptionId: string | null = null): Subscription => ({ id, stripeSubscriptionId, state:"active", source:"purchase", validFrom:"2026-08-01", validTo:"2027-02-01", plan:{id:"plan",name:"Everything"} });
const order = (id: string, status: Order["status"] = "paid", stripeSubscriptionId: string | null = null): Order => ({id,status,stripeSubscriptionId,amountMinor:9900,currency:"USD",paymentMode:"demo",createdAt:`2026-08-${id === "new" ? "02" : "01"}`,plan:{id:"plan",name:"Everything"}});

test("subscription products group renewal payments and failed attempts without mutating inputs", () => {
  const subscriptions = [subscription("a","stripe-a"), {...subscription("b","stripe-b"),state:"expired" as const}];
  const orders = [order("old","paid","stripe-a"),order("new","paid","stripe-a"),order("failed","failed","stripe-b"),order("checkout-only","pending","unknown")];
  const before = structuredClone({subscriptions,orders});
  const grouped = groupSubscriptionRecords(subscriptions,orders);
  assert.equal(grouped.length,2);
  assert.deepEqual(grouped[0].orders.map(item => item.id),["new","old"]);
  assert.deepEqual(grouped[1].orders.map(item => item.id),["failed"]);
  assert.deepEqual({subscriptions,orders},before);
});

test("historical paid/refunded products survive missing subscription rows but failed checkout does not create one", () => {
  const grouped = groupSubscriptionRecords([], [order("old"),order("new","refunded"),{...order("failed","failed"),plan:{id:"other",name:"Science"}}]);
  assert.equal(grouped.length,1);
  assert.equal(grouped[0].subscription,null);
  assert.equal(grouped[0].orders.length,2);
  assert.deepEqual(groupSubscriptionRecords([],[]),[]);
});

test("local subscription payment and trial activation map to separate subscription products", () => {
  const trial: Subscription = {...subscription("trial"), source:"trial",state:"trial_canceled"};
  const grouped = groupSubscriptionRecords([trial,subscription("purchase")],[order("paid"),{...order("trial"),kind:"trial_activation"}]);
  assert.deepEqual(grouped.map(item => item.orders.map(payment => payment.id)),[["trial"],["paid"]]);
});

test("repeat local purchases of the same product retain their own period history", () => {
  const previous = {...subscription("previous"),validFrom:"2026-02-01",validTo:"2026-08-01",state:"expired" as const};
  const current = subscription("current");
  const grouped = groupSubscriptionRecords([current,previous],[{...order("old"),createdAt:"2026-02-01",servicePeriodStart:"2026-02-01"},{...order("new"),servicePeriodStart:"2026-08-01"}]);
  assert.deepEqual(grouped.map(item => item.orders.map(payment => payment.id)),[["new"],["old"]]);
});
