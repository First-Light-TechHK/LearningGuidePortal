import assert from "node:assert/strict";
import { test } from "node:test";
import { stop } from "esbuild";
import { isolate, setCookie, clearCookies, SESSION_COOKIE } from "./harness";
import { readProductData, writeProductData, verifiedUser } from "../unit/helpers/my-learning";
import { canViewSubscriptionReceipt } from "../../contracts/subscription-records";

test("paid upgrade receipts verify Stripe and render no balances with ownership/status gates",async()=>{
  const {restore}=await isolate("lg-upgrade-receipt-");
  const previousSecret=process.env.STRIPE_SECRET_KEY;process.env.STRIPE_SECRET_KEY="sk_test_receipt_fixture";
  try {
    const store=await import("../../services/productStore");
    const user=await verifiedUser(store,"receipt@example.test");
    const session=await store.createSession(user.id);setCookie(SESSION_COOKIE,session.token);
    const data=await readProductData();
    const order={id:"upgrade-paid",userId:user.id,planId:"everything-pc-6",quoteId:"quote-receipt",kind:"upgrade" as const,paymentMode:"stripe" as const,status:"paid" as const,amountMinor:6000,currency:"usd" as const,stripeCheckoutSessionId:null,stripeSubscriptionId:null,stripePaymentIntentId:"pi_upgrade",stripeInvoiceId:null,createdAt:new Date().toISOString()};
    data.orders.push(order);await writeProductData(data);
    const {getStripe}=await import("../../services/stripeClient");const stripe=getStripe();
    const {stripeOrderReceipt}=await import("../../services/paymentService");
    let calls=0,mode="expanded";
    stripe.paymentIntents.retrieve=(async (id: string)=>{calls++;assert.equal(id,"pi_upgrade");if(mode==="error")throw new Error("provider unavailable");return {id:"pi_upgrade",amount_received:mode==="amount"?1:6000,currency:mode==="currency"?"eur":"usd",status:mode==="pending"?"processing":"succeeded",latest_charge:mode==="string"?"ch_upgrade":{paid:mode!=="missing",amount:6000,currency:"usd",created:1792022400,refunded:mode==="refunded",receipt_url:mode==="missing"?null:"https://pay.stripe.com/receipts/upgrade"}};}) as unknown as typeof stripe.paymentIntents.retrieve;
    stripe.charges.retrieve=(async (id: string)=>{assert.equal(id,"ch_upgrade");return {paid:true,amount:6000,currency:"usd",created:1792022400,receipt_url:"https://pay.stripe.com/receipts/upgrade"};}) as unknown as typeof stripe.charges.retrieve;
    stripe.invoices.retrieve=(async()=>({id:"in_paid",status:"paid",amount_paid:6000,currency:"usd",status_transitions:{paid_at:1792022400},hosted_invoice_url:mode==="invoice"?"https://invoice.stripe.com/receipt":null})) as unknown as typeof stripe.invoices.retrieve;
    assert.equal(canViewSubscriptionReceipt(order),true);
    assert.equal((await stripeOrderReceipt(order))?.amountMinor,6000);
    mode="string";assert.equal((await stripeOrderReceipt(order))?.amountMinor,6000);
    mode="invoice";assert.equal((await stripeOrderReceipt({...order,stripeInvoiceId:"in_paid"}))?.paidAt,"2026-10-15T00:00:00.000Z");
    const route=await import("../../app/api/my-learning/orders/[orderId]/receipt/route");
    const request=()=>route.GET(new Request("http://localhost/receipt"),{params:Promise.resolve({orderId:order.id})});
    mode="expanded";let response=await request();assert.equal(response.status,200);assert.equal(response.headers.get("location"),null);assert.equal(response.headers.get("cache-control"),"private, no-store");const html=await response.text();assert.match(html,/US\$60\.00/);assert.doesNotMatch(html,/remaining|balance|余额|剩余|Demo payment/);
    for(const missing of ["missing","pending","amount","currency","refunded"]){mode=missing;assert.equal((await request()).status,404);}
    mode="error";assert.equal((await request()).status,503);
    const callsBefore=calls;
    clearCookies();assert.equal((await request()).status,401);
    const other=await verifiedUser(store,"other-receipt@example.test");setCookie(SESSION_COOKIE,(await store.createSession(other.id)).token);assert.equal((await request()).status,404);
    setCookie(SESSION_COOKIE,session.token);
    for(const status of ["pending","failed","refunded"]){const current=await readProductData();current.orders.find((item:any)=>item.id===order.id).status=status;await writeProductData(current);assert.equal((await request()).status,404);assert.equal(canViewSubscriptionReceipt({...order,status}),false);}
    assert.equal(calls,callsBefore,"denied orders must never request Stripe receipts");
    assert.equal(canViewSubscriptionReceipt({...order,kind:"trial_activation"}),false);
    assert.equal(canViewSubscriptionReceipt({...order,stripePaymentIntentId:null}),false);
  }finally{if(previousSecret===undefined)delete process.env.STRIPE_SECRET_KEY;else process.env.STRIPE_SECRET_KEY=previousSecret;await stop();await restore();}
});

test("legacy subscription receipts resolve the original paid Checkout invoice without rewriting local orders", async () => {
  const { restore } = await isolate("lg-checkout-receipt-");
  process.env.STRIPE_SECRET_KEY = "sk_test_receipt_fixture";
  try {
    const store = await import("../../services/productStore");
    const user = await verifiedUser(store, "checkout-receipt@example.test");
    const token = (await store.createSession(user.id)).token;
    setCookie(SESSION_COOKIE, token);
    const order = { id: "legacy-everything", userId: user.id, planId: "everything-pc-6", quoteId: "legacy-quote", kind: "purchase" as const, paymentMode: "stripe" as const, status: "paid" as const, amountMinor: 9900, currency: "usd" as const, stripeCheckoutSessionId: "cs_original", stripeSubscriptionId: "sub_original", stripePaymentIntentId: null, stripeInvoiceId: null, createdAt: "2026-10-11T03:50:09.346Z" };
    const data = await readProductData(); data.orders.push(order); await writeProductData(data);
    const stripe = (await import("../../services/stripeClient")).getStripe();
    const { stripeOrderReceipt } = await import("../../services/paymentService");
    const session = { id: "cs_original", status: "complete", payment_status: "paid", amount_total: 9900, currency: "usd", subscription: "sub_original", invoice: "in_original", payment_intent: null, metadata: { orderId: order.id, userId: user.id } };
    const invoice = { id: "in_original", status: "paid", amount_paid: 9900, currency: "usd", parent:{subscription_details:{subscription:"sub_original"}}, status_transitions:{paid_at:1791690609}, hosted_invoice_url: "https://invoice.stripe.com/original" };
    let calls = 0;
    stripe.checkout.sessions.retrieve = (async (id: string) => { calls++; assert.equal(id, "cs_original"); return session; }) as unknown as typeof stripe.checkout.sessions.retrieve;
    stripe.invoices.retrieve = (async (id: string) => { assert.equal(id, "in_original"); return invoice; }) as unknown as typeof stripe.invoices.retrieve;
    assert.equal(canViewSubscriptionReceipt(order), true);
    assert.equal((await stripeOrderReceipt(order))?.amountMinor,9900);
    const route = await import("../../app/api/my-learning/orders/[orderId]/receipt/route");
    const request = () => route.GET(new Request("http://localhost/receipt"), { params: Promise.resolve({ orderId: order.id }) });
    const response=await request();assert.equal(response.status,200);assert.match(await response.text(),/US\$99\.00/);
    for (const invalid of [{ status: "open" }, { payment_status: "unpaid" }, { amount_total: 3900 }, { currency: "eur" }, { subscription: "sub_other" }, { metadata: { orderId: "other", userId: user.id } }, { metadata: { orderId: order.id, userId: "other" } }]) {
      const original = { ...session }; Object.assign(session, invalid);
      assert.equal((await request()).status, 404); Object.assign(session, original);
    }
    invoice.status = "open"; assert.equal((await request()).status, 404); invoice.status = "paid";
    invoice.parent.subscription_details.subscription="sub_other";assert.equal((await request()).status,404);invoice.parent.subscription_details.subscription="sub_original";
    invoice.currency="eur";assert.equal((await request()).status,404);invoice.currency="usd";
    invoice.amount_paid = 1; assert.equal((await request()).status, 404); invoice.amount_paid = 9900;
    clearCookies(); const before = calls; assert.equal((await request()).status, 401); assert.equal(calls, before);
    setCookie(SESSION_COOKIE, token);
    stripe.checkout.sessions.retrieve = (async () => { throw new Error("unavailable"); }) as unknown as typeof stripe.checkout.sessions.retrieve;
    assert.equal((await request()).status, 503);
    assert.deepEqual((await readProductData()).orders.find((item: any) => item.id === order.id), order);
  } finally { await stop(); await restore(); }
});
