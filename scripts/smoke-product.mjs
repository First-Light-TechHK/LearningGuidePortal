const base = (process.env.SMOKE_BASE_URL || "http://127.0.0.1:3011").replace(/\/$/, "");
const origin = new URL(base).origin;
let cookie = "";

async function request(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.method && options.method !== "GET") headers.origin = origin;
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

for (const path of ["/api/health", "/api/health/config", "/en-GB/portal", "/zh-CN/portal", "/en-GB/portal/courses", "/en-GB/portal/faq", "/en-GB/help", "/zh-CN/help", "/en-GB/contact", "/zh-CN/contact", "/en-GB/subscription"]) {
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
assert(result.status === 307 && result.location?.endsWith("/en-GB/account/my-learning") && new URL(result.location, base).origin === origin, "local Google sign-in did not redirect on the current host");
result = await request("/api/auth/me");
assert(result.status === 200 && result.body.user?.email === "google.local@example.test", "local Google session failed");
result = await request("/api/auth/logout", { method: "POST" });
assert(result.status === 200 && result.body.ok, "logout after local Google sign-in failed");

const learningPath = "/en-GB/account/my-learning";
result = await request(`/api/auth/wechat?locale=en-GB&returnTo=${encodeURIComponent(learningPath)}`);
assert(result.status === 307 && result.location, "local WeChat sign-in did not redirect");
const wechatTarget = new URL(result.location, base);
assert(wechatTarget.origin === origin, "local WeChat sign-in redirected to a different origin");
if (wechatTarget.pathname === "/en-GB/portal/bind-email") {
  assert(wechatTarget.searchParams.get("returnTo") === learningPath, "WeChat binding lost the original destination");
  assert((await request(wechatTarget.pathname + wechatTarget.search)).status === 200, "WeChat binding page did not render");
  assert((await request("/api/my-learning")).status === 401, "an unbound WeChat session reached My Learning");
} else {
  // The reusable local WeChat account may already have completed email binding.
  assert(wechatTarget.pathname === learningPath, "bound WeChat sign-in lost the original destination");
  result = await request("/api/auth/me");
  assert(result.status === 200 && Boolean(result.body.user?.email), "bound WeChat session has no email");
}
result = await request("/api/auth/logout", { method: "POST" });
assert(result.status === 200 && result.body.ok, "logout after local WeChat sign-in failed");

result = await request("/api/auth/check-email", { method: "POST", headers: json, body: JSON.stringify({ email: `new-${stamp}@example.com` }) });
assert(result.status === 200 && result.body.ok === true && result.body.data?.exists === false, "email-first auth did not identify the disposable address as new");

result = await request("/api/auth/register", { method: "POST", headers: json, body: JSON.stringify({ termsAccepted: true, email, password: "Passw0rd!123", nickname: "Smoke User", locale: "en-GB" }) });
assert(result.status === 200 && result.body.ok, "registration failed");
result = await request("/api/auth/check-email", { method: "POST", headers: json, body: JSON.stringify({ email }) });
assert(result.status === 200 && result.body.ok === true && result.body.data?.exists === true && result.body.data.pending === false, "email-first auth did not recognise the registered test account");
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
const originalValidTo = result.body.subscription.validTo;
result = await request("/api/subscription", { method: "POST", headers: json, body: JSON.stringify({ subscriptionId, action: "resume" }) });
assert(result.status === 200 && result.body.subscription?.state === "active" && result.body.subscription.validTo === originalValidTo, "paid subscription did not resume within its original period");

const lessonId = "pleasure-and-the-good-life";
result = await request("/api/study/events", { method: "POST", headers: json, body: JSON.stringify({ courseId: "epicureanism", lessonId, event: "complete", seconds: 1500, clientEventId: `complete-${stamp}` }) });
assert(result.status === 200 && result.body.ok, "Lesson completion was rejected");
result = await request("/api/my-learning");
const course = result.body.overview?.courses.find(item => item.courseId === "epicureanism");
assert(result.status === 200 && course?.completedLessonIds.includes(lessonId), "My Learning did not show the completed Lesson");
assert(result.body.overview.notificationsPlaceholder === true && result.body.overview.notifications.length === 0, "My Learning notifications must stay a placeholder");
result = await request("/api/my-learning/notifications");
assert(result.status === 200 && result.body.placeholder === true && result.body.unreadCount === 0, "notification inbox must not be exposed");
for (const path of ["/en-GB/account/my-learning", "/en-GB/account/my-learning/subscription", "/en-GB/account/my-learning/notifications", "/en-GB/account/my-learning/settings", "/en-GB/account/my-learning/support", "/en-GB/account/learn/epicureanism", "/en-GB/privacy-policy", "/en-GB/terms-of-service", "/en-GB/cookie-policy"]) {
  assert((await request(path)).status === 200, `${path} did not return 200`);
}
const avatarForm = new FormData();
const avatarPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
avatarForm.set("file", new Blob([avatarPng], { type: "image/png" }), "avatar.png");
result = await request("/api/my-learning/avatar", { method: "POST", body: avatarForm });
assert(result.status === 200 && result.body.ok, "profile image upload failed");
result = await request("/api/my-learning/avatar");
assert(result.status === 200 && result.contentType === "image/png", "profile image fetch failed");
result = await request("/api/my-learning/avatar", { method: "DELETE" });
assert(result.status === 200 && result.body.ok, "profile image removal failed");
console.log(JSON.stringify({ ok: true, base, checked: "public Portal, bilingual pages, registration, local OAuth, trial, purchase, receipt, subscription cancel/resume, Study, My Learning, notifications, profile image" }));
