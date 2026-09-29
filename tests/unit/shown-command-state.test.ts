import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { after, before, test } from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import React from "react";
import { catalogueFilterState, courseLearningOutcomes } from "../../lib/courseDetailPresentation";
import { getMessages } from "../../lib/i18n/messages";
import { defaultPortalContent } from "../../lib/portalContent";
import { categoryHasPublishedCourse, categorySubscribeOffer } from "../../lib/offer";

const originalCwd = process.cwd();
const originalEnv = {
  STORAGE_BACKEND: process.env.STORAGE_BACKEND,
  APP_ENV: process.env.APP_ENV,
  PAYMENT_MODE: process.env.PAYMENT_MODE,
};
let isolatedCwd: string;
let store: typeof import("../../services/productStore");

before(async () => {
  isolatedCwd = await mkdtemp(path.join(tmpdir(), "lg-shown-command-"));
  process.chdir(isolatedCwd);
  process.env.STORAGE_BACKEND = "local";
  process.env.APP_ENV = "DEV";
  process.env.PAYMENT_MODE = "demo";
  store = await import("../../services/productStore");
});

after(async () => {
  process.chdir(originalCwd);
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  if (isolatedCwd && path.dirname(isolatedCwd) === tmpdir()) await rm(isolatedCwd, { recursive: true, force: true });
});

function productFile() {
  return path.join(process.cwd(), "data", "knowledge_system", "learning_guide", "product.json");
}

test("categoryId science is one membership for the stored category, purchase, filter and sidebar", async () => {
  await store.ensureProductData();
  const seeded = JSON.parse(await readFile(productFile(), "utf8")) as { catalogue?: unknown[] };
  seeded.catalogue = [{
    id: "science",
    name: "European Humanities",
    parentId: null,
    status: "active",
    description: "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }];
  await writeFile(productFile(), `${JSON.stringify(seeded, null, 2)}\n`);

  const plans = await store.listPlans();
  const beforePublish = await store.listPublishedCourses();
  assert.equal(categoryHasPublishedCourse(beforePublish, "Science"), false);
  assert.equal(categoryHasPublishedCourse(beforePublish, "Chinese Humanities"), false);
  assert.equal(categorySubscribeOffer(plans, beforePublish, "Science", 6), null);
  assert.equal(categorySubscribeOffer(plans, beforePublish, "Chinese Humanities", 6), null);

  const created = await store.createCourseForOperator({
    title: "Cell biology",
    categoryId: "science",
    category: "European Humanities",
  });
  assert.equal(created.categoryId, "science");
  assert.equal(created.category, "Science");
  await store.addLessonToCourse({ courseId: created.id, title: "Cells", body: "A cell has a membrane.", durationMinutes: 5 });
  const published = await store.setCourseStatus(created.id, "published");
  assert.equal(published.category, "Science");

  const courses = await store.listPublishedCourses();
  const catalogue = await store.listCatalogueEntries();
  const withoutLegacy = courses.map((course) => course.id === created.id ? { ...course, category: undefined } : course);
  const scienceOnly = withoutLegacy.filter((course) => course.id === created.id);
  assert.equal(categoryHasPublishedCourse(scienceOnly, "Science", catalogue), true);
  assert.equal(categoryHasPublishedCourse(scienceOnly, "European Humanities", catalogue), false);
  assert.equal(categoryHasPublishedCourse(withoutLegacy, "European Humanities", catalogue), true);
  const scienceOffer = categorySubscribeOffer(plans, withoutLegacy, "Science", 6, catalogue);
  assert.ok(scienceOffer);
  assert.equal(scienceOffer.scope, "category");
  assert.equal(scienceOffer.planId, "science-pc-6");
  assert.equal(categorySubscribeOffer(plans, withoutLegacy, "Chinese Humanities", 12, catalogue), null);

  const filter = catalogueFilterState({
    requestedCategory: "All",
    courses: withoutLegacy,
    categories: defaultPortalContent.categories,
    catalogue,
    locale: "en-GB",
    allLabel: "All Courses",
  });
  assert.deepEqual(filter.chips.map((chip) => chip.id), ["All", "European Humanities", "Science"]);
  assert.equal(filter.chips.some((chip) => chip.id === "Chinese Humanities"), false);

  const buyer = await store.registerUser({ email: "science-buyer@example.test", password: "password1" });
  await assert.rejects(() => store.createQuote(buyer.id, "chinese-humanities-pc-6"), /no published course/);
  const { quote } = await store.createQuote(buyer.id, "science-pc-6");
  assert.equal(quote.planId, "science-pc-6");
  assert.equal(quote.amountMinor, 3900);

  assert.deepEqual(courseLearningOutcomes(
    { title: "Quintus Horatius Flaccus", categoryId: "european-humanities" },
    { id: "poetry", outcomes: ["Model real biological systems mathematically"] },
    { id: "european-humanities", outcomes: ["用数学建模真实的生物系统"] },
  ), []);
});

test("pricing chips and device copy match the PC plan a purchase commits", async () => {
  const plans = await store.listPlans();
  const courses = (await store.listPublishedCourses()).filter((course) => course.category === "European Humanities");
  const pcPlan = plans.find((plan) => plan.id === "epicureanism-pc-6");
  assert.ok(pcPlan);
  assert.equal(pcPlan.device, "pc");
  const buyer = await store.registerUser({ email: "pc-device-copy@example.test", password: "password1" });
  const { quote } = await store.createQuote(buyer.id, pcPlan.id);
  const pending = await store.createPendingDemoOrder(buyer.id, quote.id);
  await store.completeDemoOrder(buyer.id, pending.order.id);
  const access = await store.checkEntitlement(buyer.id, "epicureanism");
  assert.equal(access.allowed, true);
  assert.equal(access.device, "pc");

  const claimsMobile = /1 PC and 1 mobile|one PC and one mobile|移动设备/;
  (globalThis as { React?: typeof React }).React = React;
  const { PricingPlans } = await import("../../components/portal/PricingPlans");
  for (const locale of ["en-GB", "zh-CN"] as const) {
    const copy = getMessages(locale).pricingDesign;
    const ruleText = copy.rules.map((rule) => rule.text).join(" ");
    assert.equal(claimsMobile.test(copy.devices), false);
    assert.equal(claimsMobile.test(ruleText), false);
    assert.match(locale === "zh-CN" ? copy.devices : copy.devices, locale === "zh-CN" ? /1 台电脑/ : /1 PC/);
    const html = renderToStaticMarkup(createElement(PricingPlans, {
      locale,
      plans,
      courses,
      categories: defaultPortalContent.categories,
      courseTitles: courses.map((course) => ({ category: course.category || "", title: course.title })),
      copy,
    }));
    assert.equal(html.includes("Chinese Humanities"), false);
    assert.equal(html.includes("中国人文"), false);
    assert.equal(html.includes(">Science<"), false);
    assert.equal(html.includes("科学"), false);
    assert.match(html, /European Humanities|欧洲人文/);
    assert.match(html, />Subscribe<|>订阅</);
    assert.equal(claimsMobile.test(html), false);
    assert.match(html, locale === "zh-CN" ? /1 台电脑/ : /1 PC/);
  }
});
