import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const cwd = process.cwd();
const env = { STORAGE_BACKEND: process.env.STORAGE_BACKEND, ADMIN_HOSTS: process.env.ADMIN_HOSTS, BACKOFFICE_OPERATOR_EMAIL: process.env.BACKOFFICE_OPERATOR_EMAIL };
const admin = "localhost:3097", learner = "127.0.0.1:3097";
let directory: string;
let store: typeof import("../../services/productStore");
let auth: typeof import("../../services/productAuth");
let login: typeof import("../../app/api/auth/admin/login/route");
let hosts: typeof import("../../services/adminHost");
const accounts: Record<string, { id: string; email: string; token: string }> = {};

before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "lg-course-admin-session-"));
  process.chdir(directory);
  Object.assign(process.env, { STORAGE_BACKEND: "local", ADMIN_HOSTS: "localhost", BACKOFFICE_OPERATOR_EMAIL: "operator@admin-session.test" });
  store = await import("../../services/productStore");
  auth = await import("../../services/productAuth");
  login = await import("../../app/api/auth/admin/login/route");
  hosts = await import("../../services/adminHost");
  for (const name of ["operator", "teacher", "student", "pending", "disabled"]) {
    const email = `${name}@admin-session.test`;
    const user = await store.registerUser({ email, password: "password1", role: name === "operator" ? "operator" : "student" });
    if (name !== "pending") await store.verifyEmailToken(await store.issueEmailVerificationToken(user.id));
    accounts[name] = { id: user.id, email, token: (await store.createSession(user.id)).token };
  }
  const course = await store.createCourseForOperator({ title: "Admin-session ownership" }, accounts.operator.id);
  await store.assignCourseOwner(accounts.operator.id, course.id, { email: accounts.teacher.email, expectedUpdatedAt: course.updatedAt });
  const files = await import("../../services/fileStore");
  const data = await store.ensureProductData();
  const disabled = data.users.find(user => user.id === accounts.disabled.id)!;
  disabled.role = "teacher"; disabled.status = "disabled";
  await files.atomicWriteJson(path.join(files.systemRoot(), "learning_guide", "product.json"), data);
});

after(async () => {
  process.chdir(cwd);
  for (const [key, value] of Object.entries(env)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  if (directory) await rm(directory, { recursive: true, force: true });
});

function request(name: string, host = admin, cookie = "learning_guide_admin_session", pathname = "/api/backoffice/courses", method = "GET", origin = `http://${host}`) {
  return new Request(`http://${host}${pathname}`, { method, headers: { host, origin, cookie: `${cookie}=${accounts[name]?.token || ""}` } });
}

test("only active verified authors can obtain the shared-login admin cookie", async () => {
  for (const [name, status] of [["operator", 200], ["teacher", 200], ["student", 403], ["pending", 403], ["disabled", 401]] as const) {
    const response = await login.POST(new Request(`http://${admin}/api/auth/admin/login`, { method: "POST", headers: { host: admin, origin: `http://${admin}` }, body: JSON.stringify({ email: accounts[name].email, password: "password1" }) }));
    assert.equal(response.status, status, name);
    const cookie = response.headers.get("set-cookie") || "";
    if (status === 200) {
      assert.match(cookie, /^learning_guide_admin_session=/);
      assert.doesNotMatch(cookie, /(?:^|;\s*)learning_guide_session=/);
      assert.equal(response.headers.get("cache-control"), "private, no-store");
      const token = cookie.split(";")[0].split("=")[1];
      assert.equal((await store.getUserBySessionToken(token))?.id, accounts[name].id);
    } else assert.equal(cookie, "");
  }
  const before = (await store.ensureProductData()).sessions.length;
  assert.equal((await login.POST(request("operator", learner, undefined, "/api/auth/admin/login", "POST"))).status, 404);
  assert.equal((await login.POST(request("operator", admin, undefined, "/api/auth/admin/login", "POST", "https://evil.test"))).status, 403);
  assert.equal((await store.ensureProductData()).sessions.length, before);
});

test("author and finance helpers respect host and cookie boundaries", async () => {
  assert.equal((await auth.currentAuthorRequest(request("teacher")))?.id, accounts.teacher.id);
  assert.equal(await auth.currentAuthorRequest(request("teacher", learner)), null);
  assert.equal(await auth.currentAuthorRequest(request("teacher", admin, auth.SESSION_COOKIE)), null);
  assert.equal(await auth.currentAuthorRequest(request("student")), null);
  assert.equal(await auth.currentAuthorRequest(request("pending")), null);
  assert.equal(await auth.currentAuthorRequest(request("disabled")), null);
  assert.equal(await auth.currentOperatorRequest(request("teacher")), null);
  assert.equal((await auth.currentOperatorRequest(request("operator")))?.id, accounts.operator.id);
  assert.equal((await auth.currentCourseMediaUser(request("teacher")))?.id, accounts.teacher.id);
  assert.equal(await auth.currentCourseMediaUser(request("teacher", learner)), null);
  assert.equal(await auth.currentCourseMediaUser(request("teacher", admin, auth.SESSION_COOKIE)), null);
  assert.equal((await auth.currentCourseMediaUser(request("student", learner, auth.SESSION_COOKIE)))?.id, accounts.student.id);
});

test("admin KS uses operator sessions and same-origin writes, and media stays reachable on both hosts", async () => {
  for (const pathname of ["/api/navigation", "/api/courses", "/api/chat-testing", "/api/dialogue/send", "/api/wiki"]) {
    assert.equal(await auth.rejectIfUnauthenticated(request("operator", admin, undefined, pathname)), null);
    assert.equal((await auth.rejectIfUnauthenticated(request("teacher", admin, undefined, pathname)))?.status, 403);
    assert.equal((await auth.rejectIfUnauthenticated(request("operator", admin, auth.SESSION_COOKIE, pathname)))?.status, 401);
    assert.equal((await auth.rejectIfUnauthenticated(request("operator", admin, undefined, pathname, "POST", "https://evil.test")))?.status, 403);
    assert.equal(await auth.rejectIfUnauthenticated(request("operator", admin, undefined, pathname, "POST")), null);
    assert.deepEqual(hosts.adminHostDecision(request("operator", admin, undefined, pathname)), { allow: true });
  }
  for (const host of [admin, learner]) assert.deepEqual(hosts.adminHostDecision(request("", host, undefined, "/api/course-media/course/asset")), { allow: true });
  assert.deepEqual(hosts.adminHostDecision(request("teacher", learner)), { status: 404 });
  assert.deepEqual(hosts.adminHostDecision(request("operator", admin, undefined, "/knowledge")), { allow: true });
});

test("wiki publishing uses the same admin operator guard before parsing or writing", async () => {
  const { POST } = await import("../../app/api/wiki/publish/route");
  const { NextRequest } = await import("next/server");
  const invoke = (name: string, cookie = auth.ADMIN_SESSION_COOKIE, origin = `http://${admin}`) => POST(new NextRequest(`http://${admin}/api/wiki/publish`, { method: "POST", headers: { host: admin, origin, cookie: `${cookie}=${accounts[name].token}` }, body: "{}" }));
  assert.equal((await invoke("teacher")).status, 403);
  assert.equal((await invoke("teacher", auth.SESSION_COOKIE)).status, 401);
  assert.equal((await invoke("operator", auth.SESSION_COOKIE)).status, 401);
  assert.equal((await invoke("operator", auth.ADMIN_SESSION_COOKIE, "https://evil.test")).status, 403);
  const permitted = await invoke("operator");
  assert.equal(permitted.status, 400);
  assert.equal((await permitted.json()).error, "Draft is required.");
});
