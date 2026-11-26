import assert from "node:assert/strict";
import { test } from "node:test";
import { renewalFailedNotificationParams } from "../../services/productStore";
import { renderTemplate } from "../../services/notifications/render";
import { notificationTemplate } from "../../services/notifications/templates";
import { renderNotificationEmail } from "../../services/notifications/email";
import type { ProductData, ProductPlan, ProductSubscription, ProductUser } from "../../services/productStore";

const GRACE_END = "2026-11-29T02:00:00.000Z";

const plan: ProductPlan = {
  id: "everything-pc-6",
  courseId: "*",
  name: "Everything · PC · 6 months",
  scope: "everything",
  scopeId: "*",
  termMonths: 6,
  device: "pc",
  amountMinor: 9900,
  currency: "usd",
} as ProductPlan;

const subscription: ProductSubscription = {
  id: "subscription_1",
  userId: "user_1",
  planId: plan.id,
  courseId: "*",
  state: "grace",
  source: "purchase",
  validFrom: "2026-05-26T02:00:00.000Z",
  validTo: GRACE_END,
  cancelAtPeriodEnd: false,
  graceEndsAt: GRACE_END,
} as ProductSubscription;

const user = { id: "user_1", email: "learner@example.test", nickname: "QQQQ", locale: "zh-CN", status: "active" } as ProductUser;
const data = { users: [user], plans: [plan], courses: [] } as unknown as ProductData;

test("a failed renewal carries every variable the notification copy needs", () => {
  const params = renewalFailedNotificationParams(data, subscription, plan, GRACE_END);
  assert.equal(params.user_name, "QQQQ");
  assert.equal(params.plan_name, "Everything ·  6 months");
  assert.equal(params.scope_name, "Everything");
  assert.equal(params.renewal_amount, 9900);
  assert.equal(params.grace_end_date, GRACE_END);
});

test("the failed-renewal email renders in both languages instead of failing as missing data", () => {
  const params = renewalFailedNotificationParams(data, subscription, plan, GRACE_END);
  for (const locale of ["zh-CN", "en-GB"] as const) {
    const mail = renderNotificationEmail({
      templateId: "SUB_RENEWAL_FAILED",
      locale,
      params,
      appUrl: "https://sit.ilovelearningguide.test",
      now: "2026-11-26T02:45:00.000Z",
    });
    assert.ok(mail.subject.trim().length > 0, `${locale}: subject renders`);
    assert.ok(mail.text.includes("2026"), `${locale}: the grace date renders`);
    assert.ok(mail.link?.endsWith("/my-learning/subscription"), `${locale}: the button links to My Subscription`);
    assert.ok(!/\{\{/.test(mail.text), `${locale}: no placeholder is left behind`);
  }
});

test("the in-app message drops the name but still renders for a learner without a nickname", () => {
  const anonymous = { ...user, nickname: "" } as ProductUser;
  const params = renewalFailedNotificationParams({ ...data, users: [anonymous] } as unknown as ProductData, subscription, plan, GRACE_END);
  assert.equal(params.user_name, "there");
  const rendered = renderTemplate(notificationTemplate("SUB_RENEWAL_FAILED"), {
    locale: "zh-CN",
    channel: "in_app",
    params,
    now: "2026-11-26T02:45:00.000Z",
  });
  assert.equal(rendered.title, "续费支付失败");
  assert.ok(!rendered.body.includes("{{"));
});

test("the invoice amount wins over the plan price when the webhook reports one", () => {
  const params = renewalFailedNotificationParams(data, subscription, plan, GRACE_END, 10400);
  assert.equal(params.renewal_amount, 10400);
  const fallback = renewalFailedNotificationParams(data, subscription, plan, GRACE_END, undefined);
  assert.equal(fallback.renewal_amount, 9900);
});
