import { test } from "node:test";
import assert from "node:assert/strict";
import { authNavigationHref } from "../../lib/authNavigation";

test("auth navigation keeps the full source URL in one encoded parameter", () => {
  const href = authNavigationHref("zh-CN", "sign-in", "https://example.test/zh-CN/pricing?plan=science&term=12#plans");
  const parsed = new URL(href, "https://example.test");
  assert.equal(parsed.pathname, "/zh-CN/portal/sign-in");
  assert.equal(parsed.searchParams.get("returnTo"), "/zh-CN/pricing?plan=science&term=12#plans");
  assert.equal([...parsed.searchParams].length, 1);
});

test("switching authentication pages preserves the original destination", () => {
  const href = authNavigationHref("en-GB", "sign-up", "https://example.test/en-GB/portal/sign-in?returnTo=%2Fen-GB%2Fpricing%3Fterm%3D12");
  assert.equal(new URL(href, "https://example.test").searchParams.get("returnTo"), "/en-GB/pricing?term=12");
  assert.equal(new URL(authNavigationHref("en-GB", "sign-in", "https://example.test/en-GB/portal/sign-up"), "https://example.test").searchParams.get("returnTo"), "/en-GB/account/my-learning");
});
