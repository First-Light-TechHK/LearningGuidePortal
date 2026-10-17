import assert from "node:assert/strict";
import { test } from "node:test";
import { isolate, setCookie, clearCookies, SESSION_COOKIE } from "./harness";
import { readProductData, writeProductData, verifiedUser } from "../unit/helpers/my-learning";
import { canViewSubscriptionReceipt } from "../../contracts/subscription-records";

test("paid upgrade receipts use Stripe Charge receipts with ownership/status gates",async()=>{
  const {restore}=await isolate("lg-upgrade-receipt-");
  const previousSecret=process.env.STRIPE_SECRET_KEY;process.env.STRIPE_SECRET_KEY="sk_test_receipt_fixture";
  try {
    const store=await import("../../services/productStore");
    const user=await verifiedUser(store,"receipt@example.test");
    const session=await store.createSession(user.id);setCookie(SESSION_COOKIE,session.token);
    const data=await readProductData();
    const order={id:"upgrade-paid",userId:user.id,planId:"everything-pc-6",quoteId:"quote-receipt",kind:"upgrade" as const,paymentMode:"stripe" as const,status:"paid" as const,amountMinor:6000,currency:"usd",stripePaymentIntentId:"pi_upgrade",stripeInvoiceId:null,createdAt:new Date().toISOString()};
    data.orders.push(order);await writeProductData(data);
    const {getStripe}=await import("../../services/stripeClient");const stripe=getStripe();
    const {stripeOrderReceiptUrl}=await import("../../services/paymentService");
    let calls=0,mode="expanded";
    stripe.paymentIntents.retrieve=(async id=>{calls++;assert.equal(id,"pi_upgrade");if(mode==="error")throw new Error("provider unavailable");return {status:mode==="pending"?"processing":"succeeded",latest_charge:mode==="string"?"ch_upgrade":{paid:true,receipt_url:mode==="missing"?null:"https://pay.stripe.com/receipts/upgrade"}};}) as typeof stripe.paymentIntents.retrieve;
    stripe.charges.retrieve=(async id=>{assert.equal(id,"ch_upgrade");return {paid:true,receipt_url:"https://pay.stripe.com/receipts/upgrade"};}) as typeof stripe.charges.retrieve;
    stripe.invoices.retrieve=(async()=>({hosted_invoice_url:mode==="invoice"?"https://invoice.stripe.com/receipt":null})) as typeof stripe.invoices.retrieve;
    assert.equal(canViewSubscriptionReceipt(order),true);
    assert.equal(await stripeOrderReceiptUrl(order),"https://pay.stripe.com/receipts/upgrade");
    mode="string";assert.equal(await stripeOrderReceiptUrl(order),"https://pay.stripe.com/receipts/upgrade");
    mode="invoice";assert.equal(await stripeOrderReceiptUrl({...order,stripeInvoiceId:"in_paid"}),"https://invoice.stripe.com/receipt");
    const route=await import("../../app/api/my-learning/orders/[orderId]/receipt/route");
    const request=()=>route.GET(new Request("http://localhost/receipt"),{params:Promise.resolve({orderId:order.id})});
    mode="expanded";let response=await request();assert.equal(response.status,302);assert.equal(response.headers.get("location"),"https://pay.stripe.com/receipts/upgrade");
    for(const missing of ["missing","pending"]){mode=missing;assert.equal((await request()).status,404);}
    mode="error";assert.equal((await request()).status,503);
    const callsBefore=calls;
    clearCookies();assert.equal((await request()).status,401);
    const other=await verifiedUser(store,"other-receipt@example.test");setCookie(SESSION_COOKIE,(await store.createSession(other.id)).token);assert.equal((await request()).status,404);
    setCookie(SESSION_COOKIE,session.token);
    for(const status of ["pending","failed","refunded"]){const current=await readProductData();current.orders.find((item:any)=>item.id===order.id).status=status;await writeProductData(current);assert.equal((await request()).status,404);assert.equal(canViewSubscriptionReceipt({...order,status}),false);}
    assert.equal(calls,callsBefore,"denied orders must never request Stripe receipts");
    assert.equal(canViewSubscriptionReceipt({...order,kind:"trial_activation"}),false);
    assert.equal(canViewSubscriptionReceipt({...order,stripePaymentIntentId:null}),false);
  }finally{if(previousSecret===undefined)delete process.env.STRIPE_SECRET_KEY;else process.env.STRIPE_SECRET_KEY=previousSecret;await restore();}
});

test("legacy subscription receipts resolve the original paid Checkout invoice without rewriting local orders", async () => {
  const { restore } = await isolate("lg-checkout-receipt-");
  process.env.STRIPE_SECRET_KEY = "sk_test_receipt_fixture";
  try {
    const store = await import("../../services/productStore");
    const user = await verifiedUser(store, "checkout-receipt@example.test");
    const token = (await store.createSession(user.id)).token;
    setCookie(SESSION_COOKIE, token);
    const order = { id: "legacy-everything", userId: user.id, planId: "everything-pc-6", quoteId: "legacy-quote", kind: "purchase" as const, paymentMode: "stripe" as const, status: "paid" as const, amountMinor: 9900, currency: "usd", stripeCheckoutSessionId: "cs_original", stripeSubscriptionId: "sub_original", createdAt: "2026-10-11T03:50:09.346Z" };
    const data = await readProductData(); data.orders.push(order); await writeProductData(data);
    const stripe = (await import("../../services/stripeClient")).getStripe();
    const { stripeOrderReceiptUrl } = await import("../../services/paymentService");
    const session = { id: "cs_original", status: "complete", payment_status: "paid", amount_total: 9900, currency: "usd", subscription: "sub_original", invoice: "in_original", payment_intent: null, metadata: { orderId: order.id, userId: user.id } };
    const invoice = { id: "in_original", status: "paid", amount_paid: 9900, currency: "usd", hosted_invoice_url: "https://invoice.stripe.com/original" };
    let calls = 0;
    stripe.checkout.sessions.retrieve = (async id => { calls++; assert.equal(id, "cs_original"); return session; }) as typeof stripe.checkout.sessions.retrieve;
    stripe.invoices.retrieve = (async id => { assert.equal(id, "in_original"); return invoice; }) as typeof stripe.invoices.retrieve;
    assert.equal(canViewSubscriptionReceipt(order), true);
    assert.equal(await stripeOrderReceiptUrl(order), invoice.hosted_invoice_url);
    const route = await import("../../app/api/my-learning/orders/[orderId]/receipt/route");
    const request = () => route.GET(new Request("http://localhost/receipt"), { params: Promise.resolve({ orderId: order.id }) });
    assert.equal((await request()).headers.get("location"), invoice.hosted_invoice_url);
    for (const invalid of [{ status: "open" }, { payment_status: "unpaid" }, { amount_total: 3900 }, { currency: "eur" }, { subscription: "sub_other" }, { metadata: { orderId: "other", userId: user.id } }, { metadata: { orderId: order.id, userId: "other" } }]) {
      const original = { ...session }; Object.assign(session, invalid);
      assert.equal((await request()).status, 404); Object.assign(session, original);
    }
    invoice.status = "open"; assert.equal((await request()).status, 404); invoice.status = "paid";
    invoice.amount_paid = 1; assert.equal((await request()).status, 404); invoice.amount_paid = 9900;
    clearCookies(); const before = calls; assert.equal((await request()).status, 401); assert.equal(calls, before);
    setCookie(SESSION_COOKIE, token);
    stripe.checkout.sessions.retrieve = (async () => { throw new Error("unavailable"); }) as typeof stripe.checkout.sessions.retrieve;
    assert.equal((await request()).status, 503);
    assert.deepEqual((await readProductData()).orders.find((item: any) => item.id === order.id), order);
  } finally { await restore(); }
});
