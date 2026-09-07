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
assert(result.status === 200 && result.body.user?.email === "wechat.local@example.test", "local WeChat session failed");
result = await request("/api/auth/logout", { method: "POST" });
assert(result.status === 200 && result.body.ok, "logout after local WeChat sign-in failed");

result = await request("/api/auth/register", { method: "POST", headers: json, body: JSON.stringify({ email, password: "Passw0rd!123", nickname: "Smoke User", locale: "en-GB" }) });
assert(result.status === 200 && result.body.ok, "registration failed");
result = await request("/api/my-learning");
assert(result.status === 200 && result.body.overview.courses.length === 0, "My Learning should be empty before a study record exists");

// Trial follows the same pending -> paid boundary as Stripe. The local checkout
// is deliberately explicit so a failed/cancelled attempt cannot grant access.
result = await request("/api/trial", { method: "POST", headers: json, body: JSON.stringify({ courseId: "epicureanism", planId: "epicureanism-pc-6", locale: "en-GB" }) });
assert(result.status === 200 && result.body.order?.status === "pending" && result.body.checkoutUrl?.includes("/portal/payment/checkout"), "trial did not create a pending local order");
const canceledTrialOrderId = result.body.order.id;
const canceledCheckoutUrl = new URL(result.body.checkoutUrl, base);
assert((await request(canceledCheckoutUrl.pathname + canceledCheckoutUrl.search)).status === 200, "local checkout page did not render for trial");
result = await request("/api/purchase/demo/confirm", { method: "POST", headers: json, body: JSON.stringify({ orderId: canceledTrialOrderId, action: "cancel" }) });
assert(result.status === 200 && result.body.order?.status === "canceled", "trial cancellation failed");
result = await request("/api/my-learning");
assert(result.status === 200 && result.body.overview.entitlements.length === 0, "cancelled trial granted access");

result = await request("/api/trial", { method: "POST", headers: json, body: JSON.stringify({ courseId: "epicureanism", planId: "epicureanism-pc-6", locale: "en-GB" }) });
assert(result.status === 200 && result.body.order?.status === "pending", "second trial attempt did not create a pending order");
const trialOrderId = result.body.order.id;
result = await request("/api/purchase/demo/confirm", { method: "POST", headers: json, body: JSON.stringify({ orderId: trialOrderId, action: "complete" }) });
assert(result.status === 200 && result.body.order?.status === "paid", "trial completion failed");
result = await request("/api/my-learning");
assert(result.status === 200 && result.body.overview.courses.length === 0 && result.body.overview.entitlements.length === 1, "trial entitlement or My Learning start rule failed");

// Purchase is a separate order and subscription. Completing it replaces trial access.
result = await request("/api/purchase/quote", { method: "POST", headers: json, body: JSON.stringify({ planId: "epicureanism-pc-6" }) });
assert(result.status === 200 && result.body.quote?.id, "purchase quote failed");
result = await request("/api/purchase/checkout", { method: "POST", headers: json, body: JSON.stringify({ quoteId: result.body.quote.id, locale: "en-GB" }) });
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
assert(result.status === 400, "subscription resume must be unavailable after cancellation");

result = await request("/api/study/events", { method: "POST", headers: json, body: JSON.stringify({ courseId: "epicureanism", lessonId: "pleasure-and-the-good-life", event: "complete", seconds: 1500, clientEventId: `complete-${stamp}` }) });
assert(result.status === 200 && result.body.record.progress === 56, "course progress calculation failed");
result = await request("/api/my-learning");
assert(result.status === 200 && result.body.overview.courses[0]?.courseId === "epicureanism", "My Learning failed");
const notification = result.body.overview.notifications[0];
result = await request("/api/my-learning/notifications/read", { method: "POST", headers: json, body: JSON.stringify({ notificationId: notification.id, read: true }) });
assert(result.status === 200 && result.body.notification.readAt, "notification read failed");
result = await request("/api/my-learning/notifications/read", { method: "POST", headers: json, body: JSON.stringify({ notificationId: notification.id, read: false }) });
assert(result.status === 200 && result.body.notification.readAt === null, "notification unread failed");
for (const path of ["/en-GB/account/my-learning", "/en-GB/account/my-learning/subscription", "/en-GB/account/my-learning/notifications", "/en-GB/account/my-learning/settings", "/en-GB/account/my-learning/help", "/en-GB/account/learn/epicureanism"]) {
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
