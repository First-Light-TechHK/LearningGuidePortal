import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { defaultLocale, localeFrom, locales } from "../../lib/i18n/config";
import { getMessages } from "../../lib/i18n/messages";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function flattenKeys(value: unknown, prefix = ""): string[] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return prefix ? [prefix] : [];
  }
  return Object.entries(value as Record<string, unknown>).flatMap(([key, nested]) => {
    const next = prefix ? `${prefix}.${key}` : key;
    return flattenKeys(nested, next);
  });
}

test("en-GB and zh-CN UI message files expose the same key set", async () => {
  const en = JSON.parse(await readFile(path.join(repoRoot, "messages/en-GB.json"), "utf8")) as unknown;
  const zh = JSON.parse(await readFile(path.join(repoRoot, "messages/zh-CN.json"), "utf8")) as unknown;
  const enKeys = flattenKeys(en).sort();
  const zhKeys = flattenKeys(zh).sort();
  const onlyEn = enKeys.filter((key) => !zhKeys.includes(key));
  const onlyZh = zhKeys.filter((key) => !enKeys.includes(key));
  assert.deepEqual(onlyEn, [], "zh-CN is missing UI keys present in en-GB");
  assert.deepEqual(onlyZh, [], "en-GB is missing UI keys present in zh-CN");
  assert.equal(enKeys.length, zhKeys.length);
  assert.ok(enKeys.length > 100);
});

test("portal chrome strings exist in both locales and are not copied English for zh-CN", () => {
  assert.deepEqual([...locales], ["en-GB", "zh-CN"]);
  assert.equal(defaultLocale, "en-GB");
  assert.equal(localeFrom("zh-CN"), "zh-CN");
  assert.equal(localeFrom("en-GB"), "en-GB");
  assert.equal(localeFrom("fr-FR"), "en-GB");

  const en = getMessages("en-GB");
  const zh = getMessages("zh-CN");
  assert.equal(en.portal.signIn, "Sign in");
  assert.equal(zh.portal.signIn, "登录");
  assert.notEqual(en.portal.viewCourses, zh.portal.viewCourses);
  assert.notEqual(en.portal.pricingTitle, zh.portal.pricingTitle);
  assert.equal(typeof en.pricingDesign.heading, "string");
  assert.equal(typeof zh.pricingDesign.heading, "string");
  assert.ok(en.pricingDesign.heading.length > 0);
  assert.ok(zh.pricingDesign.heading.length > 0);
});
