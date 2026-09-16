import assert from "node:assert/strict";
import { test } from "node:test";
import { backofficeLocaleHref, backofficeNavItems, isBackofficeNavActive } from "../../lib/backofficeNav";

test("teachers only see Course Management in the backoffice nav", () => {
  assert.deepEqual(backofficeNavItems("en-GB", false), [{ href: "/en-GB/backoffice/courses", key: "courses" }]);
});

test("operators get the same nav items on every backoffice page", () => {
  const items = backofficeNavItems("zh-CN", true);
  assert.deepEqual(items.map((item) => item.key), ["courses", "portal", "orders", "payment", "ai"]);
  assert.equal(items[1].href, "/zh-CN/backoffice/portal");
});

test("course nav stays active on the backoffice home redirect target", () => {
  assert.equal(isBackofficeNavActive("/en-GB/backoffice/courses", "/en-GB/backoffice/courses", "courses"), true);
  assert.equal(isBackofficeNavActive("/en-GB/backoffice/portal", "/en-GB/backoffice/courses", "courses"), false);
  assert.equal(isBackofficeNavActive("/en-GB/backoffice/orders", "/en-GB/backoffice/orders", "orders"), true);
});

test("AI settings stays in the operator nav without stealing Course Management", () => {
  assert.equal(isBackofficeNavActive("/knowledge/philosophy/epicureanism/chat-testing", "/knowledge/philosophy/epicureanism/chat-testing", "ai"), true);
  assert.equal(isBackofficeNavActive("/knowledge/philosophy/epicureanism/chat-testing", "/en-GB/backoffice/courses", "courses"), false);
});

test("locale switching keeps a backoffice path and falls back off knowledge URLs", () => {
  assert.equal(backofficeLocaleHref("/en-GB/backoffice/portal", "zh-CN"), "/zh-CN/backoffice/portal");
  assert.equal(backofficeLocaleHref("/knowledge/philosophy/epicureanism/chat-testing", "zh-CN"), "/zh-CN/backoffice/courses");
});
