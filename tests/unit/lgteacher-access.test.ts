import assert from "node:assert/strict";
import { test } from "node:test";
import { canAuthorCourses, canManageCourse, canOperateBackoffice } from "../../services/backofficeAccess";
import type { ProductUser } from "../../services/productStore";

const user = (changes: Partial<ProductUser> = {}): ProductUser => ({
  id: "teacher-a", email: "lgteacher-access@example.test", passwordHash: null,
  nickname: "Teacher", locale: "en-GB", role: "teacher", status: "active",
  emailVerifiedAt: "2026-01-01T00:00:00.000Z", createdAt: "2026-01-01T00:00:00.000Z",
  ...changes,
});

test("LGTeacher: active teachers manage only their owned or assigned courses", () => {
  assert.equal(canAuthorCourses(user()), true);
  assert.equal(canOperateBackoffice(user()), false);
  assert.equal(canManageCourse(user(), { authorIds: ["teacher-a"] }), true);
  assert.equal(canManageCourse(user(), { authorIds: ["teacher-b", "teacher-a"] }), true);
  assert.equal(canManageCourse(user(), { authorIds: ["teacher-b"] }), false);
  assert.equal(canManageCourse(user(), { authorIds: [] }), false);
  assert.equal(canManageCourse(user(), {}), false);
  assert.equal(canManageCourse(user(), null), false);
});

test("LGTeacher: operators retain management access to unassigned and foreign courses", () => {
  const operator = user({ role: "operator" });
  assert.equal(canOperateBackoffice(operator), true);
  assert.equal(canAuthorCourses(operator), true);
  assert.equal(canManageCourse(operator, { authorIds: ["teacher-b"] }), true);
  assert.equal(canManageCourse(operator, {}), true);
});

test("LGTeacher: student identity in authorIds does not confer an author role", () => {
  const student = user({ role: "student" });
  assert.equal(canAuthorCourses(student), false);
  assert.equal(canManageCourse(student, { authorIds: [student.id] }), false);
  for (const anonymous of [null, undefined]) {
    assert.equal(canOperateBackoffice(anonymous), false);
    assert.equal(canAuthorCourses(anonymous), false);
    assert.equal(canManageCourse(anonymous, { authorIds: ["teacher-a"] }), false);
  }
});

test("LGTeacher: disabled and pending status override every role and ownership", () => {
  for (const role of ["student", "teacher", "operator"] as const) {
    for (const status of ["disabled", "pending"] as const) {
      const inactive = user({ role, status });
      assert.equal(canOperateBackoffice(inactive), false, `${role}/${status}`);
      assert.equal(canAuthorCourses(inactive), false, `${role}/${status}`);
      assert.equal(canManageCourse(inactive, { authorIds: [inactive.id] }), false, `${role}/${status}`);
    }
  }
});

test("LGTeacher: configured operator email requires verification and active status", () => {
  const previous = process.env.BACKOFFICE_OPERATOR_EMAIL;
  process.env.BACKOFFICE_OPERATOR_EMAIL = "  CONFIGURED@example.test  ";
  try {
    const configured = user({ email: "configured@example.test", role: "student" });
    assert.equal(canOperateBackoffice(configured), true);
    assert.equal(canManageCourse(configured, {}), true);
    assert.equal(canOperateBackoffice({ ...configured, emailVerifiedAt: null }), false);
    assert.equal(canOperateBackoffice({ ...configured, status: "disabled" }), false);
    assert.equal(canOperateBackoffice({ ...configured, status: "pending" }), false);
    assert.equal(canOperateBackoffice({ ...configured, email: null }), false);
  } finally {
    if (previous === undefined) delete process.env.BACKOFFICE_OPERATOR_EMAIL;
    else process.env.BACKOFFICE_OPERATOR_EMAIL = previous;
  }
});
