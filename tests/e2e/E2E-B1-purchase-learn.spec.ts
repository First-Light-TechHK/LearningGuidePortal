import { expect, test } from "playwright/test";

const PASSWORD = "Passw0rd!123";
const PLAN_ID = "epicureanism-pc-6";
const COURSE_ID = "epicureanism";
const LESSON_ID = "pleasure-and-the-good-life";
const CONSENTS = { renewal: true, terms: true, refund: true };

test.skip(Boolean(process.env.CI), "demo trial/purchase is local-only; Actions stay on next start + stripe");

test.describe.configure({ mode: "serial" });

function freshEmail(caseId: string) {
  return `e2e-${caseId}-${Date.now()}@example.com`;
}

test.describe("E2E-B1-004", () => {
  test("register with verification off creates a session; login works; returnTo drop is design", async ({ request }) => {
    const email = freshEmail("004");
    const check = await request.post("/api/auth/check-email", { data: { email } });
    expect(check.status()).toBe(200);
    const checkBody = await check.json();
    expect(checkBody.ok).toBeTruthy();
    expect("exists" in checkBody).toBe(false);

    const registered = await request.post("/api/auth/register", {
      data: { email, password: PASSWORD, nickname: "E2E User", locale: "en-GB" },
    });
    expect(registered.status()).toBe(200);
    const registeredBody = await registered.json();
    expect(registeredBody.ok).toBeTruthy();
    expect(registeredBody.data?.verificationRequired ?? registeredBody.verificationRequired).not.toBe(true);

    const me = await request.get("/api/auth/me");
    expect(me.status()).toBe(200);
    expect((await me.json()).user?.email).toBe(email);

    const loggedOut = await request.post("/api/auth/logout");
    expect(loggedOut.status()).toBe(200);
    expect((await (await request.get("/api/auth/me")).json()).user).toBeNull();

    const sessionLogin = await request.post("/api/auth/login", {
      data: { email, password: PASSWORD, rememberMe: false },
    });
    expect(sessionLogin.status()).toBe(200);
    expect((await sessionLogin.json()).ok).toBeTruthy();
    expect((await (await request.get("/api/auth/me")).json()).user?.email).toBe(email);

    await request.post("/api/auth/logout");
    const remembered = await request.post("/api/auth/login", {
      data: { email, password: PASSWORD, rememberMe: true },
    });
    expect(remembered.status()).toBe(200);
    const setCookie = remembered.headers()["set-cookie"] || "";
    expect(setCookie).toMatch(/learning_guide_session/i);
    expect(setCookie).toMatch(/max-age=/i);
  });
});

test.describe("E2E-B1-005", () => {
  test("trial quote, missing consents 400, cancel grants nothing, complete grants entitlement with empty cards", async ({ request }) => {
    const email = freshEmail("005");
    const registered = await request.post("/api/auth/register", {
      data: { email, password: PASSWORD, nickname: "E2E User", locale: "en-GB" },
    });
    expect(registered.status()).toBe(200);

    const quote = await request.post("/api/subscription/quote", { data: { planId: PLAN_ID, kind: "trial" } });
    expect(quote.status()).toBe(200);
    const quoteBody = await quote.json();
    expect(quoteBody.quote?.kind).toBe("trial");
    const quoteId = quoteBody.quote.id;

    const missing = await request.post("/api/trial", { data: { quoteId, locale: "en-GB" } });
    expect(missing.status()).toBe(400);

    const checkout = await request.post("/api/trial", { data: { quoteId, locale: "en-GB", consents: CONSENTS } });
    expect(checkout.status()).toBe(200);
    const checkoutBody = await checkout.json();
    expect(checkoutBody.order?.status).toBe("pending");
    expect(checkoutBody.checkoutUrl).toContain("/portal/payment/checkout");

    const canceled = await request.post("/api/purchase/demo/confirm", {
      data: { orderId: checkoutBody.order.id, action: "cancel" },
    });
    expect(canceled.status()).toBe(200);
    expect((await canceled.json()).order?.status).toBe("canceled");
    const afterCancel = await (await request.get("/api/my-learning")).json();
    expect(afterCancel.overview.entitlements).toHaveLength(0);

    const secondQuote = await request.post("/api/subscription/quote", { data: { planId: PLAN_ID, kind: "trial" } });
    const second = await request.post("/api/trial", {
      data: { quoteId: (await secondQuote.json()).quote.id, locale: "en-GB", consents: CONSENTS },
    });
    expect(second.status()).toBe(200);
    const completed = await request.post("/api/purchase/demo/confirm", {
      data: { orderId: (await second.json()).order.id, action: "complete" },
    });
    expect(completed.status()).toBe(200);
    expect((await completed.json()).order?.status).toBe("paid");

    const learning = await (await request.get("/api/my-learning")).json();
    expect(learning.overview.entitlements).toHaveLength(1);
    expect(learning.overview.courses).toHaveLength(0);
  });
});

test.describe("E2E-B1-006", () => {
  test("purchase complete replaces trial; receipt HTML is 200", async ({ request }) => {
    const email = freshEmail("006");
    expect((await request.post("/api/auth/register", {
      data: { email, password: PASSWORD, nickname: "E2E User", locale: "en-GB" },
    })).status()).toBe(200);

    const trialQuote = await request.post("/api/subscription/quote", { data: { planId: PLAN_ID, kind: "trial" } });
    const trial = await request.post("/api/trial", {
      data: { quoteId: (await trialQuote.json()).quote.id, locale: "en-GB", consents: CONSENTS },
    });
    await request.post("/api/purchase/demo/confirm", {
      data: { orderId: (await trial.json()).order.id, action: "complete" },
    });

    const quote = await request.post("/api/purchase/quote", { data: { planId: PLAN_ID, kind: "purchase" } });
    expect(quote.status()).toBe(200);
    const quoteBody = await quote.json();
    expect(quoteBody.quote?.kind).toBe("purchase");

    const missing = await request.post("/api/purchase/checkout", {
      data: { quoteId: quoteBody.quote.id, locale: "en-GB" },
    });
    expect(missing.status()).toBe(400);

    const purchaseQuote = await request.post("/api/purchase/quote", { data: { planId: PLAN_ID, kind: "purchase" } });
    const purchaseQuoteBody = await purchaseQuote.json();
    const checkout = await request.post("/api/purchase/checkout", {
      data: { quoteId: purchaseQuoteBody.quote.id, locale: "en-GB", consents: CONSENTS },
    });
    expect(checkout.status()).toBe(200);
    const checkoutBody = await checkout.json();
    expect(checkoutBody.order?.status).toBe("pending");
    const orderId = checkoutBody.order.id;

    const completed = await request.post("/api/purchase/demo/confirm", {
      data: { orderId, action: "complete" },
    });
    expect(completed.status()).toBe(200);
    expect((await completed.json()).order?.status).toBe("paid");

    const receipt = await request.get(`/api/my-learning/orders/${encodeURIComponent(orderId)}/receipt`);
    expect(receipt.status()).toBe(200);
    expect(receipt.headers()["content-type"] || "").toContain("text/html");

    const learning = await (await request.get("/api/my-learning")).json();
    expect(learning.overview.entitlements[0]?.source).toBe("purchase");
  });
});

test.describe("E2E-B1-007", () => {
  test("LEARN-02: purchased entitlement exists but course cards stay empty until study/events", async ({ request }) => {
    const email = freshEmail("007");
    expect((await request.post("/api/auth/register", {
      data: { email, password: PASSWORD, nickname: "E2E User", locale: "en-GB" },
    })).status()).toBe(200);

    const trialQuote = await request.post("/api/subscription/quote", { data: { planId: PLAN_ID, kind: "trial" } });
    const trial = await request.post("/api/trial", {
      data: { quoteId: (await trialQuote.json()).quote.id, locale: "en-GB", consents: CONSENTS },
    });
    await request.post("/api/purchase/demo/confirm", {
      data: { orderId: (await trial.json()).order.id, action: "complete" },
    });
    const purchaseQuote = await request.post("/api/purchase/quote", { data: { planId: PLAN_ID, kind: "purchase" } });
    const checkout = await request.post("/api/purchase/checkout", {
      data: { quoteId: (await purchaseQuote.json()).quote.id, locale: "en-GB", consents: CONSENTS },
    });
    await request.post("/api/purchase/demo/confirm", {
      data: { orderId: (await checkout.json()).order.id, action: "complete" },
    });

    const learning = await (await request.get("/api/my-learning")).json();
    expect(learning.overview.entitlements.length).toBeGreaterThan(0);
    expect(learning.overview.courses).toHaveLength(0);
  });
});

test.describe("E2E-B1-008", () => {
  test("study/events after purchase creates a course card", async ({ request }) => {
    const email = freshEmail("008");
    expect((await request.post("/api/auth/register", {
      data: { email, password: PASSWORD, nickname: "E2E User", locale: "en-GB" },
    })).status()).toBe(200);

    const trialQuote = await request.post("/api/subscription/quote", { data: { planId: PLAN_ID, kind: "trial" } });
    const trial = await request.post("/api/trial", {
      data: { quoteId: (await trialQuote.json()).quote.id, locale: "en-GB", consents: CONSENTS },
    });
    await request.post("/api/purchase/demo/confirm", {
      data: { orderId: (await trial.json()).order.id, action: "complete" },
    });
    const purchaseQuote = await request.post("/api/purchase/quote", { data: { planId: PLAN_ID, kind: "purchase" } });
    const checkout = await request.post("/api/purchase/checkout", {
      data: { quoteId: (await purchaseQuote.json()).quote.id, locale: "en-GB", consents: CONSENTS },
    });
    await request.post("/api/purchase/demo/confirm", {
      data: { orderId: (await checkout.json()).order.id, action: "complete" },
    });

    const event = await request.post("/api/study/events", {
      data: {
        courseId: COURSE_ID,
        lessonId: LESSON_ID,
        event: "complete",
        seconds: 1500,
        clientEventId: `complete-${Date.now()}`,
      },
    });
    expect(event.status()).toBe(200);

    const learning = await (await request.get("/api/my-learning")).json();
    expect(learning.overview.courses[0]?.courseId).toBe(COURSE_ID);
    expect((await request.get(`/en-GB/account/learn/${COURSE_ID}`)).status()).toBe(200);
  });
});
