import assert from "node:assert/strict";
import { test } from "node:test";
import { stop } from "esbuild";
import { isolate, setCookie, clearCookies, SESSION_COOKIE } from "./harness";
import { readProductData, writeProductData, verifiedUser } from "../unit/helpers/my-learning";
import { canViewSubscriptionReceipt } from "../../contracts/subscription-records";

test("paid upgrade receipts redirect to verified Stripe destinations with ownership/status gates",async()=>{
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
    stripe.paymentIntents.retrieve=(async (id: string)=>{calls++;assert.equal(id,"pi_upgrade");if(mode==="error")throw new Error("provider unavailable");return {id:"pi_upgrade",amount_received:mode==="amount"?1:6000,currency:mode==="currency"?"eur":"usd",status:mode==="pending"?"processing":"succeeded",latest_charge:mode==="no-charge"?null:mode==="string"?"ch_upgrade":{paid:mode!=="unpaid-charge",amount:mode==="charge-amount"?1:6000,currency:mode==="charge-currency"?"eur":"usd",refunded:mode==="refunded",receipt_url:mode.startsWith("url:")?mode.slice(4):mode==="missing"?null:"https://pay.stripe.com/receipts/upgrade"}};}) as unknown as typeof stripe.paymentIntents.retrieve;
    stripe.charges.retrieve=(async (id: string)=>{assert.equal(id,"ch_upgrade");return {paid:true,amount:6000,currency:"usd",created:1792022400,receipt_url:"https://pay.stripe.com/receipts/upgrade"};}) as unknown as typeof stripe.charges.retrieve;
    stripe.invoices.retrieve=(async(id:string)=>{assert.ok(["in_paid","in_native-upgrade","in_renewal"].includes(id));return {id:mode==="invoice-id"?"in_other":id,status:mode==="invoice-unpaid"?"open":"paid",amount_paid:mode==="invoice-amount"?1:6000,currency:mode==="invoice-currency"?"eur":"usd",parent:{subscription_details:{subscription:mode==="invoice-subscription"?"sub_other":"sub_native"}},metadata:mode==="invoice-user"?{userId:"other"}:mode==="invoice-order"?{orderId:"other"}:{},hosted_invoice_url:mode.startsWith("url:")?mode.slice(4):mode==="missing"?null:"https://invoice.stripe.com/receipt?token=original"};}) as unknown as typeof stripe.invoices.retrieve;
    assert.equal(canViewSubscriptionReceipt(order),true);
    assert.deepEqual(await stripeOrderReceipt(order),{kind:"charge",url:"https://pay.stripe.com/receipts/upgrade"});
    mode="string";assert.equal((await stripeOrderReceipt(order))?.url,"https://pay.stripe.com/receipts/upgrade");
    mode="invoice";assert.deepEqual(await stripeOrderReceipt({...order,stripeInvoiceId:"in_paid"}),{kind:"invoice",url:"https://invoice.stripe.com/receipt?token=original"});
    const route=await import("../../app/api/my-learning/orders/[orderId]/receipt/route");
    const request=(orderId=order.id)=>route.GET(new Request("http://localhost/receipt"),{params:Promise.resolve({orderId})});
    mode="expanded";const response=await request();assert.equal(response.status,302);assert.equal(response.headers.get("location"),"https://pay.stripe.com/receipts/upgrade");assert.equal(response.headers.get("cache-control"),"private, no-store");assert.equal(response.headers.get("vary"),"Cookie");assert.equal(response.headers.get("referrer-policy"),"no-referrer");assert.equal(await response.text(),"");
    for(const missing of ["missing","no-charge","unpaid-charge","pending","amount","currency","charge-amount","charge-currency","refunded"]){mode=missing;assert.equal((await request()).status,404);}
    for(const url of ["https://example.test/receipt","http://pay.stripe.com/receipt","https://pay.stripe.com.evil.test/receipt","https://user:pass@pay.stripe.com/receipt","https://pay.stripe.com:8443/receipt","javascript:alert(1)"]){mode=`url:${url}`;const denied=await request();assert.equal(denied.status,404);assert.equal(denied.headers.get("location"),null);}
    // Native upgrades and recurring renewals use their pinned Invoice, even when
    // a subscription has a newer invoice by the time history is opened.
    const invoices=await readProductData();
    for(const [id,kind] of [["native-upgrade","upgrade"],["renewal","purchase"]] as const) invoices.orders.push({...order,id,kind,quoteId:`quote-${id}`,stripeInvoiceId:`in_${id}`,stripePaymentIntentId:null,stripeSubscriptionId:"sub_native"});
    await writeProductData(invoices);
    for(const id of ["native-upgrade","renewal"]){
      mode="invoice";const redirect=await request(id);assert.equal(redirect.status,302);assert.equal(redirect.headers.get("location"),"https://invoice.stripe.com/receipt?token=original");
      for(const invalid of ["missing","invoice-id","invoice-unpaid","invoice-amount","invoice-currency","invoice-subscription","invoice-user","invoice-order"]){mode=invalid;assert.equal((await request(id)).status,404);}
      for(const url of ["https://example.test/invoice","http://invoice.stripe.com/receipt","https://invoice.stripe.com.evil.test/i/test","https://user:pass@invoice.stripe.com/i/test","https://invoice.stripe.com:8443/i/test","javascript:alert(1)"]){mode=`url:${url}`;assert.equal((await request(id)).status,404);}
    }
    mode="error";assert.equal((await request()).status,503);
    const callsBefore=calls;
    clearCookies();assert.equal((await request()).status,401);
    const other=await verifiedUser(store,"other-receipt@example.test");setCookie(SESSION_COOKIE,(await store.createSession(other.id)).token);assert.equal((await request()).status,404);
    setCookie(SESSION_COOKIE,session.token);
    for(const status of ["pending","failed","canceled","refunded"]){const current=await readProductData();current.orders.find((item:any)=>item.id===order.id).status=status;await writeProductData(current);assert.equal((await request()).status,404);assert.equal(canViewSubscriptionReceipt({...order,status}),false);}
    const trial=await readProductData();Object.assign(trial.orders.find((item:any)=>item.id===order.id),{status:"paid",kind:"trial_activation"});await writeProductData(trial);assert.equal((await request()).status,404);
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
    const session = { id: "cs_original", status: "complete", payment_status: "paid", amount_total: 9900, currency: "usd", subscription: "sub_original", invoice: "in_original" as string | null, payment_intent: null as string | null, metadata: { orderId: order.id, userId: user.id } };
    const invoice = { id: "in_original", status: "paid", amount_paid: 9900, currency: "usd", parent:{subscription_details:{subscription:"sub_original"}}, status_transitions:{paid_at:1791690609}, hosted_invoice_url: "https://invoice.stripe.com/original" };
    let calls = 0;
    stripe.checkout.sessions.retrieve = (async (id: string) => { calls++; assert.equal(id, "cs_original"); return session; }) as unknown as typeof stripe.checkout.sessions.retrieve;
    stripe.invoices.retrieve = (async (id: string) => { assert.equal(id, "in_original"); return invoice; }) as unknown as typeof stripe.invoices.retrieve;
    assert.equal(canViewSubscriptionReceipt(order), true);
    assert.deepEqual(await stripeOrderReceipt(order),{kind:"invoice",url:invoice.hosted_invoice_url});
    const route = await import("../../app/api/my-learning/orders/[orderId]/receipt/route");
    const request = () => route.GET(new Request("http://localhost/receipt"), { params: Promise.resolve({ orderId: order.id }) });
    const response=await request();assert.equal(response.status,302);assert.equal(response.headers.get("location"),invoice.hosted_invoice_url);assert.equal(await response.text(),"");
    for (const invalid of [{ status: "open" }, { payment_status: "unpaid" }, { amount_total: 3900 }, { currency: "eur" }, { subscription: "sub_other" }, { metadata: { orderId: "other", userId: user.id } }, { metadata: { orderId: order.id, userId: "other" } }]) {
      const original = { ...session }; Object.assign(session, invalid);
      assert.equal((await request()).status, 404); Object.assign(session, original);
    }
    invoice.status = "open"; assert.equal((await request()).status, 404); invoice.status = "paid";
    invoice.parent.subscription_details.subscription="sub_other";assert.equal((await request()).status,404);invoice.parent.subscription_details.subscription="sub_original";
    invoice.currency="eur";assert.equal((await request()).status,404);invoice.currency="usd";
    invoice.amount_paid = 1; assert.equal((await request()).status, 404); invoice.amount_paid = 9900;
    invoice.hosted_invoice_url = ""; assert.equal((await request()).status, 404); invoice.hosted_invoice_url = "https://invoice.stripe.com/original";
    stripe.checkout.sessions.retrieve = (async () => ({...session,invoice})) as unknown as typeof stripe.checkout.sessions.retrieve;
    assert.equal((await request()).headers.get("location"),invoice.hosted_invoice_url,"expanded original Invoice remains supported");
    stripe.checkout.sessions.retrieve = (async () => session) as unknown as typeof stripe.checkout.sessions.retrieve;
    session.invoice=null;session.payment_intent="pi_original";
    stripe.paymentIntents.retrieve=(async(id:string)=>{assert.equal(id,"pi_original");return{id,status:"succeeded",amount_received:9900,currency:"usd",latest_charge:{paid:true,refunded:false,amount:9900,currency:"usd",receipt_url:"https://pay.stripe.com/receipts/original"}};}) as unknown as typeof stripe.paymentIntents.retrieve;
    assert.equal((await request()).headers.get("location"),"https://pay.stripe.com/receipts/original","Checkout without an Invoice resolves only its original PaymentIntent");
    session.invoice="in_original";session.payment_intent=null;
    clearCookies(); const before = calls; assert.equal((await request()).status, 401); assert.equal(calls, before);
    setCookie(SESSION_COOKIE, token);
    stripe.checkout.sessions.retrieve = (async () => { throw new Error("unavailable"); }) as unknown as typeof stripe.checkout.sessions.retrieve;
    assert.equal((await request()).status, 503);
    assert.deepEqual((await readProductData()).orders.find((item: any) => item.id === order.id), order);
  } finally { await stop(); await restore(); }
});
