import assert from "node:assert/strict";
import { test } from "node:test";
import { BACKOFFICE_MENUS, BACKOFFICE_PERMISSION_MATRIX, BACKOFFICE_ROLES, canAccessMenu, canManageEmployees, menuForBackofficePath, visibleMenus } from "../../lib/backofficeRbac";
import { backofficeMenusFor, backofficeRoleOf, canManageBackofficeEmployees, canUseBackofficeMenu } from "../../services/backofficeAccess";
import { backofficeIntegrationUrl } from "../../services/backofficeIntegrations";

// PRD v1.1 §3.2, row by row (menu: Admin, Course Creator, Graphic Designer, Finance, Operation Admin, Operation AI).
const PRD_MATRIX: Record<string, string[]> = {
  course: ["full", "view", "edit", "view", "full", "view"],
  knowledge: ["full", "view", "view", "view", "none", "full"],
  aiTutor: ["full", "view", "view", "view", "none", "full"],
  order: ["full", "view", "view", "full", "full", "view"],
  reporting: ["full", "view", "view", "full", "full", "view"],
  student: ["full", "view", "view", "view", "full", "view"],
  helpdesk: ["full", "view", "view", "view", "full", "view"],
  settings: ["full", "view", "view", "view", "full", "view"]
};

test("permission matrix matches the PRD table cell by cell", () => {
  assert.deepEqual([...BACKOFFICE_ROLES], ["admin", "course_creator", "graphic_designer", "finance", "operation_admin", "operation_ai"]);
  for (const menu of BACKOFFICE_MENUS) {
    assert.deepEqual(BACKOFFICE_ROLES.map((role) => BACKOFFICE_PERMISSION_MATRIX[role][menu]), PRD_MATRIX[menu], menu);
  }
});

test("menu-level access: only None hides a menu", () => {
  assert.deepEqual(visibleMenus("operation_admin"), ["course", "order", "reporting", "student", "helpdesk", "settings"]);
  for (const role of BACKOFFICE_ROLES.filter((item) => item !== "operation_admin")) assert.deepEqual(visibleMenus(role), [...BACKOFFICE_MENUS], role);
  assert.equal(canAccessMenu("operation_admin", "knowledge"), false);
  assert.equal(canAccessMenu("operation_admin", "aiTutor"), false);
  assert.equal(canAccessMenu("course_creator", "settings"), true);
});

test("Employee Account management is Admin-only", () => {
  assert.deepEqual(BACKOFFICE_ROLES.filter((role) => canManageEmployees(role)), ["admin"]);
  assert.equal(canManageEmployees(null), false);
});

test("paths resolve to the owning menu, including knowledge pages and APIs", () => {
  const cases: Array<[string, string | null]> = [
    ["/en-GB/backoffice/courses", "course"], ["/api/backoffice/courses/abc/draft", "course"],
    ["/zh-CN/backoffice/knowledge", "knowledge"], ["/en-GB/backoffice/ai-tutor", "aiTutor"],
    ["/en-GB/backoffice/orders", "order"], ["/api/backoffice/orders/export", "order"],
    ["/en-GB/backoffice/reporting", "reporting"], ["/en-GB/backoffice/students", "student"], ["/en-GB/backoffice/helpdesk", "helpdesk"],
    ["/en-GB/backoffice/settings/employees", "settings"], ["/en-GB/backoffice/payment", "settings"], ["/api/backoffice/portal/media", "settings"],
    ["/knowledge/philosophy/epicureanism/knowledge-wiki", "knowledge"], ["/knowledge/philosophy/epicureanism/chat-testing", "aiTutor"],
    ["/knowledge/philosophy/epicureanism/dialogue-testing", "aiTutor"], ["/api/chat-testing/run-route", "aiTutor"], ["/api/dialogue", "aiTutor"],
    ["/api/wiki/tree", "knowledge"], ["/api/releases/r1", "knowledge"], ["/api/llm-draft/import-source-output", "knowledge"],
    ["/en-GB/backoffice/sign-in", null], ["/api/backoffice/account/password", null]
  ];
  for (const [path, menu] of cases) assert.equal(menuForBackofficePath(path), menu, path);
});

const operator = (backofficeRole?: string, status = "active") => ({ id: "u1", role: "operator" as const, status: status as "active", email: "jack@learningguide.com", emailVerifiedAt: "2026-10-01", backofficeRole });

test("operators without a stored role keep full access as Admin", () => {
  assert.equal(backofficeRoleOf(operator()), "admin");
  assert.equal(backofficeRoleOf(operator("not-a-role")), "admin");
  assert.deepEqual(backofficeMenusFor(operator()), [...BACKOFFICE_MENUS]);
  assert.equal(canManageBackofficeEmployees(operator()), true);
});

test("the stored role decides the menus on the server", () => {
  assert.equal(backofficeRoleOf(operator("operation_admin")), "operation_admin");
  assert.equal(canUseBackofficeMenu(operator("operation_admin"), "knowledge"), false);
  assert.equal(canUseBackofficeMenu(operator("operation_admin"), "aiTutor"), false);
  assert.equal(canUseBackofficeMenu(operator("operation_admin"), "course"), true);
  assert.equal(canUseBackofficeMenu(operator("finance"), "knowledge"), true);
  assert.equal(canManageBackofficeEmployees(operator("operation_admin")), false);
});

test("inactive operators, students and course authors", () => {
  assert.equal(backofficeRoleOf(operator("admin", "disabled")), null);
  assert.deepEqual(backofficeMenusFor(operator("admin", "disabled")), []);
  const teacher = { id: "t1", role: "teacher" as const, status: "active" as const, email: "t@example.test", emailVerifiedAt: "x" };
  assert.equal(backofficeRoleOf(teacher), null);
  assert.deepEqual(backofficeMenusFor(teacher), ["course"]);
  assert.equal(canUseBackofficeMenu(teacher, "order"), false);
  const student = { ...teacher, role: "student" as const };
  assert.deepEqual(backofficeMenusFor(student), []);
});

test("Knowledge / AI Tutor menu targets are configurable and only allow safe URLs", () => {
  assert.equal(backofficeIntegrationUrl("knowledge", {}), "/knowledge/philosophy/epicureanism/knowledge-wiki");
  assert.equal(backofficeIntegrationUrl("aiTutor", {}), "/knowledge/philosophy/epicureanism/chat-testing");
  assert.equal(backofficeIntegrationUrl("knowledge", { BACKOFFICE_KNOWLEDGE_URL: "https://ks.example.com/admin" }), "https://ks.example.com/admin");
  assert.equal(backofficeIntegrationUrl("aiTutor", { BACKOFFICE_AI_TUTOR_URL: "/agent/console" }), "/agent/console");
  assert.equal(backofficeIntegrationUrl("aiTutor", { BACKOFFICE_AI_TUTOR_URL: "//evil.example" }), "/knowledge/philosophy/epicureanism/chat-testing");
  assert.equal(backofficeIntegrationUrl("aiTutor", { BACKOFFICE_AI_TUTOR_URL: "javascript:alert(1)" }), "/knowledge/philosophy/epicureanism/chat-testing");
  assert.equal(backofficeIntegrationUrl("knowledge", { BACKOFFICE_KNOWLEDGE_URL: "http://plain.example" }), "/knowledge/philosophy/epicureanism/knowledge-wiki");
});
