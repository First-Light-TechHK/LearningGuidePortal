const base = (process.env.SMOKE_BASE_URL || "http://127.0.0.1:3011").replace(/\/$/, "");
let cookie = "";

async function request(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (cookie) headers.cookie = cookie;
  const response = await fetch(`${base}${path}`, { ...options, headers, redirect: "manual" });
  const setCookie = response.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  const text = await response.text();
  let body = text;
  try { body = JSON.parse(text); } catch { /* text response */ }
  return { status: response.status, body, contentType: response.headers.get("content-type"), location: response.headers.get("location") };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const stamp = Date.now();
const email = `smoke-${stamp}@example.com`;
const json = { "content-type": "application/json" };
let result;

for (const path of ["/api/health", "/api/health/config", "/en-GB/portal", "/zh-CN/portal", "/en-GB/portal/courses", "/en-GB/portal/faq", "/en-GB/help", "/zh-CN/help", "/en-GB/contact", "/zh-CN/contact", "/en-GB/pricing"]) {
  assert((await request(path)).status === 200, `${path} did not return 200`);
}
result = await request("/api/health/config");
assert(result.body.environment === "DEV" && result.body.storage === "local" && result.body.payment.mode === "demo", "local runtime configuration is not explicit");
result = await request("/api/portal/plans");
const planIds = new Set((result.body.plans || []).map((plan) => plan.id));
assert(result.status === 200 && ["epicureanism-pc-6", "european-humanities-pc-6", "everything-pc-6", "everything-mobile-6"].every((id) => planIds.has(id)), "the four required plan groups are not available");

// Local OAuth must be usable without provider credentials. It creates the same
// account/session records as the real callback, then redirects to the product.
result = await request(`/api/auth/google?locale=en-GB&returnTo=${encodeURIComponent("/en-GB/account/my-learning")}`);
assert(result.status === 307 && result.location?.endsWith("/en-GB/account/my-learning") && new URL(result.location, base).origin === new URL(base).origin, "local Google sign-in did not redirect on the current host");
result = await request("/api/auth/me");
assert(result.status === 200 && result.body.user?.email === "google.local@example.test", "local Google session failed");
result = await request("/api/auth/logout", { method: "POST" });
assert(result.status === 200 && result.body.ok, "logout after local Google sign-in failed");

result = await request(`/api/auth/wechat?locale=en-GB&returnTo=${encodeURIComponent("/en-GB/account/my-learning")}`);
assert(result.status === 307 && result.location?.endsWith("/en-GB/account/my-learning") && new URL(result.location, base).origin === new URL(base).origin, "local WeChat sign-in did not redirect on the current host");
result = await request("/api/auth/me");
assert(result.status === 200 && Boolean(result.body.user?.id) && result.body.user.email === null, "local WeChat session failed");
result = await request("/api/auth/logout", { method: "POST" });
assert(result.status === 200 && result.body.ok, "logout after local WeChat sign-in failed");

result = await request("/api/auth/check-email", { method: "POST", headers: json, body: JSON.stringify({ email: `new-${stamp}@example.com` }) });
assert(result.status === 200 && result.body.ok === true && result.body.exists === undefined, "email-first auth entry must not disclose whether an email is new");

result = await request("/api/auth/register", { method: "POST", headers: json, body: JSON.stringify({ email, password: "Passw0rd!123", nickname: "Smoke User", locale: "en-GB" }) });
assert(result.status === 200 && result.body.ok, "registration failed");
result = await request("/api/auth/check-email", { method: "POST", headers: json, body: JSON.stringify({ email }) });
assert(result.status === 200 && result.body.ok === true && result.body.exists === undefined, "email-first auth entry must not disclose whether an email already exists");
result = await request("/api/my-learning");
assert(result.status === 200 && result.body.overview.courses.length === 0, "My Learning should be empty before a study record exists");

// Trial follows the same pending -> paid boundary as Stripe. The local checkout
// is deliberately explicit so a failed/cancelled attempt cannot grant access.
const consents = { renewal: true, terms: true, refund: true };
result = await request("/api/subscription/quote", { method: "POST", headers: json, body: JSON.stringify({ planId: "epicureanism-pc-6", kind: "trial" }) });
assert(result.status === 200 && result.body.quote?.kind === "trial", "trial quote failed");
const trialQuoteId = result.body.quote.id;
result = await request("/api/trial", { method: "POST", headers: json, body: JSON.stringify({ quoteId: trialQuoteId, locale: "en-GB" }) });
assert(result.status === 400, "trial checkout accepted missing confirmations");
result = await request("/api/trial", { method: "POST", headers: json, body: JSON.stringify({ quoteId: trialQuoteId, locale: "en-GB", consents }) });
assert(result.status === 200 && result.body.order?.status === "pending" && result.body.checkoutUrl?.includes("/portal/payment/checkout"), "trial did not create a pending local order");
const canceledTrialOrderId = result.body.order.id;
const canceledCheckoutUrl = new URL(result.body.checkoutUrl, base);
assert((await request(canceledCheckoutUrl.pathname + canceledCheckoutUrl.search)).status === 200, "local checkout page did not render for trial");
result = await request("/api/purchase/demo/confirm", { method: "POST", headers: json, body: JSON.stringify({ orderId: canceledTrialOrderId, action: "cancel" }) });
assert(result.status === 200 && result.body.order?.status === "canceled", "trial cancellation failed");
result = await request("/api/my-learning");
assert(result.status === 200 && result.body.overview.entitlements.length === 0, "cancelled trial granted access");

result = await request("/api/subscription/quote", { method: "POST", headers: json, body: JSON.stringify({ planId: "epicureanism-pc-6", kind: "trial" }) });
assert(result.status === 200 && result.body.quote?.kind === "trial", "second trial quote failed");
result = await request("/api/trial", { method: "POST", headers: json, body: JSON.stringify({ quoteId: result.body.quote.id, locale: "en-GB", consents }) });
assert(result.status === 200 && result.body.order?.status === "pending", "second trial attempt did not create a pending order");
const trialOrderId = result.body.order.id;
result = await request("/api/purchase/demo/confirm", { method: "POST", headers: json, body: JSON.stringify({ orderId: trialOrderId, action: "complete" }) });
assert(result.status === 200 && result.body.order?.status === "paid", "trial completion failed");
result = await request("/api/my-learning");
assert(result.status === 200 && result.body.overview.courses.length === 0 && result.body.overview.entitlements.length === 1, "trial entitlement or My Learning start rule failed");

// Purchase is a separate order and subscription. Completing it replaces trial access.
result = await request("/api/purchase/quote", { method: "POST", headers: json, body: JSON.stringify({ planId: "epicureanism-pc-6", kind: "purchase" }) });
assert(result.status === 200 && result.body.quote?.id && result.body.quote?.kind === "purchase", "purchase quote failed");
const purchaseQuoteId = result.body.quote.id;
result = await request("/api/purchase/checkout", { method: "POST", headers: json, body: JSON.stringify({ quoteId: purchaseQuoteId, locale: "en-GB" }) });
assert(result.status === 400, "purchase checkout accepted missing confirmations");
result = await request("/api/purchase/checkout", { method: "POST", headers: json, body: JSON.stringify({ quoteId: purchaseQuoteId, locale: "en-GB", consents }) });
assert(result.status === 200 && result.body.order?.status === "pending" && result.body.checkoutUrl?.includes("/portal/payment/checkout"), "purchase did not create a pending local order");
const purchaseOrderId = result.body.order.id;
result = await request("/api/purchase/demo/confirm", { method: "POST", headers: json, body: JSON.stringify({ orderId: purchaseOrderId, action: "complete" }) });
assert(result.status === 200 && result.body.order?.status === "paid", "purchase completion failed");
result = await request(`/api/my-learning/orders/${encodeURIComponent(purchaseOrderId)}/receipt`);
assert(result.status === 200 && result.contentType?.includes("text/html"), "local receipt failed");
result = await request("/api/my-learning");
assert(result.status === 200 && result.body.overview.entitlements[0]?.source === "purchase", "purchase did not replace trial access");
const subscriptionId = result.body.overview.subscriptions.find((subscription) => subscription.source === "purchase")?.id;
assert(subscriptionId, "purchase subscription was not created");
result = await request("/api/subscription", { method: "POST", headers: json, body: JSON.stringify({ subscriptionId, action: "cancel", reasonCode: "too_expensive" }) });
assert(result.status === 200 && result.body.subscription?.state === "cancel_at_period_end", "subscription cancellation failed");
result = await request("/api/subscription", { method: "POST", headers: json, body: JSON.stringify({ subscriptionId, action: "resume" }) });
assert(result.status === 400, "paid auto-renewal must not be restored after cancellation (SUB-FR-012)");

// A paid category subscription can be upgraded to the matching PC Everything
// term. The actual Category payment is credited and its expiry is retained.
result = await request("/api/purchase/quote", { method: "POST", headers: json, body: JSON.stringify({ planId: "european-humanities-pc-6", kind: "purchase" }) });
assert(result.status === 200 && result.body.quote?.kind === "purchase", "category purchase quote failed");
result = await request("/api/purchase/checkout", { method: "POST", headers: json, body: JSON.stringify({ quoteId: result.body.quote.id, locale: "en-GB", consents }) });
assert(result.status === 200 && result.body.order?.status === "pending", "category purchase did not create a pending order");
const categoryOrderId = result.body.order.id;
result = await request("/api/purchase/demo/confirm", { method: "POST", headers: json, body: JSON.stringify({ orderId: categoryOrderId, action: "complete" }) });
assert(result.status === 200 && result.body.order?.status === "paid", "category purchase completion failed");
result = await request("/api/my-learning");
const categorySubscriptionId = result.body.overview.subscriptions.find((subscription) => subscription.scope === "category" && subscription.state === "active")?.id;
assert(categorySubscriptionId, "category subscription was not created");
result = await request("/api/subscription/quote", { method: "POST", headers: json, body: JSON.stringify({ kind: "upgrade", subscriptionId: categorySubscriptionId }) });
assert(result.status === 200 && result.body.quote?.kind === "upgrade" && typeof result.body.quote?.creditMinor === "number", "upgrade quote did not calculate credit");
result = await request("/api/purchase/checkout", { method: "POST", headers: json, body: JSON.stringify({ quoteId: result.body.quote.id, locale: "en-GB", consents }) });
assert(result.status === 200 && result.body.order?.kind === "upgrade", "upgrade checkout did not create an upgrade order");
const upgradeOrderId = result.body.order.id;
result = await request("/api/purchase/demo/confirm", { method: "POST", headers: json, body: JSON.stringify({ orderId: upgradeOrderId, action: "complete" }) });
assert(result.status === 200 && result.body.order?.status === "paid", "upgrade completion failed");
result = await request("/api/my-learning");
assert(result.status === 200 && result.body.overview.entitlements.some((entitlement) => entitlement.scope === "everything"), "upgrade did not replace category access with PC Everything access");

result = await request("/api/study/events", { method: "POST", headers: json, body: JSON.stringify({ courseId: "epicureanism", lessonId: "pleasure-and-the-good-life", event: "complete", seconds: 1500, clientEventId: `complete-${stamp}` }) });
assert(result.status === 200 && result.body.record.progress === 50, "course progress must be unique opened Learning Points (1/2 = 50), not lesson seconds");
result = await request("/api/my-learning");
assert(result.status === 200 && result.body.overview.courses[0]?.courseId === "epicureanism", "My Learning failed");
assert(result.body.overview.notificationsPlaceholder === true && result.body.overview.notifications.length === 0, "My Learning notifications must stay a placeholder");
result = await request("/api/my-learning/notifications");
assert(result.status === 200 && result.body.placeholder === true && result.body.unreadCount === 0, "notification inbox must not be exposed");
for (const path of ["/en-GB/account/my-learning", "/en-GB/account/my-learning/subscription", "/en-GB/account/my-learning/notifications", "/en-GB/account/my-learning/settings", "/en-GB/account/my-learning/help", "/en-GB/account/learn/epicureanism", "/en-GB/privacy-policy", "/en-GB/terms-of-service", "/en-GB/cookie-policy"]) {
  assert((await request(path)).status === 200, `${path} did not return 200`);
}
const avatarForm = new FormData();
avatarForm.set("file", new Blob([Buffer.from("smoke-avatar")], { type: "image/png" }), "avatar.png");
result = await request("/api/my-learning/avatar", { method: "POST", body: avatarForm });
assert(result.status === 200 && result.body.ok, "profile image upload failed");
result = await request("/api/my-learning/avatar");
assert(result.status === 200 && result.contentType === "image/png", "profile image fetch failed");
result = await request("/api/my-learning/avatar", { method: "DELETE" });
assert(result.status === 200 && result.body.ok, "profile image removal failed");
console.log(JSON.stringify({ ok: true, base, checked: "public Portal, bilingual pages, registration, trial, Study, My Learning, notifications, profile image" }));
