import assert from "node:assert/strict";
import { test } from "node:test";
import { isolate } from "../io/harness";

test("Google activation removes unproven passwords, sessions and pre-activation recovery tokens", async () => {
  const { restore } = await isolate("google-pre-registration-");
  try {
    const store = await import("../../services/productStore");
    const user = await store.registerUser({ email: "victim@example.test", password: "attacker-password" });
    const verification = await store.issueEmailVerificationToken(user.id);
    const reset = await store.issuePasswordResetToken(user.id);
    const session = await store.createSession(user.id);
    await store.getOrCreateSocialUser({ provider: "google", providerSubject: "victim-google", email: user.email });
    await assert.rejects(store.authenticateUser(user.email!, "attacker-password"), /incorrect/);
    assert.equal(await store.getUserBySessionToken(session.token), null);
    await assert.rejects(store.verifyEmailToken(verification), /invalid/);
    await assert.rejects(store.resetPassword(reset, "attacker-new-password"), /invalid/);
    const fresh = await store.issuePasswordResetToken(user.id);
    await store.resetPassword(fresh, "owner-password");
    await store.getOrCreateSocialUser({ provider: "google", providerSubject: "victim-google", email: user.email });
    assert.equal((await store.authenticateUser(user.email!, "owner-password")).id, user.id);
    const login = await import("../../app/api/auth/login/route");
    const response = await login.POST(new Request("http://localhost/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: user.email, password: "attacker-password" }) }));
    assert.equal(response.status, 401);
  } finally { await restore(); }
});

test("legacy authoring APIs reject learner-host sessions before parsing any mutation", async () => {
  const { restore } = await isolate("legacy-authorisation-");
  try {
    const store = await import("../../services/productStore");
    const auth = await import("../../services/productAuth");
    const courses = await import("../../app/api/courses/route");
    const wiki = await import("../../app/api/wiki/publish/route");
    const { NextRequest } = await import("next/server");
    for (const role of ["student", "operator"] as const) {
      const user = await store.registerUser({ email: `${role}@authorisation.test`, password: "password1", role });
      await store.verifyEmailToken(await store.issueEmailVerificationToken(user.id));
      const { token } = await store.createSession(user.id);
      for (const cookie of [auth.SESSION_COOKIE, auth.ADMIN_SESSION_COOKIE]) {
        const headers = { host: "www.ilovelearningguide.com", cookie: `${cookie}=${token}` };
        const denied = await courses.POST(new Request("https://www.ilovelearningguide.com/api/courses", { method: "POST", headers, body: "invalid json" }));
        assert.equal(denied.status, cookie === auth.SESSION_COOKIE ? 403 : 401);
        const publish = await wiki.POST(new NextRequest("https://www.ilovelearningguide.com/api/wiki/publish", { method: "POST", headers, body: "invalid json" }));
        assert.equal(publish.status, denied.status);
      }
    }
    assert.equal((await courses.GET(new Request("https://www.ilovelearningguide.com/api/courses"))).status, 401);
  } finally { await restore(); }
});

test("old subscription cancellation and refund cannot revoke a repurchase, including legacy grants", async () => {
  const { restore } = await isolate("subscription-identity-");
  try {
    const store = await import("../../services/productStore");
    const user = await store.registerUser({ email: "repurchase@example.test", password: "password1" });
    const iso = (days: number) => new Date(Date.now() + days * 86400000).toISOString();
    const old = await store.createPendingStripeTrialOrder(user.id, "epicureanism-pc-6");
    await store.applyVerifiedStripeEvent({ id: "old-paid", type: "checkout.session.completed", action: "checkout", orderId: old.order.id, sessionId: "cs_old", subscriptionId: "sub_old", trial: false, periodStart: iso(-200), periodEnd: iso(-20), subscriptionStatus: "active" });
    await store.getLearningOverview(user.id);
    await store.editProductData(data => { data.orders.find(order => order.id === old.order.id)!.kind = "purchase"; });
    const fresh = await store.createPendingStripeTrialOrder(user.id, "epicureanism-pc-6");
    await store.applyVerifiedStripeEvent({ id: "new-paid", type: "checkout.session.completed", action: "checkout", orderId: fresh.order.id, sessionId: "cs_new", subscriptionId: "sub_new", trial: false, periodStart: iso(-1), periodEnd: iso(180), subscriptionStatus: "active" });
    // Simulate existing deployments before the optional JSON association was added.
    await store.editProductData(data => { data.entitlements.forEach(grant => { delete grant.subscriptionId; }); });
    assert.equal((await store.checkEntitlement(user.id, "epicureanism")).allowed, true);
    const before = (await store.readProductData()).entitlements.find(grant => grant.state === "active")!;
    assert.ok(before.subscriptionId);
    await store.applyVerifiedStripeEvent({ id: "old-canceled", type: "customer.subscription.deleted", action: "subscription", subscriptionId: "sub_old", status: "canceled" });
    assert.equal((await store.checkEntitlement(user.id, "epicureanism")).allowed, true);
    await store.refundOrder(old.order.id, "operator");
    assert.equal((await store.checkEntitlement(user.id, "epicureanism")).allowed, true);
    assert.deepEqual((await store.readProductData()).entitlements.find(grant => grant.id === before.id), before);
    await store.refundOrder(fresh.order.id, "operator");
    assert.equal((await store.checkEntitlement(user.id, "epicureanism")).allowed, false);
  } finally { await restore(); }
});
