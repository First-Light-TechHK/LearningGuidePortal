import assert from "node:assert/strict";
import { test } from "node:test";
import { groupSubscriptionRecords, subscriptionListRecords, subscriptionPaymentType } from "../../services/subscriptionRecords";
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

test("new list sections use actual states, upgrade links and expiration dates",()=>{
 const source={...subscription("category"),scope:"category" as const,state:"expired" as const};
 const active={...subscription("all"),scope:"everything" as const,validTo:"2026-10-31"};
 const upgrade={...order("upgrade"),kind:"upgrade" as const,sourceSubscriptionId:"category"};
 const records=subscriptionListRecords([source,active],[upgrade],new Date("2026-10-15T00:00:00Z"));
 assert.equal(records[0].past,true);assert.equal(records[0].displayState,"expired");assert.equal(records[0].includedInEverything,false);
 assert.equal(records[1].past,false);assert.equal(records[1].daysLeft,16);
 assert.equal(subscriptionPaymentType(upgrade,[upgrade]),"upgrade");
 assert.equal(subscriptionPaymentType(order("new"),[order("old"),order("new")]),"renewal");
 assert.equal(subscriptionPaymentType(order("old"),[order("old"),order("new")]),"purchase");
});

test("upgrade histories sharing a Stripe subscription keep each plan's payments",()=>{
 const source={...subscription("source","stripe"),plan:{id:"category",name:"Science"},state:"expired" as const};
 const target={...subscription("target","stripe"),plan:{id:"everything",name:"Everything"}};
 const rows=groupSubscriptionRecords([source,target],[{...order("old","paid","stripe"),plan:source.plan},{...order("new","paid","stripe"),kind:"upgrade",sourceSubscriptionId:source.id,plan:target.plan}]);
 assert.deepEqual(rows.map(r=>r.orders.map(o=>o.id)),[["old"],["new"]]);
});

test("Everything absorbs its explicitly upgraded Category history while independent expired products stay past", () => {
  const source = { ...subscription("source", "stripe"), scope: "category" as const, scopeId: "Chinese Humanities", plan: { id: "category", name: "Chinese Humanities" }, state: "expired" as const };
  const target = { ...subscription("target", "stripe"), scope: "everything" as const, plan: { id: "everything", name: "Everything" } };
  const past = { ...subscription("past", "past-stripe"), scope: "category" as const, scopeId: "Science", state: "expired" as const };
  const payments = [{ ...order("old", "paid", "stripe"), plan: source.plan }, { ...order("new", "paid", "stripe"), kind: "upgrade" as const, sourceSubscriptionId: source.id, plan: target.plan }];
  const before = structuredClone({ source, target, past, payments });
  const rows = subscriptionListRecords([target, source, past], payments, new Date("2026-10-13"));
  assert.equal(rows.length, 2); assert.equal(rows[0].past, false); assert.equal(rows[1].past, true);
  assert.deepEqual(rows[0].orders.map(item => item.id), ["new", "old"]);
  assert.deepEqual({ source, target, past, payments }, before);
});

test("same-product repurchases across terms use the live product card and keep all original periods", () => {
  const current = { ...subscription("current"), scope: "category" as const, scopeId: "Science" };
  const previous = { ...current, id: "previous", state: "expired" as const, plan: { id: "science-year", name: "Science" } };
  const rows = subscriptionListRecords([previous, current], [{ ...order("new"), plan: current.plan }, { ...order("old"), plan: previous.plan }], new Date("2026-10-13"));
  assert.equal(rows.length, 1); assert.equal(rows[0].id, "current"); assert.equal(rows[0].orders.length, 2);
});

test("expired active/grace rows are classified by effective dates without mutating subscription facts", () => {
  const rows = subscriptionListRecords([{ ...subscription("expired"), validTo: "2026-10-01" }, { ...subscription("grace"), state: "grace", validTo: "2026-10-01", graceEndsAt: "2026-10-18" }], [], new Date("2026-10-13"));
  assert.equal(rows[0].past, true); assert.equal(rows[0].displayState, "expired"); assert.equal(rows[0].subscription?.state, "active");
  assert.equal(rows[1].past, false); assert.equal(rows[1].displayState, "grace");
});

test("independently billing live contracts retain separate management actions even for the same product", () => {
  const first = { ...subscription("first", "stripe-first"), scope: "category" as const, scopeId: "Science" };
  const second = { ...first, id: "second", stripeSubscriptionId: "stripe-second" };
  const rows = subscriptionListRecords([first, second], [], new Date("2026-10-13"));
  assert.deepEqual(rows.map(row => row.subscription?.stripeSubscriptionId), ["stripe-first", "stripe-second"]);
});
