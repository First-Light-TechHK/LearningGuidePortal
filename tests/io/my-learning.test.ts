import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import {
  COURSE_ID,
  COURSE_PLAN,
  PASSWORD,
  callRoute,
  clearCookies,
  isolate,
  jsonRequest,
  takeSetCookie,
  uniqueEmail
} from "./harness";
import { PRIVATE_LP, readProductData, writeProductData } from "../unit/helpers/my-learning";

const CONSENTS = { renewal: true, terms: true, refund: true };

let restore: () => Promise<void>;
let register: typeof import("../../app/api/auth/register/route");
let quote: typeof import("../../app/api/purchase/quote/route");
let checkout: typeof import("../../app/api/purchase/checkout/route");
let confirm: typeof import("../../app/api/purchase/demo/confirm/route");
let overview: typeof import("../../app/api/my-learning/overview/route");
let entitlements: typeof import("../../app/api/entitlements/check/route");
let study: typeof import("../../app/api/study/events/route");

before(async () => {
  restore = (await isolate("lg-io-my-learning-")).restore;
  register = await import("../../app/api/auth/register/route");
  quote = await import("../../app/api/purchase/quote/route");
  checkout = await import("../../app/api/purchase/checkout/route");
  confirm = await import("../../app/api/purchase/demo/confirm/route");
  overview = await import("../../app/api/my-learning/overview/route");
  entitlements = await import("../../app/api/entitlements/check/route");
  study = await import("../../app/api/study/events/route");
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
    nickname: "IO Learner",
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

function studyBody(lessonId = PRIVATE_LP) {
  return {
    courseId: COURSE_ID,
    lessonId,
    event: "open" as const,
    seconds: 0,
    clientEventId: `ml-io-${Date.now()}-${Math.random().toString(16).slice(2)}`
  };
}

test("ML-FR-004 signed-out: GET /api/my-learning/overview without a session is 401", async () => {
  clearCookies();
  const response = await callRoute(overview.GET, jsonRequest("GET", "http://localhost/api/my-learning/overview"));
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { ok: false, error: "Sign in is required." });
});

test("AUTH-06 / unauth learning: GET /api/entitlements/check without a session is 401", async () => {
  clearCookies();
  const response = await callRoute(
    entitlements.GET,
    jsonRequest("GET", `http://localhost/api/entitlements/check?courseId=${COURSE_ID}`)
  );
  assert.equal(response.status, 401);
});

test("E2E-B1-001 / unauth learning: POST /api/study/events without a session is 401", async () => {
  clearCookies();
  const response = await callRoute(study.POST, jsonRequest("POST", "http://localhost/api/study/events", studyBody()));
  assert.equal(response.status, 401);
});

test("ML-FR-004 signed-in: after purchase GET /api/my-learning/overview is 200", async () => {
  await signIn("ml-overview");
  await purchase();
  const response = await callRoute(overview.GET, jsonRequest("GET", "http://localhost/api/my-learning/overview"));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.ok(body.user?.id);
});

test("E2E-B1-010 / ML-FR-011 expired entitlement: check is not allowed and locked study/events is 403", async () => {
  await signIn("ml-expired");
  await purchase();
  const mine = await callRoute(overview.GET, jsonRequest("GET", "http://localhost/api/my-learning/overview"));
  const userId = (await mine.json()).user.id as string;
  const data = await readProductData();
  for (const entitlement of data.entitlements) {
    if (entitlement.userId === userId && entitlement.state === "active") {
      entitlement.validTo = "2000-01-01T00:00:00.000Z";
    }
  }
  await writeProductData(data);

  const check = await callRoute(
    entitlements.GET,
    jsonRequest("GET", `http://localhost/api/entitlements/check?courseId=${COURSE_ID}`)
  );
  const checkBody = await check.json();
  assert.equal(check.status, 200);
  assert.equal(checkBody.entitlement?.allowed, false);

  const locked = await callRoute(study.POST, jsonRequest("POST", "http://localhost/api/study/events", studyBody(PRIVATE_LP)));
  const lockedBody = await locked.json();
  assert.equal(locked.status, 403);
  assert.match(String(lockedBody.error || ""), /Course access is required/i);

  const stillOpen = await callRoute(overview.GET, jsonRequest("GET", "http://localhost/api/my-learning/overview"));
  assert.equal(stillOpen.status, 200);
  assert.equal((await stillOpen.json()).ok, true);
});
