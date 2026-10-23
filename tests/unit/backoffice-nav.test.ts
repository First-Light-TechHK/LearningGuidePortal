import assert from "node:assert/strict";
import { test } from "node:test";
import { backofficeLocaleHref, backofficeNavItems, backofficeSettingsItems, isBackofficeNavActive } from "../../lib/backofficeNav";
import { BACKOFFICE_MENUS } from "../../lib/backofficeRbac";

test("nav items follow the server menus in PRD order with locale hrefs", () => {
  const items = backofficeNavItems("zh-CN", BACKOFFICE_MENUS);
  assert.deepEqual(items.map((item) => item.key), ["course", "knowledge", "aiTutor", "order", "reporting", "student", "helpdesk", "settings"]);
  assert.deepEqual(items.map((item) => item.href), [
    "/zh-CN/backoffice/courses", "/zh-CN/backoffice/knowledge", "/zh-CN/backoffice/ai-tutor", "/zh-CN/backoffice/orders",
    "/zh-CN/backoffice/reporting", "/zh-CN/backoffice/students", "/zh-CN/backoffice/helpdesk", "/zh-CN/backoffice/settings"
  ]);
});

test("course authors only get the Course item", () => {
  assert.deepEqual(backofficeNavItems("en-GB", ["course"]), [{ key: "course", href: "/en-GB/backoffice/courses" }]);
});

test("the active item follows the path owner", () => {
  assert.equal(isBackofficeNavActive("/en-GB/backoffice", "course"), true);
  assert.equal(isBackofficeNavActive("/en-GB/backoffice/courses/abc", "course"), true);
  assert.equal(isBackofficeNavActive("/en-GB/backoffice/orders", "order"), true);
  assert.equal(isBackofficeNavActive("/en-GB/backoffice/payment", "settings"), true);
  assert.equal(isBackofficeNavActive("/en-GB/backoffice/portal", "settings"), true);
  assert.equal(isBackofficeNavActive("/en-GB/backoffice/settings/employees", "settings"), true);
  assert.equal(isBackofficeNavActive("/knowledge/philosophy/epicureanism/chat-testing", "aiTutor"), true);
  assert.equal(isBackofficeNavActive("/knowledge/philosophy/epicureanism/knowledge-wiki", "knowledge"), true);
  assert.equal(isBackofficeNavActive("/knowledge/philosophy/epicureanism/chat-testing", "course"), false);
});

test("locale switching keeps the path; locale-less knowledge pages stay put", () => {
  assert.equal(backofficeLocaleHref("/en-GB/backoffice/portal", "zh-CN"), "/zh-CN/backoffice/portal");
  assert.equal(backofficeLocaleHref("/knowledge/philosophy/epicureanism/chat-testing", "zh-CN"), "/knowledge/philosophy/epicureanism/chat-testing");
});

test("Settings sub-menu lists Employee Account for Admin only", () => {
  assert.deepEqual(backofficeSettingsItems("en-GB", true).map((item) => item.key), ["employees", "paymentGateway", "notifications", "portalContent"]);
  assert.deepEqual(backofficeSettingsItems("en-GB", false).map((item) => item.key), ["paymentGateway", "notifications", "portalContent"]);
});
