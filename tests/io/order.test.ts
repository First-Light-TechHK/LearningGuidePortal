import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import {
  COURSE_PLAN,
  PASSWORD,
  callRoute,
  clearCookies,
  isolate,
  jsonRequest,
  takeSetCookie,
  uniqueEmail
} from "./harness";

const CONSENTS = { renewal: true, terms: true, refund: true };

let restore: () => Promise<void>;
let register: typeof import("../../app/api/auth/register/route");
let quote: typeof import("../../app/api/purchase/quote/route");
let checkout: typeof import("../../app/api/purchase/checkout/route");
let confirm: typeof import("../../app/api/purchase/demo/confirm/route");
let orders: typeof import("../../app/api/backoffice/orders/route");

before(async () => {
  restore = (await isolate("lg-io-order-")).restore;
  register = await import("../../app/api/auth/register/route");
  quote = await import("../../app/api/purchase/quote/route");
  checkout = await import("../../app/api/purchase/checkout/route");
  confirm = await import("../../app/api/purchase/demo/confirm/route");
  orders = await import("../../app/api/backoffice/orders/route");
});

after(async () => {
  await restore();
});

async function signIn(label: string) {
  clearCookies();
  const email = uniqueEmail(label);
  const response = await callRoute(register.POST, jsonRequest("POST", "http://localhost/api/auth/register", {
    email,
    password: PASSWORD,
    nickname: "IO Student",
    locale: "en-GB"
  }));
  takeSetCookie(response);
  assert.equal(response.status, 200);
  return email;
}

async function purchase() {
  const quoted = await callRoute(quote.POST, jsonRequest("POST", "http://localhost/api/purchase/quote", { planId: COURSE_PLAN }));
  const quoteBody = await quoted.json();
  assert.equal(quoted.status, 200);
  const pending = await callRoute(checkout.POST, jsonRequest("POST", "http://localhost/api/purchase/checkout", {
    quoteId: quoteBody.quote.id,
    locale: "en-GB",
    consents: CONSENTS
  }));
  const pendingBody = await pending.json();
  assert.equal(pending.status, 200);
  const paid = await callRoute(confirm.POST, jsonRequest("POST", "http://localhost/api/purchase/demo/confirm", {
    orderId: pendingBody.order.id,
    action: "complete"
  }));
  assert.equal(paid.status, 200);
  return pendingBody.order.id as string;
}

test("AUTH-04 functional: a student session GET /api/backoffice/orders is 403", async () => {
  await signIn("ord-student-list");
  const response = await callRoute(orders.GET, jsonRequest("GET", "http://localhost/api/backoffice/orders"));
  assert.equal(response.status, 403);
});

test("AUTH-04 negative: a student POST refund is 403", async () => {
  await signIn("ord-student-refund");
  const orderId = await purchase();
  const response = await callRoute(orders.POST, jsonRequest("POST", "http://localhost/api/backoffice/orders", {
    orderId,
    action: "refund",
    reason: "student cannot refund"
  }));
  assert.equal(response.status, 403);
});

test("AUTH-04 edge: unauthenticated GET /api/backoffice/orders is 403", async () => {
  clearCookies();
  const response = await callRoute(orders.GET, jsonRequest("GET", "http://localhost/api/backoffice/orders"));
  assert.equal(response.status, 403);
  const body = await response.json();
  assert.equal(body.ok, false);
  assert.match(String(body.error || ""), /Course Manager\/Operator access is required/i);
});

test("ORDER-01 extra: unauthenticated POST refund is 403 and does not grant operator power", async () => {
  clearCookies();
  const response = await callRoute(orders.POST, jsonRequest("POST", "http://localhost/api/backoffice/orders", {
    orderId: "order-missing",
    action: "refund",
    reason: "unauthenticated"
  }));
  assert.equal(response.status, 403);
  const body = await response.json();
  assert.equal(body.ok, false);
});
