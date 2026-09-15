import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const cwd = process.cwd(), oldBackend = process.env.STORAGE_BACKEND, oldOperator = process.env.BACKOFFICE_OPERATOR_EMAIL;
const origin = "http://localhost:3097";
let directory: string;
let store: typeof import("../../services/productStore");
let collection: typeof import("../../app/api/backoffice/courses/route");
let detail: typeof import("../../app/api/backoffice/courses/[courseId]/route");
let ownership: typeof import("../../app/api/backoffice/courses/[courseId]/ownership/route");
let catalogue: typeof import("../../app/api/backoffice/courses/catalogue/route");
before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "lg-course-ownership-")); process.chdir(directory);
  process.env.STORAGE_BACKEND = "local"; process.env.BACKOFFICE_OPERATOR_EMAIL = "operator@ownership.test";
  store = await import("../../services/productStore");
  collection = await import("../../app/api/backoffice/courses/route");
  detail = await import("../../app/api/backoffice/courses/[courseId]/route");
  ownership = await import("../../app/api/backoffice/courses/[courseId]/ownership/route");
  catalogue = await import("../../app/api/backoffice/courses/catalogue/route");
});
after(async () => {
  process.chdir(cwd);
  if (oldBackend === undefined) delete process.env.STORAGE_BACKEND; else process.env.STORAGE_BACKEND = oldBackend;
  if (oldOperator === undefined) delete process.env.BACKOFFICE_OPERATOR_EMAIL; else process.env.BACKOFFICE_OPERATOR_EMAIL = oldOperator;
  if (directory) await rm(directory, { recursive: true, force: true });
});
function request(token: string, method: string, body?: unknown, suppliedOrigin = origin) {
  return new Request(origin + "/api/backoffice/courses", { method, headers: { origin: suppliedOrigin, cookie: "learning_guide_session=" + token }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}

test("ownership and lifecycle routes retain one login, prevent escalation and isolate every teacher mutation", async () => {
  const register = async (name: string, verified = true) => {
    const user = await store.registerUser({ email: name + "@ownership.test", password: "password1" });
    if (verified) await store.verifyEmailToken(await store.issueEmailVerificationToken(user.id));
    return { user, token: (await store.createSession(user.id)).token };
  };
  const operator = await register("operator"), teacher = await register("teacher"), other = await register("other"), pending = await register("pending", false);
  let course = await store.createCourseForOperator({ title: "Assigned course" }, operator.user.id);
  const context = { params: Promise.resolve({ courseId: course.id }) };
  const assign = (token: string, email: string, suppliedOrigin = origin) => ownership.PUT(request(token, "PUT", { email, expectedUpdatedAt: course.updatedAt }, suppliedOrigin), context);
  assert.equal((await assign(teacher.token, teacher.user.email!)).status, 403);
  assert.equal((await assign(operator.token, pending.user.email!)).status, 404);
  assert.equal((await assign(operator.token, teacher.user.email!, "https://other.test")).status, 403);
  const response = await assign(operator.token, teacher.user.email!);
  assert.equal(response.status, 200);
  course = (await response.json()).course;
  assert.equal((await store.getUserBySessionToken(teacher.token))!.role, "teacher");
  assert.equal((await store.getUserBySessionToken(other.token))!.role, "student");
  assert.deepEqual(course.authorIds, [teacher.user.id]);
  assert.equal((await catalogue.POST(request(teacher.token, "POST", { name: "Denied catalogue" }))).status, 403);
  assert.equal((await catalogue.POST(request(operator.token, "POST", { name: "Allowed catalogue" }))).status, 201);
  assert.equal((await collection.POST(request(teacher.token, "POST", { title: "Cross origin" }, "https://other.test"))).status, 403);
  const second = await store.createCourseForOperator({ title: "Other assigned course" }, operator.user.id);
  await store.assignCourseOwner(operator.user.id, second.id, { email: other.user.email!, expectedUpdatedAt: second.updatedAt });
  assert.equal((await detail.GET(request(other.token, "GET"), context)).status, 404);
  assert.equal((await detail.PATCH(request(other.token, "PATCH", { status: "published", expectedUpdatedAt: course.updatedAt }), context)).status, 404);
  assert.equal((await detail.POST(request(other.token, "POST", { title: "No", body: "No", durationMinutes: 5 }), context)).status, 404);
  assert.equal((await detail.DELETE(request(other.token, "DELETE", { expectedUpdatedAt: course.updatedAt }), context)).status, 404);
  const created = await collection.POST(request(teacher.token, "POST", { title: "Teacher-created course", authorIds: [other.user.id], role: "operator" }));
  assert.equal(created.status, 201);
  assert.deepEqual((await created.json()).course.authorIds, [teacher.user.id]);
  assert.equal(store.isOperator((await store.getUserBySessionToken(teacher.token))!), false);
  const before = await store.ensureProductData();
  assert.equal((await detail.DELETE(request(teacher.token, "DELETE", { expectedUpdatedAt: "stale" }), context)).status, 409);
  const archived = await detail.DELETE(request(teacher.token, "DELETE", { expectedUpdatedAt: course.updatedAt }), context);
  assert.equal(archived.status, 200); course = (await archived.json()).course;
  assert.equal(course.status, "archived");
  assert.equal((await store.listPublishedCourses()).some(c => c.id === course.id), false);
  assert.equal((await store.checkEntitlement(teacher.user.id, course.id)).allowed, false);
  assert.equal((await detail.PATCH(request(teacher.token, "PATCH", { status: "published", expectedUpdatedAt: course.updatedAt }), context)).status, 400);
  assert.equal((await detail.PATCH(request(teacher.token, "PATCH", { status: "draft", expectedUpdatedAt: course.updatedAt }), context)).status, 200);
  const after = await store.ensureProductData();
  for (const key of ["plans", "orders", "subscriptions", "entitlements", "studyRecords", "studyEvents"] as const) assert.deepEqual(after[key], before[key]);
  const listed = await collection.GET(request(teacher.token, "GET"));
  assert.equal(listed.status, 200);
  assert.ok((await listed.json()).courses.every((c: { authorIds: string[] }) => c.authorIds.includes(teacher.user.id)));
});

test("draft and publish transactions reject missing media without changing the aggregate", async () => {
  const operator = await store.getActiveUserByEmail("operator@ownership.test");
  assert.ok(operator);
  let course = await store.createCourseForOperator({ title: "Media integrity course" }, operator.id);
  const missing = "/api/course-media/" + course.id + "/11111111-1111-4111-8111-111111111111";
  const input = { title: course.title, description: "", expectedUpdatedAt: course.updatedAt, cover: missing, sections: [] };
  const before = await store.ensureProductData();
  await assert.rejects(store.saveCourseDraftForAuthor(operator.id, course.id, input), { code: "invalid" });
  assert.deepEqual(await store.ensureProductData(), before);
  const files = await import("../../services/fileStore");
  const seeded = await store.ensureProductData();
  const stored = seeded.courses.find(c => c.id === course.id)!;
  stored.sections = [{ id: "integrity-section", title: "Section", lessons: [{ id: "integrity-lesson", title: "Video", body: "Video", durationMinutes: 5, isPublic: true, contents: [{ id: "missing-video", title: "Video", type: "video", mode: "lecture", url: missing, nodes: [] }] }] }];
  await files.atomicWriteJson(path.join(directory, "data/knowledge_system/learning_guide/product.json"), seeded);
  await assert.rejects(store.setCourseStatus(course.id, "published", operator.id, course.updatedAt), { code: "invalid" });
  course = await store.getCourseForAuthor(operator.id, course.id);
  assert.equal(course.status, "draft");
  assert.deepEqual(await store.ensureProductData(), seeded);
});
