import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { verifiedUser } from "./helpers/my-learning";

const originalCwd = process.cwd();
const originalStorageBackend = process.env.STORAGE_BACKEND;
const origin = "http://localhost:3014";
let isolatedCwd: string;
let store: typeof import("../../services/productStore");
let notifications: typeof import("../../services/notifications/service");
let get: typeof import("../../app/api/my-learning/notifications/route").GET;
let read: typeof import("../../app/api/my-learning/notifications/read/route").POST;

before(async () => {
  isolatedCwd = await mkdtemp(path.join(tmpdir(), "lg-notification-api-"));
  process.chdir(isolatedCwd);
  process.env.STORAGE_BACKEND = "local";
  store = await import("../../services/productStore");
  notifications = await import("../../services/notifications/service");
  get = (await import("../../app/api/my-learning/notifications/route")).GET;
  read = (await import("../../app/api/my-learning/notifications/read/route")).POST;
});

after(async () => {
  process.chdir(originalCwd);
  if (originalStorageBackend === undefined) delete process.env.STORAGE_BACKEND;
  else process.env.STORAGE_BACKEND = originalStorageBackend;
  if (isolatedCwd && path.dirname(isolatedCwd) === tmpdir()) await rm(isolatedCwd, { recursive: true, force: true });
});

function learnerRequest(url: string, token?: string) {
  return new Request(`${origin}${url}`, { headers: token ? { cookie: `learning_guide_session=${token}` } : {} });
}

async function signedInLearner(email: string) {
  const user = await verifiedUser(store, email);
  await store.editProductData((data) => {
    data.notifications = data.notifications.filter((item) => item.userId !== user.id);
  });
  const session = await store.createSession(user.id);
  await notifications.emitNotificationEvent({
    eventType: "HELPDESK_TICKET_REPLIED", eventKey: `api:${email}:1`, userId: user.id,
    params: { ticket_subject: "First question", ticket_link: "/my-learning/support/1" },
  });
  await notifications.emitNotificationEvent({
    eventType: "COURSE_NEW_LAUNCH", eventKey: `api:${email}:course`, userId: user.id,
    params: { course_title: "The Renaissance in Florence", category_name: "Art & Humanities", course_link: "/courses/1" },
  });
  return { user, token: session.token };
}

test("GET learner notifications returns the inbox, category mapping and unread count", async () => {
  const { token } = await signedInLearner("api-inbox@example.test");
  const response = await get(learnerRequest("/api/my-learning/notifications?filter=all&limit=20", token));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.items.length, 2);
  assert.equal(body.unreadCount, 2);
  assert.equal(body.items[0].category, "course");
  assert.equal(body.items[0].categoryLabel, "New course");
  assert.equal(body.items[0].buttonText, "View course");
  assert.equal(body.items[0].buttonLink, "/courses/1");
  assert.equal(body.items[0].unread, true);
  assert.equal(typeof body.items[0].displayTime, "string");
  const unread = await get(learnerRequest("/api/my-learning/notifications?filter=unread&limit=20", token));
  assert.equal((await unread.json()).items.length, 2);
});

test("GET learner notifications reports total for both filters and with a cursor", async () => {
  const { token } = await signedInLearner("api-total@example.test");
  const list = async (query: string) => (await get(learnerRequest(`/api/my-learning/notifications?${query}`, token))).json();
  const page1 = await list("filter=all&limit=1");
  assert.equal(page1.items.length, 1);
  assert.equal(page1.total, 2);
  assert.ok(page1.nextCursor);
  const page2 = await list(`filter=all&limit=1&cursor=${page1.nextCursor}`);
  assert.equal(page2.total, 2, "total ignores the cursor");
  assert.equal(page2.nextCursor, null);
  await read(new Request(`${origin}/api/my-learning/notifications/read`, {
    method: "POST", headers: { origin, cookie: `learning_guide_session=${token}`, "content-type": "application/json" },
    body: JSON.stringify({ notificationId: page1.items[0].id, read: true }),
  }));
  const unread = await list("filter=unread");
  assert.equal(unread.total, 1);
  assert.equal((await list("filter=all")).total, 2);
});

test("GET learner notifications honours locale=zh-CN for the label and time only", async () => {
  const { token } = await signedInLearner("api-locale@example.test");
  const zh = await (await get(learnerRequest("/api/my-learning/notifications?locale=zh-CN", token))).json();
  const subscription = await (await get(learnerRequest("/api/my-learning/notifications?locale=en-GB", token))).json();
  assert.equal(zh.items.length, subscription.items.length);
  assert.equal(zh.items[0].categoryLabel, "新课程");
  assert.match(zh.items[0].displayTime, /[一-鿿]/);
  assert.equal(zh.items[0].title, subscription.items[0].title, "title stays as stored");
  assert.equal(subscription.items[0].categoryLabel, "New course");
  const ignored = await (await get(learnerRequest("/api/my-learning/notifications?locale=fr-FR", token))).json();
  assert.equal(ignored.items[0].categoryLabel, "New course", "unknown locale falls back to the profile language");
});

test("GET learner notifications rejects signed-out callers and bad filters", async () => {
  assert.equal((await get(learnerRequest("/api/my-learning/notifications"))).status, 401);
  const { token } = await signedInLearner("api-bad-filter@example.test");
  assert.equal((await get(learnerRequest("/api/my-learning/notifications?filter=other", token))).status, 400);
  assert.equal((await get(learnerRequest("/api/my-learning/notifications?limit=999", token))).status, 400);
});

test("POST read marks one of the caller's own notifications and returns the new count", async () => {
  const { token } = await signedInLearner("api-read@example.test");
  const list = await (await get(learnerRequest("/api/my-learning/notifications", token))).json();
  const id = list.items[0].id;
  const ok = await read(new Request(`${origin}/api/my-learning/notifications/read`, {
    method: "POST", headers: { origin, cookie: `learning_guide_session=${token}`, "content-type": "application/json" },
    body: JSON.stringify({ notificationId: id, read: true }),
  }));
  assert.equal(ok.status, 200);
  const body = await ok.json();
  assert.equal(body.ok, true);
  assert.equal(body.unreadCount, 1);
  assert.equal(body.notification.read, true);
  const unreadList = await (await get(learnerRequest("/api/my-learning/notifications?filter=unread", token))).json();
  assert.equal(unreadList.items.some((item: { id: string }) => item.id === id), false);
});

test("POST read validates session, origin, body and ownership", async () => {
  const { token } = await signedInLearner("api-read-guard@example.test");
  const send = (options: { token?: string; requestOrigin?: string; body?: unknown }) => read(new Request(`${origin}/api/my-learning/notifications/read`, {
    method: "POST",
    headers: { ...(options.requestOrigin === undefined ? { origin } : options.requestOrigin ? { origin: options.requestOrigin } : {}), ...(options.token ? { cookie: `learning_guide_session=${options.token}` } : {}), "content-type": "application/json" },
    body: JSON.stringify(options.body ?? { notificationId: "x", read: true }),
  }));
  assert.equal((await send({})).status, 401);
  assert.equal((await send({ token, requestOrigin: "https://evil.test" })).status, 403);
  assert.equal((await send({ token, body: { notificationId: 1, read: "yes" } })).status, 400);
  assert.equal((await send({ token, body: { notificationId: "missing", read: true } })).status, 404);
  const other = await signedInLearner("api-read-other@example.test");
  const list = await (await get(learnerRequest("/api/my-learning/notifications", other.token))).json();
  const first = list.items[0].id;
  assert.equal((await send({ token, body: { notificationId: first, read: true } })).status, 404);
});
