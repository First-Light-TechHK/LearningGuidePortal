import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import en from "../../messages/en-GB.json";
import zh from "../../messages/zh-CN.json";
import {
  categorySubscribeOffer,
  courseSidebarHref,
  courseSidebarOffer,
  pricingCourseOffer,
  pricingPageModel,
  trialConfirmationOffer,
} from "../../lib/offer";
import { registrationContinueHref } from "../../lib/pendingCheckEmail";

const originalCwd = process.cwd();
const originalEnv = {
  STORAGE_BACKEND: process.env.STORAGE_BACKEND,
  APP_ENV: process.env.APP_ENV,
  EMAIL_VERIFICATION_REQUIRED: process.env.EMAIL_VERIFICATION_REQUIRED,
  PAYMENT_MODE: process.env.PAYMENT_MODE,
};
let isolatedCwd: string;
let store: typeof import("../../services/productStore");
let checkEmailPageModel: typeof import("../../services/checkEmailPage").checkEmailPageModel;

const SENT_EN = en.auth.checkEmailDescription;
const SENT_ZH = zh.auth.checkEmailDescription;

before(async () => {
  isolatedCwd = await mkdtemp(path.join(tmpdir(), "lg-offer-pending-"));
  process.chdir(isolatedCwd);
  process.env.STORAGE_BACKEND = "local";
  process.env.APP_ENV = "DEV";
  process.env.PAYMENT_MODE = "demo";
  process.env.EMAIL_VERIFICATION_REQUIRED = "1";
  store = await import("../../services/productStore");
  ({ checkEmailPageModel } = await import("../../services/checkEmailPage"));
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

test("course sidebar, course pricing and trial confirmation are three projections of the offer each command commits", async () => {
  const plans = await store.listPlans();
  const courses = await store.listPublishedCourses();
  const coursePlan = plans.find((plan) => plan.id === "epicureanism-pc-6");
  assert.ok(coursePlan);
  assert.equal(coursePlan.amountMinor, 4900);
  const categoryPlan = plans.find((plan) => plan.id === "european-humanities-pc-6");
  assert.ok(categoryPlan);
  assert.equal(categoryPlan.amountMinor, 6900);

  const sidebar = courseSidebarOffer(plans, courses, "European Humanities");
  const pricing = pricingPageModel({ plans, courses, courseId: "epicureanism" }).course;
  const trial = trialConfirmationOffer(coursePlan);
  assert.ok(sidebar);
  assert.ok(pricing);

  assert.equal(sidebar.scope, "category");
  assert.equal(sidebar.planId, "european-humanities-pc-6");
  assert.equal(sidebar.amountMinor, 6900);
  assert.equal(sidebar.dueNowMinor, 6900);
  assert.equal(sidebar.trial, false);

  assert.equal(pricing.scope, "course");
  assert.equal(pricing.planId, "epicureanism-pc-6");
  assert.equal(pricing.amountMinor, 4900);
  assert.equal(pricing.dueNowMinor, 4900);
  assert.equal(pricing.trial, false);

  assert.equal(trial.scope, "course");
  assert.equal(trial.planId, "epicureanism-pc-6");
  assert.equal(trial.amountMinor, 4900);
  assert.equal(trial.dueNowMinor, 0);
  assert.equal(trial.trial, true);

  const projections = [sidebar, pricing, trial];
  assert.deepEqual(projections.filter((offer) => offer.amountMinor === 6900).map((offer) => offer.scope), ["category"]);
  assert.deepEqual(projections.filter((offer) => offer.amountMinor === 4900).map((offer) => offer.planId), ["epicureanism-pc-6", "epicureanism-pc-6"]);
  assert.notEqual(trial.planId, "european-humanities-pc-6");
  assert.notEqual(trial.amountMinor, 0);
  assert.equal(pricingCourseOffer(plans, "epicureanism")?.planId, pricing.planId);

  const href = courseSidebarHref("en-GB", sidebar);
  assert.match(href, /planId=european-humanities-pc-6/);
  assert.doesNotMatch(href, /courseId=/);
  assert.doesNotMatch(href, /epicureanism-pc-6/);
});

test("a category with no published course cannot be subscribed, and European Humanities still can", async () => {
  const plans = await store.listPlans();
  const courses = await store.listPublishedCourses();
  assert.equal(courses.some((course) => course.category === "Chinese Humanities" && course.status === "published"), false);
  assert.equal(courses.some((course) => course.category === "Science" && course.status === "published"), false);
  assert.equal(courses.some((course) => course.category === "European Humanities" && course.status === "published"), true);

  const model = pricingPageModel({ plans, courses, courseId: "epicureanism" });
  assert.equal(model.categories.find((item) => item.id === "Chinese Humanities")?.subscribe, null);
  assert.equal(model.categories.find((item) => item.id === "Science")?.subscribe, null);
  assert.equal(categorySubscribeOffer(plans, courses, "Chinese Humanities", 6), null);
  assert.equal(categorySubscribeOffer(plans, courses, "Science", 12), null);
  const european = model.categories.find((item) => item.id === "European Humanities")?.subscribe;
  assert.ok(european);
  assert.equal(european.scope, "category");
  assert.equal(european.planId, "european-humanities-pc-6");
  assert.equal(european.amountMinor, 6900);

  const user = await store.registerUser({ email: "buyer@example.test", password: "password1" });
  await assert.rejects(() => store.createQuote(user.id, "chinese-humanities-pc-6"), /no published course/);
  await assert.rejects(() => store.createQuote(user.id, "science-pc-6"), /no published course/);
  await assert.rejects(() => store.createQuote(user.id, "chinese-humanities-pc-12", "trial"), /no published course/);
  const { quote } = await store.createQuote(user.id, "european-humanities-pc-6");
  assert.equal(quote.planId, "european-humanities-pc-6");
  assert.equal(quote.amountMinor, 6900);
  const pending = await store.createPendingDemoOrder(user.id, quote.id);
  assert.equal(pending.order.planId, "european-humanities-pc-6");
  assert.equal(pending.order.amountMinor, 6900);

  const data = JSON.parse(await readFile(productFile(), "utf8")) as { quotes: Array<Record<string, unknown>>; plans: Array<{ id: string }> };
  const illegalPlan = data.plans.find((plan) => plan.id === "chinese-humanities-pc-6");
  assert.ok(illegalPlan);
  data.quotes.unshift({
    id: "quote_illegal_category",
    userId: user.id,
    planId: "chinese-humanities-pc-6",
    amountMinor: 3900,
    currency: "usd",
    kind: "purchase",
    planSnapshot: illegalPlan,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    createdAt: new Date().toISOString(),
  });
  await writeFile(productFile(), `${JSON.stringify(data, null, 2)}\n`);
  await assert.rejects(() => store.createPendingDemoOrder(user.id, "quote_illegal_category"), /no published course/);
});

test("check-email claims a sent activation email only for a committed pending link while verification is required", async () => {
  process.env.APP_ENV = "DEV";
  process.env.EMAIL_VERIFICATION_REQUIRED = "1";
  const pendingEmail = "pending-activation@example.test";
  const { user } = await store.registerUserAttempt({ email: pendingEmail, password: "password1", nickname: "Ava" });
  assert.equal(user.status, "pending");
  await store.issueEmailVerificationToken(user.id);
  const sent = await checkEmailPageModel(pendingEmail, { sent: SENT_EN, idle: en.auth.checkEmailIdle });
  assert.equal(sent.claimsActivationSent, true);
  assert.equal(sent.description, SENT_EN);
  assert.match(sent.description, /sent an activation link/i);

  const sentZh = await checkEmailPageModel(pendingEmail, { sent: SENT_ZH, idle: zh.auth.checkEmailIdle });
  assert.equal(sentZh.claimsActivationSent, true);
  assert.equal(sentZh.description, SENT_ZH);

  const unknown = await checkEmailPageModel("nobody@example.test", { sent: SENT_EN, idle: en.auth.checkEmailIdle });
  assert.equal(unknown.claimsActivationSent, false);
  assert.notEqual(unknown.description, SENT_EN);
  assert.doesNotMatch(unknown.description, /sent an activation link/i);
  assert.doesNotMatch(unknown.description, /已向您的邮箱发送激活链接/);

  process.env.EMAIL_VERIFICATION_REQUIRED = "0";
  const verificationOff = await checkEmailPageModel(pendingEmail, { sent: SENT_EN, idle: en.auth.checkEmailIdle });
  assert.equal(verificationOff.claimsActivationSent, false);
  assert.doesNotMatch(verificationOff.description, /sent an activation link/i);
  assert.doesNotMatch(verificationOff.description, /已向您的邮箱发送激活链接/);

  const activeEmail = "active-no-mail@example.test";
  const registered = await store.registerUserAttempt({ email: activeEmail, password: "password1", nickname: "Bea" });
  const token = await store.issueEmailVerificationToken(registered.user.id);
  await store.verifyEmailToken(token);
  process.env.EMAIL_VERIFICATION_REQUIRED = "0";
  const active = await checkEmailPageModel(activeEmail, { sent: SENT_EN, idle: en.auth.checkEmailIdle });
  assert.equal(active.claimsActivationSent, false);
  assert.doesNotMatch(active.description, /sent an activation link/i);

  const stay = registrationContinueHref({ verificationRequired: false, locale: "en-GB", email: activeEmail, returnTo: "/en-GB/account/my-learning" });
  assert.equal(stay, "/en-GB/account/my-learning");
  assert.doesNotMatch(stay, /check-email/);
  const pendingPath = registrationContinueHref({ verificationRequired: true, locale: "en-GB", email: pendingEmail, returnTo: "/en-GB/account/my-learning" });
  assert.match(pendingPath, /\/en-GB\/portal\/check-email\?email=pending-activation%40example\.test/);
});
