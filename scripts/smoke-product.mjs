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
  return { status: response.status, body, contentType: response.headers.get("content-type") };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const stamp = Date.now();
const email = `smoke-${stamp}@example.com`;
const json = { "content-type": "application/json" };

for (const path of ["/api/health", "/en-GB/portal", "/zh-CN/portal", "/en-GB/portal/courses", "/en-GB/portal/faq"]) {
  assert((await request(path)).status === 200, `${path} did not return 200`);
}
let result = await request("/api/auth/register", { method: "POST", headers: json, body: JSON.stringify({ email, password: "Passw0rd!123", nickname: "Smoke User", locale: "en-GB" }) });
assert(result.status === 200 && result.body.ok, "registration failed");
result = await request("/api/trial", { method: "POST", headers: json, body: JSON.stringify({ courseId: "epicureanism" }) });
assert(result.status === 200 && result.body.entitlement?.source === "trial", "trial failed");
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
