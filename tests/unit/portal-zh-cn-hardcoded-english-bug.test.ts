import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import zh from "../../messages/zh-CN.json";
import { elementsByClass, elementsByType, hideAwsCredentials, loadPortalPage, textContent } from "./helpers/portal-page-harness";

// Expected to fail while zh-CN pricing and the courses method band render hardcoded English UI.

const originalCwd = process.cwd();
let isolatedCwd = "";
const ENGLISH_METHOD = ["Apply what you learn", "Share your perspective", "See the bigger picture"];

before(async () => {
  hideAwsCredentials();
  isolatedCwd = await mkdtemp(path.join(tmpdir(), "lg-zh-cn-copy-"));
  process.chdir(isolatedCwd);
});

after(async () => {
  process.chdir(originalCwd);
  if (isolatedCwd) await rm(isolatedCwd, { recursive: true, force: true });
});

test('zh-CN pricing heading must not be the English "Subscription"', async () => {
  const pricing = await loadPortalPage("app/[locale]/pricing/page.tsx", { stubSigning: true });
  const element = await pricing.default({
    params: Promise.resolve({ locale: "zh-CN" }),
    searchParams: Promise.resolve({}),
  } as never);
  const headings = elementsByType(element, "h1");
  assert.ok(textContent(element).includes(zh.pricingDesign.heading), "zh-CN pricing should render messages/zh-CN.json pricingDesign.heading");
  assert.equal(headings.includes("Subscription"), false, `zh-CN pricing visible heading is hardcoded English "Subscription" (h1: ${headings.join(" | ")})`);
});

test("zh-CN courses method band must not contain hardcoded English Apply what you learn / Share your perspective / See the bigger picture", async () => {
  const courses = await loadPortalPage("app/[locale]/portal/courses/page.tsx", { stubSigning: true });
  const element = await courses.default({
    params: Promise.resolve({ locale: "zh-CN" }),
    searchParams: Promise.resolve({}),
  } as never);
  const band = elementsByClass(element, "courses-design-method")[0];
  const text = textContent(band);
  assert.match(text, new RegExp(zh.portal.whyUs.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "zh-CN courses method band should use messages/zh-CN.json portal.whyUs");
  for (const phrase of ENGLISH_METHOD) {
    assert.equal(text.includes(phrase), false, `zh-CN courses method band contains hardcoded English "${phrase}"`);
  }
});
