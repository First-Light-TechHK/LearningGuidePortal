import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "crypto";
import path from "path";
import { promisify } from "util";
import { atomicWriteJson, ensureDir, now, readBinary, readJson, removeDir, SYSTEM_ROOT, writeBinary } from "./fileStore";
import type { SocialUserInput } from "@/contracts/wechat";
import { isProductionEnvironment, paymentMode } from "./runtimeConfig";
import { configuredStripePrice } from "./stripePrices";
import { defaultPortalContent, type PortalContent } from "@/lib/portalContent";
import {
  accessStateFromSubscriptions,
  courseProgressFromUniqueLearningPoints,
  overviewEmptyState,
  resolveOverviewCard,
  uniqueOpenedLearningPointIds,
} from "@/lib/myLearningOverview";
import { buildCoursePage, emptyFailedCoursePage, type CoursePage } from "@/lib/coursePage";

const scrypt = promisify(scryptCallback);
const PRODUCT_DIR = path.join(SYSTEM_ROOT, "learning_guide");
const PRODUCT_FILE = path.join(PRODUCT_DIR, "product.json");
const QUOTE_MINUTES = 15;
const TRIAL_DAYS = 3;

export type Locale = "en-GB" | "zh-CN";
export type ProductUser = {
  id: string;
  email: string | null;
  passwordHash: string | null;
  nickname: string;
  locale: Locale;
  role: "student" | "operator";
  status: "pending" | "active" | "disabled";
  emailVerifiedAt: string | null;
  avatarPath?: string | null;
  avatarContentType?: string | null;
  country?: string | null;
  ageRange?: string | null;
  education?: string | null;
  areasOfInterest?: string[];
  createdAt: string;
};

export type ProductLesson = {
  id: string;
  title: string;
  body: string;
  durationMinutes: number;
  videoDurationSeconds?: number | null;
  isPublic: boolean;
};

export type ProductSection = { id: string; title: string; lessons: ProductLesson[] };
export type ProductCourse = {
  id: string;
  slug: string;
  title: string;
  description: string;
  category?: "Chinese Humanities" | "European Humanities" | "Science";
  thumbnailPath?: string | null;
  status: "draft" | "published";
  sections: ProductSection[];
  createdAt: string;
  updatedAt: string;
};
export type ProductPlan = {
  id: string;
  courseId: string;
  name: string;
  termMonths: 6 | 12;
  device: "pc" | "mobile";
  amountMinor: number;
  currency: "usd";
  scope?: "category" | "everything" | "course";
  scopeId?: string | null;
  category?: string | null;
  aiPoints?: number;
  trialEligible?: boolean;
};
export type ProductQuote = {
  id: string;
  userId: string;
  planId: string;
  amountMinor: number;
  currency: "usd";
  kind?: "purchase" | "trial" | "upgrade";
  sourceSubscriptionId?: string | null;
  creditMinor?: number;
  expiresAt: string;
  createdAt: string;
};
export type ProductOrder = {
  id: string;
  userId: string;
  planId: string;
  quoteId: string;
  servicePeriodStart?: string | null;
  servicePeriodEnd?: string | null;
  amountMinor: number;
  currency: "usd";
  status: "paid" | "pending" | "failed" | "canceled" | "refunded";
  paymentMode: "demo" | "stripe";
  kind?: "purchase" | "trial_activation" | "upgrade";
  sourceSubscriptionId?: string | null;
  creditMinor?: number;
  stripeCheckoutSessionId?: string | null;
  stripeSubscriptionId?: string | null;
  stripePaymentIntentId?: string | null;
  stripeInvoiceId?: string | null;
  lastStripeStatus?: string | null;
  lastSyncedAt?: string | null;
  exceptionCode?: "processing_too_long" | "status_mismatch" | "event_missing" | "synchronization_failed" | null;
  failureReason?: string | null;
  createdAt: string;
};
export type ProductOrderActivity = { id: string; orderId: string; operatorId: string; action: "refund" | "resynchronise"; result: "succeeded" | "failed" | "processing"; reason: string | null; providerReference: string | null; createdAt: string };
export type ProductSubscription = {
  id: string;
  userId: string;
  planId: string;
  courseId: string;
  state: "active" | "cancel_at_period_end" | "grace" | "expired" | "trial_canceled";
  source: "trial" | "purchase";
  validFrom: string;
  validTo: string;
  cancelAtPeriodEnd: boolean;
  scope?: "course" | "category" | "everything";
  scopeId?: string | null;
  device?: "pc" | "mobile";
  graceEndsAt?: string | null;
  stripeSubscriptionId?: string | null;
  stripeCustomerId?: string | null;
  cancelReasonCode?: "low_usage" | "too_expensive" | "content" | "website" | "other" | null;
  cancelReasonText?: string | null;
};
export type ProductEntitlement = {
  id: string;
  userId: string;
  courseId: string;
  state: "active" | "expired" | "revoked";
  source: "trial" | "purchase";
  validTo: string;
  scope?: "course" | "category" | "everything";
  scopeId?: string | null;
  device?: "pc" | "mobile";
};
export type ProductStudyRecord = {
  id: string;
  userId: string;
  courseId: string;
  startedAt: string;
  updatedAt: string;
  currentLessonId: string | null;
  totalSeconds: number;
  progress: number;
  completedAt: string | null;
};
export type ProductStudyEvent = {
  id: string;
  userId: string;
  courseId: string;
  lessonId: string;
  event: "open" | "video_progress" | "text_progress" | "complete";
  seconds: number;
  clientEventId: string;
  createdAt: string;
};
export type ProductConversationMessage = { role: "user" | "assistant"; content: string; createdAt: string };
export type ProductConversation = {
  id: string;
  userId: string;
  courseId: string;
  lessonId: string | null;
  mode: "lecture" | "socratic";
  messages: ProductConversationMessage[];
  updatedAt: string;
};
export type ProductNotification = {
  id: string;
  userId: string;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
};
export type ProductSession = { id: string; tokenHash: string; userId: string; expiresAt: string; createdAt: string };
export type ProductToken = { id: string; userId: string; tokenHash: string; expiresAt: string; usedAt: string | null; createdAt: string };
export type ProductAccount = { id: string; userId: string; provider: "google" | "wechat"; providerSubject: string; wechatAppId?: string; wechatOpenId?: string; wechatUnionId?: string; createdAt: string };

export class ProductAuthError extends Error {
  constructor(public readonly code: "account_conflict" | "account_disabled" | "account_unavailable", message: string) {
    super(message);
  }
}
export type ProductPaymentSettings = {
  provider: "stripe";
  name: string;
  publishableKey: string;
  returnUrl: string;
  defaultCurrency: "usd";
  paymentNotifications: boolean;
  updatedAt: string | null;
};

export type ProductData = {
  portalContent?: PortalContent;
  version: 1;
  users: ProductUser[];
  sessions: ProductSession[];
  courses: ProductCourse[];
  plans: ProductPlan[];
  quotes: ProductQuote[];
  orders: ProductOrder[];
  subscriptions: ProductSubscription[];
  entitlements: ProductEntitlement[];
  studyRecords: ProductStudyRecord[];
  studyEvents: ProductStudyEvent[];
  conversations: ProductConversation[];
  notifications: ProductNotification[];
  stripeEvents: Array<{ id: string; type: string; processedAt: string }>;
  verificationTokens: ProductToken[];
  passwordResetTokens: ProductToken[];
  paymentSettings: ProductPaymentSettings;
  orderActivities: ProductOrderActivity[];
  accounts: ProductAccount[];
};

function id(prefix: string) {
  return `${prefix}_${Date.now()}_${randomBytes(4).toString("hex")}`;
}

function addMonths(iso: string, months: number) {
  const date = new Date(iso);
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.toISOString();
}

function defaultCourse(): ProductCourse {
  const time = now();
  return {
    id: "epicureanism",
    slug: "epicureanism",
    title: "Epicureanism",
    description: "A guided introduction to pleasure, desire, friendship and the Epicurean argument about death.",
    category: "European Humanities",
    thumbnailPath: null,
    status: "published",
    createdAt: time,
    updatedAt: time,
    sections: [
      {
        id: "foundations",
        title: "Foundations",
        lessons: [
          {
            id: "pleasure-and-the-good-life",
            title: "Pleasure and the Good Life",
            durationMinutes: 25,
            isPublic: true,
            body: `Epicurus does not use pleasure to mean luxury or constant stimulation. In the Letter to Menoeceus, pleasure is the starting point and the end of a happy life, but the practical question is which pleasures are worth choosing. A pleasure may be refused when it brings greater trouble later.

For Epicurus, the stable condition matters: freedom from bodily pain (aponia) and mental disturbance (ataraxia). Simple food, friendship, safety and clear judgement can therefore be more valuable than an expensive or intense experience.

The useful question is not “How much pleasure can I obtain?” but “What will this choice do to my future freedom from pain and fear?” This is a course explanation, not a claim that every later interpretation agrees with Epicurus.

Try the distinction: an intense experience can feel pleasant now while creating anxiety later; a modest choice can be less exciting but contribute to a stable life.`,
          },
          {
            id: "death-is-nothing-to-us",
            title: "Why Death Is Nothing to Us",
            durationMinutes: 20,
            isPublic: false,
            body: `Epicurus argues that death is nothing to us because good and bad depend on experience, while death is the absence of experience. The argument is more than the short statement that a dead person cannot feel pain: it also asks what it would mean for a harm to belong to someone who no longer exists as a perceiving subject.

Keep this claim separate from the later deprivation objection. The course can present Epicurus' own position first and then compare it with the view that death is bad because it removes future goods.`,
          },
        ],
      },
    ],
  };
}

function defaultData(): ProductData {
  return {
    version: 1,
    users: [],
    sessions: [],
    courses: [defaultCourse()],
    plans: [
      { id: "epicureanism-pc-6", courseId: "epicureanism", name: "Epicureanism · PC · 6 months", termMonths: 6, device: "pc", amountMinor: 4900, currency: "usd", scope: "course", scopeId: "epicureanism", category: "European Humanities", aiPoints: 1000, trialEligible: true },
      { id: "epicureanism-pc-12", courseId: "epicureanism", name: "Epicureanism · PC · 12 months", termMonths: 12, device: "pc", amountMinor: 7900, currency: "usd", scope: "course", scopeId: "epicureanism", category: "European Humanities", aiPoints: 2200, trialEligible: true },
      { id: "european-humanities-pc-6", courseId: "*", name: "European Humanities · PC · 6 months", termMonths: 6, device: "pc", amountMinor: 6900, currency: "usd", scope: "category", scopeId: "European Humanities", category: "European Humanities", aiPoints: 3000, trialEligible: true },
      { id: "european-humanities-pc-12", courseId: "*", name: "European Humanities · PC · 12 months", termMonths: 12, device: "pc", amountMinor: 10900, currency: "usd", scope: "category", scopeId: "European Humanities", category: "European Humanities", aiPoints: 6500, trialEligible: true },
      { id: "everything-pc-6", courseId: "*", name: "Everything · PC · 6 months", termMonths: 6, device: "pc", amountMinor: 9900, currency: "usd", scope: "everything", scopeId: "*", category: null, aiPoints: 10000, trialEligible: true },
      { id: "everything-pc-12", courseId: "*", name: "Everything · PC · 12 months", termMonths: 12, device: "pc", amountMinor: 15900, currency: "usd", scope: "everything", scopeId: "*", category: null, aiPoints: 10000, trialEligible: true },
      { id: "everything-mobile-6", courseId: "*", name: "Everything · Mobile · 6 months", termMonths: 6, device: "mobile", amountMinor: 3900, currency: "usd", scope: "everything", scopeId: "*", category: null, aiPoints: 0, trialEligible: false },
      { id: "everything-mobile-12", courseId: "*", name: "Everything · Mobile · 12 months", termMonths: 12, device: "mobile", amountMinor: 5900, currency: "usd", scope: "everything", scopeId: "*", category: null, aiPoints: 0, trialEligible: false },
    ],
    quotes: [],
    orders: [],
    subscriptions: [],
    entitlements: [],
    studyRecords: [],
    studyEvents: [],
    conversations: [],
    notifications: [],
    stripeEvents: [],
    verificationTokens: [],
    passwordResetTokens: [],
    paymentSettings: defaultPaymentSettings(),
    orderActivities: [],
    accounts: [],
  };
}

function defaultPaymentSettings(): ProductPaymentSettings {
  return {
    provider: "stripe",
    name: "Stripe",
    publishableKey: "",
    returnUrl: "",
    defaultCurrency: "usd",
    paymentNotifications: true,
    updatedAt: null,
  };
}

type NormalisedPlanScope = { scope: "course" | "category" | "everything"; scopeId: string | null };

function planScope(plan: ProductPlan): NormalisedPlanScope {
  if (plan.scope === "category") return { scope: "category", scopeId: plan.scopeId || plan.category || null };
  if (plan.scope === "everything" || plan.courseId === "*") return { scope: "everything", scopeId: "*" };
  return { scope: "course", scopeId: plan.scopeId || plan.courseId };
}

function planCoversCourse(plan: ProductPlan, course: ProductCourse) {
  const scope = planScope(plan);
  if (scope.scope === "everything") return true;
  if (scope.scope === "category") return scope.scopeId === course.category;
  return scope.scopeId === course.id;
}

function entitlementCoversCourse(entitlement: ProductEntitlement, course: ProductCourse) {
  const scope = entitlement.scope || (entitlement.courseId === "*" ? "everything" : "course");
  if (scope === "everything") return true;
  if (scope === "category") return (entitlement.scopeId || null) === course.category;
  return (entitlement.scopeId || entitlement.courseId) === course.id;
}

function entitlementForPlan(userId: string, plan: ProductPlan, source: ProductEntitlement["source"], validTo: string): ProductEntitlement {
  const scope = planScope(plan);
  return { id: id("entitlement"), userId, courseId: plan.courseId, state: "active", source, validTo, scope: scope.scope, scopeId: scope.scopeId, device: plan.device };
}

function subscriptionForPlan(userId: string, plan: ProductPlan, source: ProductSubscription["source"], validFrom: string, validTo: string, extra: Partial<ProductSubscription> = {}): ProductSubscription {
  const scope = planScope(plan);
  return { id: id("subscription"), userId, planId: plan.id, courseId: plan.courseId, state: "active", source, validFrom, validTo, cancelAtPeriodEnd: false, scope: scope.scope, scopeId: scope.scopeId, device: plan.device, ...extra };
}

function entitlementOverlapsPlan(data: ProductData, entitlement: ProductEntitlement, plan: ProductPlan) {
  return data.courses.some((course) => planCoversCourse(plan, course) && entitlementCoversCourse(entitlement, course));
}

function scopedValue(item: { courseId: string; scope?: ProductEntitlement["scope"] | ProductSubscription["scope"]; scopeId?: string | null }) {
  if (item.scope === "category") return { scope: "category" as const, scopeId: item.scopeId || null };
  if (item.scope === "everything" || item.courseId === "*") return { scope: "everything" as const, scopeId: "*" };
  return { scope: "course" as const, scopeId: item.scopeId || item.courseId };
}

function sameScope(left: { courseId: string; scope?: ProductEntitlement["scope"]; scopeId?: string | null }, right: { courseId: string; scope?: ProductSubscription["scope"]; scopeId?: string | null }) {
  const a = scopedValue(left);
  const b = scopedValue(right);
  return a.scope === b.scope && a.scopeId === b.scopeId;
}

function entitlementMatchesSubscription(entitlement: ProductEntitlement, subscription: ProductSubscription) {
  return entitlement.userId === subscription.userId && entitlement.source === subscription.source && sameScope(entitlement, subscription);
}

async function saveData(data: ProductData) {
  await ensureDir(PRODUCT_DIR);
  await atomicWriteJson(PRODUCT_FILE, data);
}

let editQueue = Promise.resolve();

export async function ensureProductData() {
  const current = await readJson<ProductData | null>(PRODUCT_FILE, null);
  if (current?.version === 1) {
    if (!current.stripeEvents) current.stripeEvents = [];
    if (!current.verificationTokens) current.verificationTokens = [];
    if (!current.passwordResetTokens) current.passwordResetTokens = [];
    if (!current.paymentSettings) current.paymentSettings = defaultPaymentSettings();
    if (!current.orderActivities) current.orderActivities = [];
    if (!current.accounts) current.accounts = [];
    current.users.forEach((user) => { user.areasOfInterest ||= []; });
    current.courses.forEach((course) => { course.category ||= "European Humanities"; course.thumbnailPath ??= null; });
    current.plans.forEach((plan) => {
      if (plan.id.startsWith("epicureanism-pc-")) {
        plan.scope = "course";
        plan.scopeId = plan.courseId;
      } else if (plan.courseId === "*") {
        plan.scope ||= "everything";
        plan.scopeId ||= "*";
      } else {
        plan.scope ||= "course";
        plan.scopeId ||= plan.courseId;
      }
      if (plan.scope === "category") plan.scopeId ||= plan.category || "European Humanities";
      plan.category ??= plan.scope === "category" ? plan.scopeId : null;
      plan.trialEligible ??= plan.device === "pc";
      plan.aiPoints ??= plan.device === "mobile" ? 0 : plan.scope === "everything" ? 10000 : 1000;
    });
    const seededPlans = defaultData().plans;
    seededPlans.forEach((seededPlan) => {
      if (!current.plans.some((plan) => plan.id === seededPlan.id)) current.plans.push(seededPlan);
    });
    return current;
  }
  const seeded = defaultData();
  await saveData(seeded);
  return seeded;
}

async function editData<T>(mutator: (data: ProductData) => Promise<T> | T) {
  const operation = editQueue.then(async () => {
    const data = await ensureProductData();
    const result = await mutator(data);
    await saveData(data);
    return result;
  });
  editQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function validateNickname(value: string) {
  if (!/^[A-Za-z0-9 ]{2,30}$/.test(value)) throw new Error("Name must be 2-30 English letters, numbers or spaces.");
  return value;
}

async function passwordHash(password: string) {
  const salt = randomBytes(16).toString("hex");
  const key = await scrypt(password, salt, 64) as Buffer;
  return `scrypt$${salt}$${Buffer.from(key).toString("hex")}`;
}

async function passwordMatches(password: string, stored: string | null) {
  if (!stored) return false;
  const [, salt, value] = stored.split("$");
  if (!salt || !value) return false;
  const actual = await scrypt(password, salt, 64) as Buffer;
  const expected = Buffer.from(value, "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function publicUser(user: ProductUser) {
  return { id: user.id, email: user.email, nickname: user.nickname, locale: user.locale, role: user.role || "student", status: user.status, emailVerifiedAt: user.emailVerifiedAt, country: user.country || null, ageRange: user.ageRange || null, education: user.education || null, areasOfInterest: user.areasOfInterest || [] };
}

export function isOperator(user: ProductUser) {
  const configuredEmail = process.env.BACKOFFICE_OPERATOR_EMAIL?.trim().toLowerCase();
  return user.role === "operator" || Boolean(configuredEmail && user.email === configuredEmail);
}

export async function getUserById(userId: string) {
  const data = await ensureProductData();
  return data.users.find((user) => user.id === userId) || null;
}

export async function getActiveUserByEmail(emailValue: string) {
  const email = emailValue.trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) return null;
  const data = await ensureProductData();
  return data.users.find((user) => user.email === email && user.status === "active") || null;
}

export async function getPortalContent(): Promise<PortalContent> {
  return (await ensureProductData()).portalContent || defaultPortalContent;
}

export async function savePortalContent(value: unknown): Promise<PortalContent> {
  if (!value || typeof value !== "object") throw new Error("Invalid portal content.");
  const content = value as PortalContent;
  function validUrl(value: unknown, optional = false) {
    if (optional && value === "") return true;
    if (typeof value !== "string" || value.length > 2048 || /[\\\\\s]/.test(value)) return false;
    if (value.startsWith("/") && !value.startsWith("//")) return true;
    try { return new URL(value).protocol === "https:"; } catch { return false; }
  }
  for (const locale of ["en-GB", "zh-CN"] as const) {
    const banners = content.banners?.[locale];
    if (!Array.isArray(banners) || banners.length !== 3) throw new Error("Exactly three banners are required for each language.");
    for (const banner of banners) {
      if (!banner || !validUrl(banner.image) || !validUrl(banner.href)) throw new Error("Banner URLs must be relative paths or HTTPS URLs.");
      for (const key of ["eyebrow", "title", "text", "cta"] as const) {
        if (typeof banner[key] !== "string" || banner[key].length > 500 || !banner[key].trim()) throw new Error("Complete every banner text field (maximum 500 characters).");
      }
    }
  }
  const expected = defaultPortalContent.categories.map((item) => item.id);
  if (!Array.isArray(content.categories) || content.categories.length !== 3 || new Set(content.categories.map((item) => item.id)).size !== 3 ||
      content.categories.some((item) => !expected.includes(item.id) || ["en-GB", "zh-CN"].some((locale) => typeof item.labels?.[locale as Locale] !== "string" || !item.labels[locale as Locale].trim() || item.labels[locale as Locale].length > 80))) throw new Error("Provide one translated label for each supported category.");
  if (!Array.isArray(content.countries) || !content.countries.length || content.countries.length > 300 || content.countries.some((item) => typeof item !== "string" || !item.trim() || item.length > 80)) throw new Error("Provide a valid country list.");
  if (!validUrl(content.supportUrl, true)) throw new Error("Support URL must be a relative path or HTTPS URL.");
  return editData((data) => {
    data.portalContent = { banners: content.banners, categories: content.categories, countries: [...new Set(content.countries)], supportUrl: content.supportUrl };
    return data.portalContent;
  });
}

export async function userEmailExists(emailValue: string) {
  const email = emailValue.trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) return false;
  const data = await ensureProductData();
  return data.users.some((user) => user.email === email && ["pending", "active"].includes(user.status));
}

export async function registerUser(input: { email: string; password: string; locale?: Locale; nickname?: string }) {
  const email = input.email.trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error("Enter a valid email address.");
  if (input.password.length < 8) throw new Error("Password must contain at least 8 characters.");
  const nickname = validateNickname(input.nickname?.trim() || "Learner");
  return editData(async (data) => {
    const existing = data.users.find((user) => user.email === email);
    if (existing?.status === "active" || existing?.status === "disabled") throw new Error("An account with this email already exists.");
    if (existing) {
      existing.passwordHash = await passwordHash(input.password);
      existing.nickname = nickname;
      existing.locale = input.locale === "zh-CN" ? "zh-CN" : "en-GB";
      existing.emailVerifiedAt = null;
      return { ...existing, email };
    }
    const user: ProductUser = {
      id: id("user"),
      email,
      passwordHash: await passwordHash(input.password),
      nickname,
      locale: input.locale === "zh-CN" ? "zh-CN" : "en-GB",
      role: process.env.BACKOFFICE_OPERATOR_EMAIL?.trim().toLowerCase() === email ? "operator" : "student",
      status: "pending",
      emailVerifiedAt: null,
      createdAt: now(),
    };
    data.users.push(user);
    return { ...user, email };
  });
}

export async function getOrCreateSocialUser(input: SocialUserInput) {
  const email = input.provider === "wechat" ? null : input.email?.trim().toLowerCase() || null;
  if (input.provider === "google" && (!email || !/^\S+@\S+\.\S+$/.test(email))) throw new Error("The provider did not return a usable email address.");
  return editData(async (data) => {
    let account = data.accounts.find((item) => item.provider === input.provider && item.providerSubject === input.providerSubject);
    if (input.provider === "wechat" && input.wechat) {
      const { appId, openId, unionId } = input.wechat;
      if (input.providerSubject !== `${appId}:${openId}`) throw new ProductAuthError("account_unavailable", "Invalid provider identity.");
      // Migrate only legacy unscoped subjects proven by the current provider response.
      const legacy = data.accounts.filter((item) => item.provider === "wechat" && !item.wechatAppId &&
        (item.providerSubject === openId || (unionId && item.providerSubject === unionId)));
      const matches = [...new Set([...(account ? [account] : []), ...legacy])];
      if (matches.length > 1) throw new ProductAuthError("account_conflict", "Provider identity requires account review.");
      account = matches[0];
      if (account) {
        account.providerSubject = input.providerSubject;
        account.wechatAppId = appId;
        account.wechatOpenId = openId;
        if (unionId) account.wechatUnionId = unionId;
      }
    }
    if (account) {
      const user = data.users.find((item) => item.id === account.userId);
      if (!user) throw new ProductAuthError("account_unavailable", "This account is not available.");
      if (user.status === "disabled") throw new ProductAuthError("account_disabled", "This account has been disabled.");
      if (user.status !== "active") throw new ProductAuthError("account_unavailable", "This account is not available.");
      if (input.provider === "wechat" && user.email?.startsWith("wechat-") && user.email.endsWith("@local.invalid")) {
        user.email = null;
        user.emailVerifiedAt = null;
      }
      if (email && user.email !== email && !data.users.some((item) => item.id !== user.id && item.email === email)) user.email = email;
      return user;
    }
    const emailUser = email ? data.users.find((item) => item.email === email) : null;
    if (emailUser) {
      // The Google profile has already passed verified-email validation. It can
      // therefore be attached to an existing active or pending email account,
      // including an account that was originally created through Google
      // without a password. A pending email account becomes active here because
      // Google's verified identity proves control of the same address. Disabled
      // and WeChat accounts still require the explicit conflict path.
      if (input.provider === "google" && (emailUser.status === "active" || emailUser.status === "pending") && (emailUser.status === "pending" || emailUser.emailVerifiedAt)) {
        emailUser.status = "active";
        emailUser.emailVerifiedAt ||= now();
        data.accounts.push({ id: id("account"), userId: emailUser.id, provider: input.provider, providerSubject: input.providerSubject, createdAt: now() });
        return emailUser;
      }
      throw new ProductAuthError("account_conflict", `An account already uses this email. Sign in with that account before linking ${input.provider === "google" ? "Google" : "WeChat"}.`);
    }
    const nickname = input.nickname && /^[A-Za-z0-9 ]{2,30}$/.test(input.nickname.trim()) ? input.nickname.trim() : "Learner";
    const user: ProductUser = { id: id("user"), email, passwordHash: null, nickname, locale: input.locale === "zh-CN" ? "zh-CN" : "en-GB", role: input.provider === "google" && process.env.BACKOFFICE_OPERATOR_EMAIL?.trim().toLowerCase() === email ? "operator" : "student", status: "active", emailVerifiedAt: email ? now() : null, createdAt: now() };
    data.users.push(user);
    data.accounts.push({ id: id("account"), userId: user.id, provider: input.provider, providerSubject: input.providerSubject, wechatAppId: input.wechat?.appId, wechatOpenId: input.wechat?.openId, wechatUnionId: input.wechat?.unionId, createdAt: now() });
    data.notifications.unshift({ id: id("notification"), userId: user.id, title: "Welcome to Learning Guide", body: "Your account is ready. Start with the public lesson or activate the trial.", readAt: null, createdAt: now() });
    return user;
  });
}

// Binds a social provider identity to an existing email-and-password account.
// Only allowed when the signed-in user's email matches the verified provider
// email, so a provider login can never take over another account.
export async function linkSocialProvider(input: { userId: string; provider: "google" | "wechat"; providerSubject: string; email: string }) {
  const email = input.email.trim().toLowerCase();
  return editData(async (data) => {
    const user = data.users.find((item) => item.id === input.userId);
    if (!user || user.status !== "active" || !user.emailVerifiedAt) throw new ProductAuthError("account_unavailable", "This account is not available.");
    if (user.email !== email) throw new ProductAuthError("account_conflict", "The provider email does not match the signed-in account.");
    const existing = data.accounts.find((item) => item.provider === input.provider && item.providerSubject === input.providerSubject);
    if (existing) {
      if (existing.userId === input.userId) return user;
      throw new ProductAuthError("account_conflict", `This ${input.provider === "google" ? "Google" : "WeChat"} identity is already linked to another Learning Guide account.`);
    }
    data.accounts.push({ id: id("account"), userId: user.id, provider: input.provider, providerSubject: input.providerSubject, createdAt: now() });
    return user;
  });
}

export async function socialProvidersForUser(userId: string): Promise<Array<"google" | "wechat">> {
  const data = await ensureProductData();
  return data.accounts.filter((item) => item.userId === userId).map((item) => item.provider);
}

function tokenExpiry(hours: number) {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

async function issueToken(collection: "verificationTokens" | "passwordResetTokens", userId: string, enforceCooldown = false) {
  const rawToken = randomBytes(32).toString("base64url");
  await editData((data) => {
    const issuedAt = now();
    const latest = data[collection].find((item) => item.userId === userId);
    if (enforceCooldown && latest && Date.now() - new Date(latest.createdAt).getTime() < 60_000) {
      throw new Error("Please wait before requesting another verification email.");
    }
    for (const item of data[collection]) {
      if (item.userId === userId && !item.usedAt) item.usedAt = issuedAt;
    }
    data[collection].unshift({ id: id(collection === "verificationTokens" ? "verify" : "reset"), userId, tokenHash: hashToken(rawToken), expiresAt: tokenExpiry(collection === "verificationTokens" ? 24 : 1), usedAt: null, createdAt: issuedAt });
  });
  return rawToken;
}

export async function issueEmailVerificationToken(userId: string, enforceCooldown = false) {
  return issueToken("verificationTokens", userId, enforceCooldown);
}

export async function requestEmailVerification(emailValue: string) {
  const email = emailValue.trim().toLowerCase();
  const data = await ensureProductData();
  const user = data.users.find((item) => item.email === email && item.status === "pending");
  if (!user?.email) return { accepted: true as const, user: null, token: null };
  return { accepted: true as const, user: { ...user, email: user.email }, token: await issueEmailVerificationToken(user.id, true) };
}

export async function verifyEmailToken(rawToken: string) {
  return editData((data) => {
    const token = data.verificationTokens.find((item) => item.tokenHash === hashToken(rawToken) && !item.usedAt && new Date(item.expiresAt) > new Date());
    if (!token) throw new Error("This verification link is invalid or has expired.");
    const user = data.users.find((item) => item.id === token.userId);
    if (!user) throw new Error("User not found.");
    token.usedAt = now();
    user.emailVerifiedAt = now();
    user.status = "active";
    for (const item of data.verificationTokens) {
      if (item.userId === user.id && !item.usedAt) item.usedAt = token.usedAt;
    }
    if (!data.notifications.some((item) => item.userId === user.id && item.title === "Welcome to Learning Guide")) {
      data.notifications.unshift({ id: id("notification"), userId: user.id, title: "Welcome to Learning Guide", body: "Your account is ready. Start with the public lesson or activate the trial.", readAt: null, createdAt: now() });
    }
    return user;
  });
}

export async function requestPasswordReset(emailValue: string) {
  const email = emailValue.trim().toLowerCase();
  const data = await ensureProductData();
  // A Google-created account has no password initially. Its verified provider
  // email is sufficient to request a reset and establish email/password login.
  const user = data.users.find((item) => item.email === email && item.status === "active" && item.emailVerifiedAt);
  if (!user) return { accepted: true, token: null };
  return { accepted: true, token: await issueToken("passwordResetTokens", user.id) };
}

export async function resetPassword(rawToken: string, newPassword: string) {
  if (newPassword.length < 8) throw new Error("Password must contain at least 8 characters.");
  return editData(async (data) => {
    const token = data.passwordResetTokens.find((item) => item.tokenHash === hashToken(rawToken) && !item.usedAt && new Date(item.expiresAt) > new Date());
    if (!token) throw new Error("This password reset link is invalid or has expired.");
    const user = data.users.find((item) => item.id === token.userId);
    if (!user) throw new Error("User not found.");
    token.usedAt = now();
    user.passwordHash = await passwordHash(newPassword);
    data.sessions = data.sessions.filter((session) => session.userId !== user.id);
    return user;
  });
}

export async function updateUserProfile(input: { userId: string; nickname: string; locale: Locale; country?: string | null; ageRange?: string | null; education?: string | null; areasOfInterest?: string[]; currentPassword?: string; newPassword?: string }) {
  return editData(async (data) => {
    const user = data.users.find((item) => item.id === input.userId);
    if (!user) throw new Error("User not found.");
    user.nickname = validateNickname(input.nickname.trim());
    user.locale = input.locale;
    user.country = input.country?.trim() || null;
    user.ageRange = input.ageRange?.trim() || null;
    user.education = input.education?.trim() || null;
    user.areasOfInterest = [...new Set((input.areasOfInterest || []).map((item) => item.trim()).filter(Boolean))].slice(0, 5);
    if (input.newPassword !== undefined && input.newPassword !== "") {
      if (input.newPassword.length < 8) throw new Error("New password must contain at least 8 characters.");
      if (!input.currentPassword || !(await passwordMatches(input.currentPassword, user.passwordHash))) throw new Error("Current password is incorrect.");
      user.passwordHash = await passwordHash(input.newPassword);
    }
    return user;
  });
}

export async function saveUserAvatar(userId: string, buffer: Buffer, contentType: "image/jpeg" | "image/png" | "image/webp") {
  const extension = contentType === "image/jpeg" ? "jpg" : contentType === "image/png" ? "png" : "webp";
  const avatarPath = `avatars/${userId}.${extension}`;
  const user = await getUserById(userId);
  if (!user) throw new Error("User not found.");
  if (user.avatarPath && user.avatarPath !== avatarPath) await removeDir(path.join(PRODUCT_DIR, user.avatarPath));
  await writeBinary(path.join(PRODUCT_DIR, avatarPath), buffer);
  return editData((data) => {
    const current = data.users.find((item) => item.id === userId);
    if (!current) throw new Error("User not found.");
    current.avatarPath = avatarPath;
    current.avatarContentType = contentType;
    return current;
  });
}

export async function removeUserAvatar(userId: string) {
  const user = await getUserById(userId);
  if (!user) throw new Error("User not found.");
  if (user.avatarPath) await removeDir(path.join(PRODUCT_DIR, user.avatarPath));
  return editData((data) => {
    const current = data.users.find((item) => item.id === userId);
    if (!current) throw new Error("User not found.");
    current.avatarPath = null;
    current.avatarContentType = null;
    return current;
  });
}

export async function getUserAvatar(userId: string) {
  const user = await getUserById(userId);
  if (!user?.avatarPath || !user.avatarContentType) return null;
  try { return { buffer: await readBinary(path.join(PRODUCT_DIR, user.avatarPath)), contentType: user.avatarContentType }; } catch { return null; }
}

export async function authenticateUser(emailValue: string, password: string) {
  const data = await ensureProductData();
  const user = data.users.find((item) => item.email === emailValue.trim().toLowerCase());
  if (!user || !(await passwordMatches(password, user.passwordHash))) throw new Error("Email or password is incorrect.");
  if (user.status === "pending" || !user.emailVerifiedAt) throw new Error("Verify your email address before signing in.");
  if (user.status !== "active") throw new Error("This account is not available.");
  return user;
}

export async function createSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const session: ProductSession = { id: id("session"), tokenHash: hashToken(token), userId, expiresAt: addMonths(now(), 1), createdAt: now() };
  await editData((data) => {
    data.sessions = data.sessions.filter((item) => new Date(item.expiresAt) > new Date());
    data.sessions.push(session);
  });
  return { token, expiresAt: session.expiresAt };
}

export async function getUserBySessionToken(token: string | undefined) {
  if (!token) return null;
  const data = await ensureProductData();
  const session = data.sessions.find((item) => item.tokenHash === hashToken(token) && new Date(item.expiresAt) > new Date());
  if (!session) return null;
  return data.users.find((user) => user.id === session.userId && user.status === "active" && (Boolean(user.emailVerifiedAt) || data.accounts.some((account) => account.userId === user.id && account.provider === "wechat"))) || null;
}

export async function deleteSession(token: string | undefined) {
  if (!token) return;
  await editData((data) => { data.sessions = data.sessions.filter((item) => item.tokenHash !== hashToken(token)); });
}

export async function listPublishedCourses() {
  const data = await ensureProductData();
  return data.courses.filter((course) => course.status === "published");
}

export async function getProductCourse(slug: string) {
  const data = await ensureProductData();
  return data.courses.find((course) => course.slug === slug || course.id === slug) || null;
}

/** D1 Course page view: identity, syllabus access, CTA bands, unique-LP progress. */
export async function getCoursePage(slug: string, userId?: string | null): Promise<CoursePage> {
  if (!userId) {
    const data = await ensureProductData();
    const course = data.courses.find((item) => item.slug === slug || item.id === slug) || null;
    return buildCoursePage({
      course,
      hasLiveEntitlement: false,
      accessEnded: false,
      accessState: "none",
      openedLessonIds: [],
      completedLessonIds: [],
    });
  }

  return editData((data) => {
    const currentTime = new Date();
    data.entitlements.forEach((entitlement) => {
      if (entitlement.state === "active" && new Date(entitlement.validTo) <= currentTime) entitlement.state = "expired";
    });
    data.subscriptions.forEach((subscription) => {
      if (["active", "cancel_at_period_end", "grace"].includes(subscription.state) && new Date(subscription.validTo) <= currentTime) {
        subscription.state = "expired";
      }
    });

    const course = data.courses.find((item) => item.slug === slug || item.id === slug) || null;
    if (!course) return emptyFailedCoursePage();

    const entitlement = activeEntitlement(data, userId, course.id);
    const subscriptions = data.subscriptions.filter((item) => item.userId === userId);
    const accessState = accessStateFromSubscriptions(subscriptions);
    const courseEvents = data.studyEvents.filter((event) => event.userId === userId && event.courseId === course.id);
    const openedLessonIds = uniqueOpenedLearningPointIds(courseEvents);
    const completedLessonIds = [...new Set(courseEvents.filter((event) => event.event === "complete").map((event) => event.lessonId))];
    const accessEnded = data.entitlements.some((item) => item.userId === userId && (item.state === "expired" || item.state === "revoked") && entitlementCoversCourse(item, course));

    return buildCoursePage({
      course,
      hasLiveEntitlement: Boolean(entitlement),
      accessEnded,
      accessState,
      openedLessonIds,
      completedLessonIds,
    });
  });
}

export function publicFirstLesson(course: ProductCourse) {
  return course.sections.flatMap((section) => section.lessons).find((lesson) => lesson.isPublic) || null;
}

export async function listPlans(courseId?: string) {
  const data = await ensureProductData();
  return data.plans.filter((plan) => {
    if (paymentMode() === "stripe" && process.env.STRIPE_SANDBOX === "1" && !configuredStripePrice(plan.id)) return false;
    const scope = planScope(plan);
    if (courseId) return plan.device === "pc" && scope.scope === "course" && scope.scopeId === courseId;
    return (plan.device === "pc" && ["course", "category", "everything"].includes(scope.scope)) || (plan.device === "mobile" && scope.scope === "everything");
  });
}

export async function syncSandboxStripePlans(plans: ProductPlan[]) {
  if (isProductionEnvironment() || process.env.STRIPE_SANDBOX !== "1" || process.env.STORAGE_BACKEND !== "local" || !process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_")) {
    throw new Error("Catalogue synchronisation is restricted to local Stripe sandbox storage.");
  }
  return editData(data => {
    const changed = new Set<string>();
    for (const plan of plans) {
      const existing = data.plans.find(item => item.id === plan.id);
      if (!existing || existing.amountMinor !== plan.amountMinor || existing.currency !== plan.currency) changed.add(plan.id);
      if (existing) Object.assign(existing, plan);
      else data.plans.push(plan);
    }
    for (const quote of data.quotes) {
      if (changed.has(quote.planId)) quote.expiresAt = now();
    }
    return { plans: plans.length, changed: [...changed] };
  });
}

export async function getPaymentSettings() {
  const data = await ensureProductData();
  return { ...data.paymentSettings, secretConfigured: Boolean(process.env.STRIPE_SECRET_KEY?.trim()) };
}

export async function updatePaymentSettings(input: { name: string; publishableKey: string; returnUrl: string; paymentNotifications: boolean }) {
  return editData((data) => {
    const name = input.name.trim();
    const publishableKey = input.publishableKey.trim();
    const returnUrl = input.returnUrl.trim();
    if (!name) throw new Error("Payment Gateway Name is required.");
    if (returnUrl && !/^https:\/\//i.test(returnUrl) && isProductionEnvironment()) throw new Error("Production redirect URLs must use HTTPS.");
    data.paymentSettings = { provider: "stripe", name, publishableKey, returnUrl, defaultCurrency: "usd", paymentNotifications: Boolean(input.paymentNotifications), updatedAt: now() };
    return { ...data.paymentSettings, secretConfigured: Boolean(process.env.STRIPE_SECRET_KEY?.trim()) };
  });
}

function activeEntitlement(data: ProductData, userId: string, courseId: string) {
  const course = data.courses.find((item) => item.id === courseId);
  const entitlement = course ? data.entitlements.find((item) => item.userId === userId && item.state === "active" && entitlementCoversCourse(item, course)) : null;
  if (!entitlement) return null;
  if (new Date(entitlement.validTo) <= new Date()) {
    entitlement.state = "expired";
    return null;
  }
  return entitlement;
}

export async function checkEntitlement(userId: string, courseId: string) {
  const data = await ensureProductData();
  const entitlement = activeEntitlement(data, userId, courseId);
  return entitlement ? { allowed: true, source: entitlement.source, validTo: entitlement.validTo } : { allowed: false, source: null, validTo: null };
}

function grantTrialAccess(data: ProductData, userId: string, plan: ProductPlan) {
  if (!plan.trialEligible || plan.device !== "pc") throw new Error("This plan does not include a trial.");
  const course = data.courses.find((item) => item.status === "published" && planCoversCourse(plan, item));
  if (!course) throw new Error("Course is not available.");
  const existing = activeEntitlement(data, userId, course.id);
  const currentTrial = data.subscriptions.find((item) => item.userId === userId && item.planId === plan.id && item.source === "trial" && new Date(item.validTo) > new Date());
  if (currentTrial && existing) {
    const entitlement = data.entitlements.find((item) => item.userId === userId && item.source === "trial" && item.validTo === currentTrial.validTo) || null;
    return { subscription: currentTrial, entitlement };
  }
  if (existing && !currentTrial) throw new Error("This plan already has active access.");
  const previousTrial = data.subscriptions.find((item) => item.userId === userId && item.planId === plan.id && item.source === "trial");
  if (previousTrial) {
    if (new Date(previousTrial.validTo) <= new Date()) {
      previousTrial.state = "expired";
      throw new Error("The three-day trial has ended.");
    }
    previousTrial.state = "active";
    const previousEntitlement = data.entitlements.find((item) => item.userId === userId && item.source === "trial" && item.validTo === previousTrial.validTo);
    if (previousEntitlement) {
      previousEntitlement.state = "active";
      return { subscription: previousTrial, entitlement: previousEntitlement };
    }
  }
  const validFrom = now();
  const trialEnd = new Date(validFrom);
  trialEnd.setUTCDate(trialEnd.getUTCDate() + TRIAL_DAYS);
  const subscription = subscriptionForPlan(userId, plan, "trial", validFrom, trialEnd.toISOString());
  const entitlement = entitlementForPlan(userId, plan, "trial", subscription.validTo);
  data.subscriptions.unshift(subscription);
  data.entitlements.unshift(entitlement);
  data.notifications.unshift({ id: id("notification"), userId, title: "Trial activated", body: `${course.title} is available for ${TRIAL_DAYS} days.`, readAt: null, createdAt: now() });
  return { subscription, entitlement };
}

export async function activateTrial(userId: string, courseId: string) {
  return editData((data) => {
    const plan = data.plans.find((item) => item.courseId === courseId && planScope(item).scope === "course" && item.device === "pc");
    if (!plan) throw new Error("Trial plan not found.");
    return grantTrialAccess(data, userId, plan).entitlement;
  });
}

export async function createQuote(userId: string, planId: string, kind: "purchase" | "trial" = "purchase") {
  return editData((data) => {
    const plan = data.plans.find((item) => item.id === planId);
    if (!plan) throw new Error("Plan not found.");
    const createdAt = now();
    const expiresAt = new Date(Date.now() + QUOTE_MINUTES * 60_000).toISOString();
    if (kind === "trial" && (!plan.trialEligible || plan.device !== "pc")) throw new Error("This plan does not include a trial.");
    const quote: ProductQuote = { id: id("quote"), userId, planId, amountMinor: kind === "trial" ? 0 : plan.amountMinor, currency: plan.currency, kind, expiresAt, createdAt };
    data.quotes.unshift(quote);
    return { quote, plan };
  });
}

function upgradeCalculation(data: ProductData, userId: string, subscriptionId: string) {
  const source = data.subscriptions.find((item) => item.id === subscriptionId && item.userId === userId);
  if (!source || source.source !== "purchase" || source.scope !== "category" || source.device !== "pc" || source.state !== "active" || new Date(source.validTo) <= new Date()) {
    throw new Error("Only an active PC category subscription can be upgraded.");
  }
  const sourcePlan = data.plans.find((item) => item.id === source.planId);
  if (!sourcePlan) throw new Error("The current subscription plan could not be found.");
  const target = data.plans.find((item) => item.scope === "everything" && item.device === "pc" && item.termMonths === sourcePlan.termMonths);
  if (!target) throw new Error("The matching PC Everything plan could not be found.");
  if (data.subscriptions.some((item) => item.userId === userId && item.scope === "everything" && item.device === "pc" && ["active", "cancel_at_period_end", "grace"].includes(item.state))) {
    throw new Error("You already have PC Everything access.");
  }
  const paidOrder = data.orders.filter(item => item.userId === userId && item.planId === source.planId && item.status === "paid" && item.kind !== "trial_activation"
    && (source.stripeSubscriptionId ? item.stripeSubscriptionId === source.stripeSubscriptionId : !item.stripeSubscriptionId))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (!paidOrder) throw new Error("The source subscription payment could not be verified.");
  const creditMinor = paidOrder.amountMinor;
  const amountMinor = target.amountMinor - creditMinor;
  if (amountMinor <= 0) throw new Error("The Everything price must be greater than the amount paid for the source Category.");
  return { source, sourcePlan, target, creditMinor, amountMinor };
}

export async function createUpgradeQuote(userId: string, subscriptionId: string) {
  return editData((data) => {
    const calculation = upgradeCalculation(data, userId, subscriptionId);
    const createdAt = now();
    const quote: ProductQuote = {
      id: id("quote"),
      userId,
      planId: calculation.target.id,
      amountMinor: calculation.amountMinor,
      currency: calculation.target.currency,
      kind: "upgrade",
      sourceSubscriptionId: subscriptionId,
      creditMinor: calculation.creditMinor,
      expiresAt: new Date(Date.now() + QUOTE_MINUTES * 60_000).toISOString(),
      createdAt
    };
    data.quotes.unshift(quote);
    return { quote, plan: calculation.target, sourcePlan: calculation.sourcePlan };
  });
}

export async function getQuoteForUser(userId: string, quoteId: string) {
  const data = await ensureProductData();
  const quote = data.quotes.find((item) => item.id === quoteId && item.userId === userId);
  if (!quote || new Date(quote.expiresAt) <= new Date()) return null;
  const plan = data.plans.find((item) => item.id === quote.planId);
  const source = quote.kind === "upgrade" ? data.subscriptions.find(item => item.id === quote.sourceSubscriptionId && item.userId === userId) : undefined;
  const sourcePlan = source ? data.plans.find(item => item.id === source.planId) : undefined;
  return plan ? { quote, plan, sourceSubscription: source, sourcePlan } : null;
}

export async function completeDemoCheckout(userId: string, quoteId: string) {
  return editData((data) => {
    const quote = data.quotes.find((item) => item.id === quoteId && item.userId === userId);
    if (!quote || new Date(quote.expiresAt) <= new Date()) throw new Error("This quote has expired. Please calculate the price again.");
    const plan = data.plans.find((item) => item.id === quote.planId);
    if (!plan) throw new Error("Plan not found.");
    let order = data.orders.find((item) => item.userId === userId && item.quoteId === quote.id && item.paymentMode === "demo" && item.kind === "purchase");
    if (!order) {
      order = { id: id("order"), userId, planId: plan.id, quoteId: quote.id, amountMinor: quote.amountMinor, currency: quote.currency, status: "pending", paymentMode: "demo", kind: "purchase", stripeCheckoutSessionId: null, stripeSubscriptionId: null, stripePaymentIntentId: null, createdAt: now() };
      data.orders.unshift(order);
    }
    if (order.status === "paid") {
      const subscription = data.subscriptions.find((item) => item.userId === userId && item.planId === plan.id && item.source === "purchase" && item.state !== "expired");
      const entitlement = data.entitlements.find((item) => item.userId === userId && item.state === "active" && entitlementOverlapsPlan(data, item, plan));
      if (subscription && entitlement) return { order, subscription, entitlement };
    }
    return fulfilDemoPurchase(data, userId, order, plan);
  });
}

function fulfilDemoPurchase(data: ProductData, userId: string, order: ProductOrder, plan: ProductPlan) {
    if (order.status === "paid") {
      const subscription = data.subscriptions.find((item) => item.userId === userId && item.planId === plan.id && item.source === "purchase" && item.state !== "expired");
      const entitlement = data.entitlements.find((item) => item.userId === userId && item.state === "active" && entitlementOverlapsPlan(data, item, plan));
      if (subscription && entitlement) return { order, subscription, entitlement };
    }
    if (!["pending", "paid"].includes(order.status)) throw new Error("This payment attempt cannot be completed.");
    order.status = "paid";
    order.failureReason = null;
    const validFrom = now();
    const subscription = subscriptionForPlan(userId, plan, "purchase", validFrom, addMonths(validFrom, plan.termMonths), { stripeSubscriptionId: null });
    order.servicePeriodStart = subscription.validFrom;
    order.servicePeriodEnd = subscription.validTo;
    const entitlement = entitlementForPlan(userId, plan, "purchase", subscription.validTo);
    data.subscriptions.unshift(subscription);
    data.subscriptions.forEach((item) => { if (item.userId === userId && item.source === "trial" && item.state === "active" && item.planId === plan.id) item.state = "expired"; });
    data.entitlements.forEach((item) => {
      if (item.userId === userId && item.source === "trial" && item.state === "active" && entitlementOverlapsPlan(data, item, plan)) item.state = "expired";
    });
    data.entitlements = data.entitlements.filter((item) => !(item.userId === userId && item.state === "active" && entitlementOverlapsPlan(data, item, plan)));
    data.entitlements.unshift(entitlement);
    data.notifications.unshift({ id: id("notification"), userId, title: "Purchase complete", body: "Your course access is now available in My Learning.", readAt: null, createdAt: now() });
    return { order, subscription, entitlement };
}

function fulfilUpgrade(data: ProductData, userId: string, order: ProductOrder, targetPlan: ProductPlan) {
  const sourceId = order.sourceSubscriptionId;
  if (!sourceId) throw new Error("The source subscription is missing.");
  if (order.status === "paid") {
    const existing = data.subscriptions.find((item) => item.userId === userId && item.planId === targetPlan.id && item.source === "purchase" && item.state !== "expired");
    const entitlement = data.entitlements.find((item) => item.userId === userId && item.source === "purchase" && item.state === "active" && item.scope === "everything");
    if (existing && entitlement) return { order, subscription: existing, entitlement };
  }
  const calculation = upgradeCalculation(data, userId, sourceId);
  if (calculation.target.id !== targetPlan.id || calculation.amountMinor !== order.amountMinor) throw new Error("The upgrade quote is no longer valid. Please calculate the price again.");
  if (!(["pending", "paid"] as string[]).includes(order.status)) throw new Error("This upgrade payment attempt cannot be completed.");
  const source = data.subscriptions.find((item) => item.id === sourceId && item.userId === userId);
  if (!source) throw new Error("The source subscription could not be found.");
  source.state = "expired";
  source.cancelAtPeriodEnd = true;
  data.entitlements.forEach((item) => {
    if (item.userId === userId && item.state === "active" && entitlementMatchesSubscription(item, source)) item.state = "expired";
  });
  order.status = "paid";
  order.failureReason = null;
  const validFrom = now();
  const subscription = subscriptionForPlan(userId, targetPlan, "purchase", validFrom, source.validTo, { stripeSubscriptionId: order.stripeSubscriptionId || null });
  order.servicePeriodStart = subscription.validFrom;
  order.servicePeriodEnd = subscription.validTo;
  const entitlement = entitlementForPlan(userId, targetPlan, "purchase", subscription.validTo);
  data.subscriptions.unshift(subscription);
  data.entitlements.unshift(entitlement);
  data.notifications.unshift({ id: id("notification"), userId, title: "Subscription upgraded", body: "Your PC Everything access is now available.", readAt: null, createdAt: now() });
  return { order, subscription, entitlement };
}

export async function createPendingDemoOrder(userId: string, quoteId: string) {
  return editData((data) => {
    const quote = data.quotes.find((item) => item.id === quoteId && item.userId === userId);
    if (!quote || new Date(quote.expiresAt) <= new Date()) throw new Error("This quote has expired. Please calculate the price again.");
    if (quote.kind !== "purchase") throw new Error("This quote must use its matching checkout flow.");
    const plan = data.plans.find((item) => item.id === quote.planId);
    if (!plan) throw new Error("Plan not found.");
    const existing = data.orders.find((item) => item.userId === userId && item.quoteId === quote.id && item.paymentMode === "demo" && item.kind === "purchase" && ["pending", "paid"].includes(item.status));
    if (existing) return { order: existing, plan };
    const order: ProductOrder = { id: id("order"), userId, planId: plan.id, quoteId: quote.id, amountMinor: quote.amountMinor, currency: quote.currency, status: "pending", paymentMode: "demo", kind: "purchase", stripeCheckoutSessionId: null, stripeSubscriptionId: null, stripePaymentIntentId: null, createdAt: now() };
    data.orders.unshift(order);
    return { order, plan };
  });
}

export async function createPendingDemoUpgradeOrderFromQuote(userId: string, quoteId: string) {
  return editData((data) => {
    const quote = data.quotes.find((item) => item.id === quoteId && item.userId === userId);
    if (!quote || quote.kind !== "upgrade" || new Date(quote.expiresAt) <= new Date()) throw new Error("This upgrade quote has expired. Please calculate the price again.");
    const plan = data.plans.find((item) => item.id === quote.planId);
    if (!plan) throw new Error("Plan not found.");
    const existing = data.orders.find((item) => item.userId === userId && item.quoteId === quote.id && item.paymentMode === "demo" && item.kind === "upgrade" && ["pending", "paid"].includes(item.status));
    if (existing) return { order: existing, plan };
    const order: ProductOrder = { id: id("order"), userId, planId: plan.id, quoteId: quote.id, amountMinor: quote.amountMinor, currency: quote.currency, status: "pending", paymentMode: "demo", kind: "upgrade", sourceSubscriptionId: quote.sourceSubscriptionId || null, creditMinor: quote.creditMinor || 0, stripeCheckoutSessionId: null, stripeSubscriptionId: null, stripePaymentIntentId: null, createdAt: now() };
    data.orders.unshift(order);
    return { order, plan };
  });
}

export async function completeDemoOrder(userId: string, orderId: string) {
  return editData((data) => {
    const order = data.orders.find((item) => item.id === orderId && item.userId === userId && item.paymentMode === "demo" && ["purchase", "upgrade"].includes(item.kind || ""));
    if (!order) throw new Error("Payment order not found.");
    const plan = data.plans.find((item) => item.id === order.planId);
    if (!plan) throw new Error("Plan not found.");
    return order.kind === "upgrade" ? fulfilUpgrade(data, userId, order, plan) : fulfilDemoPurchase(data, userId, order, plan);
  });
}

export async function completeDemoUpgradeOrder(userId: string, orderId: string) {
  return completeDemoOrder(userId, orderId);
}

export async function completeStripeUpgradeOrder(userId: string, orderId: string) {
  return editData((data) => {
    const order = data.orders.find((item) => item.id === orderId && item.userId === userId && item.paymentMode === "stripe" && item.kind === "upgrade");
    if (!order) throw new Error("Upgrade order not found.");
    const plan = data.plans.find((item) => item.id === order.planId);
    if (!plan) throw new Error("Plan not found.");
    return fulfilUpgrade(data, userId, order, plan);
  });
}

function pendingTrialOrder(data: ProductData, userId: string, plan: ProductPlan, paymentMode: "demo" | "stripe", suppliedQuote?: ProductQuote) {
  if (!plan.trialEligible || plan.device !== "pc") throw new Error("This plan does not include a trial.");
  const course = data.courses.find((item) => item.status === "published" && planCoversCourse(plan, item));
  if (!course) throw new Error("Course is not available.");
  const existing = data.orders.find((item) => item.userId === userId && item.planId === plan.id && item.paymentMode === paymentMode && item.kind === "trial_activation" && ["pending", "paid"].includes(item.status));
  if (existing) return { order: existing, plan };
  if (data.courses.some((item) => item.status === "published" && planCoversCourse(plan, item) && activeEntitlement(data, userId, item.id))) throw new Error("This plan already has active access.");
  if (data.subscriptions.some((item) => item.userId === userId && item.planId === plan.id && item.source === "trial")) throw new Error("The three-day trial has already been used for this plan.");
  const createdAt = now();
  const quote = suppliedQuote || { id: id("trial_quote"), userId, planId: plan.id, amountMinor: 0, currency: plan.currency, kind: "trial" as const, expiresAt: new Date(Date.now() + QUOTE_MINUTES * 60_000).toISOString(), createdAt };
  if (quote.kind !== "trial") throw new Error("This quote is not a trial quote.");
  if (!suppliedQuote) data.quotes.unshift(quote);
  const order: ProductOrder = { id: id("order"), userId, planId: plan.id, quoteId: quote.id, amountMinor: 0, currency: plan.currency, status: "pending", paymentMode, kind: "trial_activation", stripeCheckoutSessionId: null, stripeSubscriptionId: null, stripePaymentIntentId: null, createdAt };
  data.orders.unshift(order);
  return { order, plan };
}

export async function createPendingDemoTrialOrder(userId: string, planId: string, courseId?: string) {
  return editData((data) => {
    const plan = data.plans.find((item) => item.id === planId) || data.plans.find((item) => !planId && item.courseId === courseId);
    if (!plan) throw new Error("Plan not found.");
    return pendingTrialOrder(data, userId, plan, "demo");
  });
}

export async function createPendingDemoTrialOrderFromQuote(userId: string, quoteId: string) {
  return editData((data) => {
    const quote = data.quotes.find((item) => item.id === quoteId && item.userId === userId);
    if (!quote || quote.kind !== "trial" || new Date(quote.expiresAt) <= new Date()) throw new Error("This trial quote has expired. Please calculate the price again.");
    const plan = data.plans.find((item) => item.id === quote.planId);
    if (!plan) throw new Error("Plan not found.");
    return pendingTrialOrder(data, userId, plan, "demo", quote);
  });
}

export async function completeDemoTrialOrder(userId: string, orderId: string) {
  return editData((data) => {
    const order = data.orders.find((item) => item.id === orderId && item.userId === userId && item.paymentMode === "demo" && item.kind === "trial_activation");
    if (!order) throw new Error("Trial order not found.");
    const plan = data.plans.find((item) => item.id === order.planId);
    if (!plan) throw new Error("Plan not found.");
    if (!["pending", "paid"].includes(order.status)) throw new Error("This trial payment attempt cannot be completed.");
    const result = grantTrialAccess(data, userId, plan);
    order.status = "paid";
    order.failureReason = null;
    return { order, subscription: result.subscription, entitlement: result.entitlement };
  });
}

export async function updateDemoOrderStatus(userId: string, orderId: string, status: "failed" | "canceled", reason: string) {
  return editData((data) => {
    const order = data.orders.find((item) => item.id === orderId && item.userId === userId && item.paymentMode === "demo");
    if (!order) throw new Error("Payment order not found.");
    if (order.status === "paid") throw new Error("A completed payment cannot be changed here.");
    if (order.status === "pending") {
      order.status = status;
      order.failureReason = reason;
    }
    return order;
  });
}

export async function createPendingStripeOrder(userId: string, quoteId: string) {
  return editData((data) => {
    const quote = data.quotes.find((item) => item.id === quoteId && item.userId === userId);
    if (!quote || new Date(quote.expiresAt) <= new Date()) throw new Error("This quote has expired. Please calculate the price again.");
    if (quote.kind !== "purchase") throw new Error("This quote must use its matching checkout flow.");
    const plan = data.plans.find((item) => item.id === quote.planId);
    if (!plan) throw new Error("Plan not found.");
    const existing = data.orders.find((item) => item.userId === userId && item.quoteId === quote.id && ["pending", "paid"].includes(item.status));
    if (existing) return { order: existing, plan };
    const order: ProductOrder = { id: id("order"), userId, planId: plan.id, quoteId: quote.id, amountMinor: quote.amountMinor, currency: quote.currency, status: "pending", paymentMode: "stripe", kind: "purchase", stripeCheckoutSessionId: null, stripeSubscriptionId: null, stripePaymentIntentId: null, createdAt: now() };
    data.orders.unshift(order);
    return { order, plan };
  });
}

export async function createPendingStripeUpgradeOrderFromQuote(userId: string, quoteId: string) {
  return editData((data) => {
    const quote = data.quotes.find((item) => item.id === quoteId && item.userId === userId);
    if (!quote || quote.kind !== "upgrade" || new Date(quote.expiresAt) <= new Date()) throw new Error("This upgrade quote has expired. Please calculate the price again.");
    const plan = data.plans.find((item) => item.id === quote.planId);
    if (!plan) throw new Error("Plan not found.");
    const existing = data.orders.find((item) => item.userId === userId && item.quoteId === quote.id && item.paymentMode === "stripe" && item.kind === "upgrade" && ["pending", "paid"].includes(item.status));
    if (existing) return { order: existing, plan };
    const order: ProductOrder = { id: id("order"), userId, planId: plan.id, quoteId: quote.id, amountMinor: quote.amountMinor, currency: quote.currency, status: "pending", paymentMode: "stripe", kind: "upgrade", sourceSubscriptionId: quote.sourceSubscriptionId || null, creditMinor: quote.creditMinor || 0, stripeCheckoutSessionId: null, stripeSubscriptionId: null, stripePaymentIntentId: null, createdAt: now() };
    data.orders.unshift(order);
    return { order, plan };
  });
}

export async function createPendingStripeTrialOrder(userId: string, planId: string) {
  return editData((data) => {
    const plan = data.plans.find((item) => item.id === planId);
    if (!plan) throw new Error("Plan not found.");
    return pendingTrialOrder(data, userId, plan, "stripe");
  });
}

export async function createPendingStripeTrialOrderFromQuote(userId: string, quoteId: string) {
  return editData((data) => {
    const quote = data.quotes.find((item) => item.id === quoteId && item.userId === userId);
    if (!quote || quote.kind !== "trial" || new Date(quote.expiresAt) <= new Date()) throw new Error("This trial quote has expired. Please calculate the price again.");
    const plan = data.plans.find((item) => item.id === quote.planId);
    if (!plan) throw new Error("Plan not found.");
    return pendingTrialOrder(data, userId, plan, "stripe", quote);
  });
}

export async function activateStripeTrial(input: { eventId?: string; eventType?: string; orderId: string; sessionId: string; subscriptionId: string; customerId?: string | null }) {
  return editData((data) => {
    const order = data.orders.find((item) => item.id === input.orderId && item.kind === "trial_activation");
    if (!order) throw new Error("Trial order not found.");
    if (input.eventId && data.stripeEvents.some((item) => item.id === input.eventId)) return order;
    if (order.status === "paid") return order;
    if (input.eventId) data.stripeEvents.unshift({ id: input.eventId, type: input.eventType || "checkout.session.completed", processedAt: now() });
    const plan = data.plans.find((item) => item.id === order.planId);
    if (!plan) throw new Error("Plan not found.");
    const validFrom = now();
    const trialEnd = new Date(validFrom);
    trialEnd.setUTCDate(trialEnd.getUTCDate() + TRIAL_DAYS);
    order.status = "paid";
    order.stripeCheckoutSessionId = input.sessionId;
    order.stripeSubscriptionId = input.subscriptionId;
    const subscription = subscriptionForPlan(order.userId, plan, "trial", validFrom, trialEnd.toISOString(), { stripeSubscriptionId: input.subscriptionId, stripeCustomerId: input.customerId || null, graceEndsAt: null });
    const entitlement = entitlementForPlan(order.userId, plan, "trial", subscription.validTo);
    data.subscriptions.unshift(subscription);
    data.entitlements = data.entitlements.filter((item) => !(item.userId === order.userId && item.state === "active" && entitlementOverlapsPlan(data, item, plan)));
    data.entitlements.unshift(entitlement);
    data.notifications.unshift({ id: id("notification"), userId: order.userId, title: "Trial activated", body: `${plan.name} is available for ${TRIAL_DAYS} days.`, readAt: null, createdAt: now() });
    return order;
  });
}

export async function convertStripeTrial(input: { subscriptionId: string; invoiceId: string; amountMinor: number; paymentIntentId?: string | null }) {
  return editData((data) => {
    const trial = data.subscriptions.find((item) => item.stripeSubscriptionId === input.subscriptionId && item.source === "trial" && item.state !== "expired");
    if (!trial) return null;
    const plan = data.plans.find((item) => item.id === trial.planId);
    if (!plan) throw new Error("Plan not found.");
    trial.state = "expired";
    const trialEntitlement = data.entitlements.find((item) => entitlementMatchesSubscription(item, trial) && item.state === "active");
    if (trialEntitlement) trialEntitlement.state = "expired";
    const validFrom = now();
    const subscription = subscriptionForPlan(trial.userId, plan, "purchase", validFrom, addMonths(validFrom, plan.termMonths), { stripeSubscriptionId: input.subscriptionId, stripeCustomerId: trial.stripeCustomerId || null, graceEndsAt: null });
    const order: ProductOrder = { id: id("order"), userId: trial.userId, planId: plan.id, quoteId: `invoice_${input.invoiceId}`, amountMinor: input.amountMinor, currency: plan.currency, servicePeriodStart: subscription.validFrom, servicePeriodEnd: subscription.validTo, status: "paid", paymentMode: "stripe", kind: "purchase", stripeCheckoutSessionId: null, stripeSubscriptionId: input.subscriptionId, stripePaymentIntentId: input.paymentIntentId || null, stripeInvoiceId: input.invoiceId, lastStripeStatus: "paid", lastSyncedAt: now(), createdAt: now() };
    const entitlement = entitlementForPlan(trial.userId, plan, "purchase", subscription.validTo);
    data.subscriptions.unshift(subscription);
    data.entitlements = data.entitlements.filter((item) => !(item.userId === trial.userId && item.state === "active" && entitlementOverlapsPlan(data, item, plan)));
    data.entitlements.unshift(entitlement);
    data.orders.unshift(order);
    data.notifications.unshift({ id: id("notification"), userId: trial.userId, title: "Subscription active", body: "Your trial has converted and course access continues.", readAt: null, createdAt: now() });
    return order;
  });
}

export async function applyStripePaidInvoice(input: { subscriptionId: string; invoiceId: string; amountMinor: number; paymentIntentId?: string | null; currentPeriodStart?: string | null; currentPeriodEnd?: string | null }) {
  return editData((data) => {
    const paidOrder = data.orders.find((order) => order.stripeInvoiceId === input.invoiceId);
    if (paidOrder) return paidOrder;
    const subscription = data.subscriptions.find((item) => item.stripeSubscriptionId === input.subscriptionId && item.source === "purchase");
    if (!subscription) return null;
    const plan = data.plans.find((item) => item.id === subscription.planId);
    if (!plan) throw new Error("Plan not found.");
    const start = input.currentPeriodStart || now();
    const end = input.currentPeriodEnd || addMonths(start, plan.termMonths);
    subscription.state = "active";
    subscription.cancelAtPeriodEnd = false;
    subscription.validFrom = start;
    subscription.validTo = end;
    subscription.graceEndsAt = null;
    const entitlement = data.entitlements.find((item) => entitlementMatchesSubscription(item, subscription) && item.state === "active");
    if (entitlement) entitlement.validTo = end;
    const initialOrder = data.orders.find((order) => order.stripeSubscriptionId === input.subscriptionId && order.kind === "purchase" && !order.stripeInvoiceId);
    if (initialOrder) {
      initialOrder.stripeInvoiceId = input.invoiceId;
      initialOrder.servicePeriodStart = start;
      initialOrder.servicePeriodEnd = end;
      initialOrder.stripePaymentIntentId = input.paymentIntentId || initialOrder.stripePaymentIntentId || null;
      initialOrder.lastStripeStatus = "paid";
      initialOrder.lastSyncedAt = now();
      return initialOrder;
    }
    const order: ProductOrder = { id: id("order"), userId: subscription.userId, planId: plan.id, quoteId: `invoice_${input.invoiceId}`, amountMinor: input.amountMinor, currency: plan.currency, servicePeriodStart: start, servicePeriodEnd: end, status: "paid", paymentMode: "stripe", kind: "purchase", stripeCheckoutSessionId: null, stripeSubscriptionId: input.subscriptionId, stripePaymentIntentId: input.paymentIntentId || null, stripeInvoiceId: input.invoiceId, lastStripeStatus: "paid", lastSyncedAt: now(), createdAt: now() };
    data.orders.unshift(order);
    data.notifications.unshift({ id: id("notification"), userId: subscription.userId, title: "Subscription renewed", body: "Your subscription payment was successful and course access continues.", readAt: null, createdAt: now() });
    return order;
  });
}

export async function markStripeTrialGrace(subscriptionId: string) {
  return editData((data) => {
    const subscription = data.subscriptions.find((item) => item.stripeSubscriptionId === subscriptionId && item.source === "trial" && item.state !== "expired");
    if (!subscription) return null;
    if (subscription.state === "grace") return subscription;
    const graceEnd = new Date();
    graceEnd.setUTCDate(graceEnd.getUTCDate() + TRIAL_DAYS);
    subscription.state = "grace";
    subscription.graceEndsAt = graceEnd.toISOString();
    subscription.validTo = graceEnd.toISOString();
    const entitlement = data.entitlements.find((item) => entitlementMatchesSubscription(item, subscription) && item.state === "active");
    if (entitlement) entitlement.validTo = subscription.validTo;
    data.notifications.unshift({ id: id("notification"), userId: subscription.userId, title: "Payment requires attention", body: "Your course access remains available while payment is resolved.", readAt: null, createdAt: now() });
    return subscription;
  });
}

export async function markStripeSubscriptionGrace(subscriptionId: string) {
  return editData((data) => {
    const subscription = data.subscriptions.find((item) => item.stripeSubscriptionId === subscriptionId && item.source === "purchase" && item.state !== "expired");
    if (!subscription) return null;
    if (subscription.state === "grace") return subscription;
    const graceEnd = new Date();
    graceEnd.setUTCDate(graceEnd.getUTCDate() + TRIAL_DAYS);
    subscription.state = "grace";
    subscription.graceEndsAt = graceEnd.toISOString();
    subscription.validTo = graceEnd.toISOString();
    const entitlement = data.entitlements.find((item) => entitlementMatchesSubscription(item, subscription) && item.state === "active");
    if (entitlement) entitlement.validTo = subscription.validTo;
    data.notifications.unshift({ id: id("notification"), userId: subscription.userId, title: "Payment requires attention", body: "Your course access remains available while payment is resolved.", readAt: null, createdAt: now() });
    return subscription;
  });
}

export async function attachStripeCheckoutSession(userId: string, orderId: string, sessionId: string) {
  return editData((data) => {
    const order = data.orders.find((item) => item.id === orderId && item.userId === userId);
    if (!order) throw new Error("Order not found.");
    order.stripeCheckoutSessionId = sessionId;
    return order;
  });
}

function grantPurchaseAccess(data: ProductData, userId: string, plan: ProductPlan, amountMinor: number, quoteId: string, stripeCheckoutSessionId?: string, stripeSubscriptionId?: string, stripeCustomerId?: string, stripePaymentIntentId?: string) {
  let order = data.orders.find((item) => item.id === quoteId || item.stripeCheckoutSessionId === stripeCheckoutSessionId);
  if (!order) order = data.orders.find((item) => item.userId === userId && item.quoteId === quoteId);
  if (!order) throw new Error("Order not found.");
  if (order.status === "paid") return order;
  order.status = "paid";
  order.amountMinor = amountMinor;
  order.paymentMode = "stripe";
  order.stripeCheckoutSessionId = stripeCheckoutSessionId || order.stripeCheckoutSessionId || null;
  order.stripeSubscriptionId = stripeSubscriptionId || order.stripeSubscriptionId || null;
  order.stripePaymentIntentId = stripePaymentIntentId || order.stripePaymentIntentId || null;
  const validFrom = now();
  const subscription = subscriptionForPlan(userId, plan, "purchase", validFrom, addMonths(validFrom, plan.termMonths), { stripeSubscriptionId: stripeSubscriptionId || null, stripeCustomerId: stripeCustomerId || null });
  order.servicePeriodStart = subscription.validFrom;
  order.servicePeriodEnd = subscription.validTo;
  const entitlement = entitlementForPlan(userId, plan, "purchase", subscription.validTo);
  data.subscriptions.unshift(subscription);
  const trial = data.subscriptions.find((item) => item.userId === userId && item.planId === plan.id && item.source === "trial" && item.state === "active");
  if (trial) trial.state = "expired";
  data.entitlements.forEach((item) => {
    if (item.userId === userId && item.source === "trial" && item.state === "active" && entitlementOverlapsPlan(data, item, plan)) item.state = "expired";
  });
  data.entitlements = data.entitlements.filter((item) => !(item.userId === userId && item.state === "active" && entitlementOverlapsPlan(data, item, plan)));
  data.entitlements.unshift(entitlement);
  data.notifications.unshift({ id: id("notification"), userId, title: "Purchase complete", body: "Your course access is now available in My Learning.", readAt: null, createdAt: now() });
  return order;
}

export async function fulfilStripeCheckout(input: { eventId: string; eventType: string; sessionId: string; userId: string; quoteId: string; planId: string; amountMinor?: number; currency?: string; subscriptionId?: string; customerId?: string; paymentIntentId?: string }) {
  return editData((data) => {
    data.stripeEvents ||= [];
    if (data.stripeEvents.some((item) => item.id === input.eventId)) return { duplicate: true, order: null };
    data.stripeEvents.unshift({ id: input.eventId, type: input.eventType, processedAt: now() });
    const order = data.orders.find((item) => item.userId === input.userId && (item.stripeCheckoutSessionId === input.sessionId || item.quoteId === input.quoteId));
    const plan = data.plans.find((item) => item.id === input.planId);
    if (!order || !plan) throw new Error("Checkout order or plan not found; retry this event.");
    if (order.paymentMode !== "stripe" || order.planId !== plan.id) throw new Error("Checkout does not match the order.");
    if (input.amountMinor !== undefined && input.amountMinor !== order.amountMinor) throw new Error("Checkout amount does not match the order.");
    if (input.currency !== undefined && input.currency !== order.currency) throw new Error("Checkout currency does not match the order.");
    if (order.kind === "upgrade") {
      order.stripeCheckoutSessionId = input.sessionId;
      order.stripeSubscriptionId = input.subscriptionId || order.stripeSubscriptionId || null;
      order.stripePaymentIntentId = input.paymentIntentId || order.stripePaymentIntentId || null;
    }
    const paid = order.kind === "upgrade"
      ? fulfilUpgrade(data, input.userId, order, plan)
      : grantPurchaseAccess(data, input.userId, plan, order.amountMinor, order.quoteId, input.sessionId, input.subscriptionId, input.customerId, input.paymentIntentId);
    return { duplicate: false, order: paid };
  });
}

export async function stripeEventProcessed(eventId: string) {
  const data = await ensureProductData();
  return data.stripeEvents.some(item => item.id === eventId);
}

export async function completeStripeEvent(eventId: string, eventType: string) {
  return editData((data) => {
    data.stripeEvents ||= [];
    if (data.stripeEvents.some((item) => item.id === eventId)) return false;
    data.stripeEvents.unshift({ id: eventId, type: eventType, processedAt: now() });
    return true;
  });
}

export async function recordStripeCheckoutFailure(input: { eventId: string; eventType: string; orderId: string; sessionId: string; status: "failed" | "canceled" }) {
  return editData(data => {
    if (data.stripeEvents.some(item => item.id === input.eventId)) return;
    const order = data.orders.find(item => item.id === input.orderId && item.paymentMode === "stripe");
    if (!order) throw new Error("Checkout order not found; retry this event.");
    if (order.stripeCheckoutSessionId !== input.sessionId) throw new Error("Checkout session does not match the order.");
    if (order.status !== "paid" && order.status !== "refunded") {
      order.status = input.status;
      order.lastStripeStatus = input.status;
      order.failureReason = input.eventType;
    }
    data.stripeEvents.unshift({ id: input.eventId, type: input.eventType, processedAt: now() });
  });
}

export async function cancelSubscription(userId: string, subscriptionId: string, reason?: { code?: ProductSubscription["cancelReasonCode"]; text?: string }) {
  return editData((data) => {
    const subscription = data.subscriptions.find((item) => item.id === subscriptionId && item.userId === userId);
    if (!subscription) throw new Error("Subscription not found.");
    if (new Date(subscription.validTo) <= new Date()) { subscription.state = "expired"; throw new Error("This subscription has expired."); }
    subscription.cancelReasonCode = reason?.code || null;
    subscription.cancelReasonText = reason?.code === "other" ? (reason.text || "").trim().slice(0, 500) : null;
    if (subscription.source === "trial") {
      subscription.state = "trial_canceled";
      const entitlement = data.entitlements.find((item) => entitlementMatchesSubscription(item, subscription) && item.validTo === subscription.validTo);
      if (entitlement) entitlement.state = "expired";
    } else {
      subscription.state = "cancel_at_period_end";
      subscription.cancelAtPeriodEnd = true;
    }
    data.notifications.unshift({ id: id("notification"), userId, title: "Subscription updated", body: subscription.source === "trial" ? "Trial access has ended." : "Your subscription will end at the current period.", readAt: null, createdAt: now() });
    return subscription;
  });
}

export async function resumeSubscription(userId: string, subscriptionId: string) {
  return editData((data) => {
    const subscription = data.subscriptions.find((item) => item.id === subscriptionId && item.userId === userId);
    if (!subscription) throw new Error("Subscription not found.");
    if (subscription.source === "purchase") throw new Error("Auto-renewal cannot be restored. You can purchase a new plan after the current period ends.");
    if (!["trial_canceled", "cancel_at_period_end"].includes(subscription.state) || new Date(subscription.validTo) <= new Date()) throw new Error("This subscription cannot be resumed.");
    subscription.state = "active";
    subscription.cancelAtPeriodEnd = false;
    const entitlement = data.entitlements.find((item) => entitlementMatchesSubscription(item, subscription) && item.validTo === subscription.validTo);
    if (entitlement) entitlement.state = "active";
    data.notifications.unshift({ id: id("notification"), userId, title: "Subscription resumed", body: "Your course access remains available until the current period ends.", readAt: null, createdAt: now() });
    return subscription;
  });
}

export async function getLearningOverview(userId: string) {
  return editData((data) => {
    const currentTime = new Date();
    data.entitlements.forEach((entitlement) => {
      if (entitlement.state === "active" && new Date(entitlement.validTo) <= currentTime) entitlement.state = "expired";
    });
    data.subscriptions.forEach((subscription) => {
      if (["active", "cancel_at_period_end", "grace"].includes(subscription.state) && new Date(subscription.validTo) <= currentTime) subscription.state = "expired";
    });
    const records = data.studyRecords.filter((record) => record.userId === userId);
    // D2.4 Preview and paid study share one record; purchasing access must not reset unique LPs.
    const courseIds = [...new Set(records.map((record) => record.courseId))];
    const subscriptions = data.subscriptions.filter((item) => item.userId === userId).map((subscription) => ({ ...subscription, plan: data.plans.find((plan) => plan.id === subscription.planId) || null }));
    const accessState = accessStateFromSubscriptions(subscriptions);
    const courses = courseIds.map((courseId) => {
      const record = records.find((item) => item.courseId === courseId);
      const course = data.courses.find((item) => item.id === courseId);
      const entitlement = course ? activeEntitlement(data, userId, courseId) : null;
      const lessons = course?.sections.flatMap((section) => section.lessons) || [];
      const courseEvents = data.studyEvents.filter((event) => event.userId === userId && event.courseId === courseId);
      const openedLessonIds = uniqueOpenedLearningPointIds(courseEvents);
      const computed = courseProgressFromUniqueLearningPoints(openedLessonIds.length, lessons.length);
      const completedLessonIds = courseEvents.filter((event) => event.event === "complete").map((event) => event.lessonId);
      const previewLessons = lessons.filter((lesson) => lesson.isPublic);
      const previewLessonIds = previewLessons.map((lesson) => lesson.id);
      const completedPreviewIds = previewLessonIds.filter((id) => completedLessonIds.includes(id));
      const accessEnded = data.entitlements.some((item) => item.userId === userId && (item.state === "expired" || item.state === "revoked") && (!course || entitlementCoversCourse(item, course)));
      const { cardState, cta } = resolveOverviewCard({
        courseStatus: course?.status,
        progressFailed: computed.progressFailed,
        completed: computed.completed,
        hasLiveEntitlement: Boolean(entitlement),
        previewLessonIds,
        openedLessonIds,
        completedPreviewIds,
        accessEnded,
      });
      return {
        id: record?.id || `access_${userId}_${courseId}`,
        userId,
        courseId,
        startedAt: record?.startedAt || null,
        updatedAt: record?.updatedAt || entitlement?.validTo || null,
        currentLessonId: record?.currentLessonId || null,
        currentLessonTitle: lessons.find((lesson) => lesson.id === record?.currentLessonId)?.title || null,
        lessonCount: lessons.length,
        courseDescription: course?.description || "",
        courseCategory: course?.category || "European Humanities",
        totalMinutes: lessons.reduce((total, lesson) => total + lesson.durationMinutes, 0),
        courseStatus: course?.status || "draft",
        totalSeconds: record?.totalSeconds || 0,
        openedLearningPointCount: openedLessonIds.length,
        totalLearningPoints: lessons.length,
        progress: computed.progress,
        progressFailed: computed.progressFailed,
        completedAt: computed.completed ? record?.completedAt || now() : null,
        completedLessonIds: [...new Set(completedLessonIds)],
        nextPreviewLessonId: previewLessons.find((lesson) => !openedLessonIds.includes(lesson.id))?.id || null,
        previewAvailable: previewLessons.length > 0,
        courseTitle: course?.title || courseId,
        entitlement,
        cardState,
        cta,
      };
    });
    const empty = overviewEmptyState(courses.length, accessState);
    const orders = data.orders.filter((item) => item.userId === userId).map((order) => ({ ...order, plan: data.plans.find((plan) => plan.id === order.planId) || null }));
    const entitlements = data.entitlements.filter((item) => item.userId === userId && item.state === "active" && new Date(item.validTo) > currentTime);
    return {
      courses,
      subscriptions,
      orders,
      notifications: [],
      unreadCount: 0,
      notificationsPlaceholder: true,
      entitlements,
      accessState,
      emptyState: empty.emptyState,
      emptyCta: empty.emptyCta,
    };
  });
}

export async function getOrderForUser(userId: string, orderId: string) {
  const data = await ensureProductData();
  const order = data.orders.find((item) => item.id === orderId && item.userId === userId);
  if (!order) return null;
  return { ...order, plan: data.plans.find((plan) => plan.id === order.planId) || null };
}

function addOrderActivity(data: ProductData, input: Omit<ProductOrderActivity, "id" | "createdAt">) {
  const activity: ProductOrderActivity = { id: id("order_activity"), createdAt: now(), ...input };
  data.orderActivities.unshift(activity);
  return activity;
}

export async function listOperatorOrders(filters?: { search?: string; status?: string; paymentMode?: string }) {
  const data = await ensureProductData();
  const search = filters?.search?.trim().toLowerCase();
  return data.orders.filter((order) => {
    const email = data.users.find((user) => user.id === order.userId)?.email || order.userId;
    return (!search || order.id.toLowerCase().includes(search) || email.toLowerCase().includes(search))
      && (!filters?.status || order.status === filters.status)
      && (!filters?.paymentMode || order.paymentMode === filters.paymentMode);
  }).map((order) => ({
    ...order,
    userEmail: data.users.find((user) => user.id === order.userId)?.email || order.userId,
    plan: data.plans.find((plan) => plan.id === order.planId) || null,
    subscription: data.subscriptions.find((subscription) => subscription.userId === order.userId && subscription.planId === order.planId && subscription.source === "purchase") || null,
    activities: data.orderActivities.filter((activity) => activity.orderId === order.id),
  })).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function recordOrderActivity(input: Omit<ProductOrderActivity, "id" | "createdAt">) {
  return editData((data) => addOrderActivity(data, input));
}

export async function refundOrder(orderId: string, operatorId: string, providerReference: string | null = null, reason: string | null = null) {
  return editData((data) => {
    const order = data.orders.find((item) => item.id === orderId);
    if (!order) throw new Error("Order not found.");
    if (order.status === "refunded") return order;
    if (order.status !== "paid") throw new Error("Only a paid order can be refunded.");
    order.status = "refunded";
    const subscription = data.subscriptions.find((item) => item.userId === order.userId && item.planId === order.planId && item.source === "purchase" && item.state !== "expired");
    if (subscription) subscription.state = "expired";
    const plan = data.plans.find((item) => item.id === order.planId);
    if (plan) {
      const entitlement = data.entitlements.find((item) => item.userId === order.userId && item.source === "purchase" && item.state === "active" && entitlementOverlapsPlan(data, item, plan));
      if (entitlement) entitlement.state = "revoked";
    }
    data.notifications.unshift({ id: id("notification"), userId: order.userId, title: "Order refunded", body: "The demo order was refunded and course access was removed.", readAt: null, createdAt: now() });
    addOrderActivity(data, { orderId, operatorId, action: "refund", result: "succeeded", reason, providerReference });
    return order;
  });
}

export async function refundDemoOrder(orderId: string, operatorId = "operator", reason: string | null = null) {
  const data = await ensureProductData();
  const order = data.orders.find((item) => item.id === orderId);
  if (!order) throw new Error("Order not found.");
  if (order.paymentMode !== "demo") throw new Error("Live Stripe refunds must be completed through Stripe and then synchronised.");
  return refundOrder(orderId, operatorId, null, reason);
}

export async function applyStripeOrderState(input: { orderId: string; operatorId: string; stripeStatus: "paid" | "processing" | "failed" | "canceled"; checkoutSessionId?: string | null; paymentIntentId?: string | null; subscriptionId?: string | null; customerId?: string | null; reason?: string | null }) {
  return editData((data) => {
    const order = data.orders.find((item) => item.id === input.orderId);
    if (!order) throw new Error("Order not found.");
    if (order.status === "paid") {
      addOrderActivity(data, { orderId: order.id, operatorId: input.operatorId, action: "resynchronise", result: "succeeded", reason: "Order is already paid.", providerReference: order.stripeCheckoutSessionId || null });
      return order;
    }
    const plan = data.plans.find((item) => item.id === order.planId);
    if (!plan) throw new Error("Plan not found.");
    order.lastStripeStatus = input.stripeStatus;
    order.lastSyncedAt = now();
    order.failureReason = input.reason || null;
    order.exceptionCode = input.stripeStatus === "processing" ? "processing_too_long" : input.stripeStatus === "failed" || input.stripeStatus === "canceled" ? null : null;
    if (input.checkoutSessionId) order.stripeCheckoutSessionId = input.checkoutSessionId;
    if (input.paymentIntentId) order.stripePaymentIntentId = input.paymentIntentId;
    if (input.subscriptionId) order.stripeSubscriptionId = input.subscriptionId;
    if (input.stripeStatus === "paid") {
      if (order.kind === "trial_activation") {
        const validFrom = now();
        const trialEnd = new Date(validFrom);
        trialEnd.setUTCDate(trialEnd.getUTCDate() + TRIAL_DAYS);
        order.status = "paid";
        const subscription = subscriptionForPlan(order.userId, plan, "trial", validFrom, trialEnd.toISOString(), { stripeSubscriptionId: order.stripeSubscriptionId || input.subscriptionId || null, stripeCustomerId: input.customerId || null, graceEndsAt: null });
        const entitlement = entitlementForPlan(order.userId, plan, "trial", subscription.validTo);
        data.subscriptions.unshift(subscription);
        data.entitlements = data.entitlements.filter((item) => !(item.userId === order.userId && item.state === "active" && entitlementOverlapsPlan(data, item, plan)));
        data.entitlements.unshift(entitlement);
        data.notifications.unshift({ id: id("notification"), userId: order.userId, title: "Trial activated", body: `${plan.name} is available for ${TRIAL_DAYS} days.`, readAt: null, createdAt: now() });
        addOrderActivity(data, { orderId: order.id, operatorId: input.operatorId, action: "resynchronise", result: "succeeded", reason: null, providerReference: order.stripeCheckoutSessionId || null });
        return order;
      }
      const paid = order.kind === "upgrade"
        ? fulfilUpgrade(data, order.userId, order, plan)
        : grantPurchaseAccess(data, order.userId, plan, order.amountMinor, order.quoteId, order.stripeCheckoutSessionId || undefined, order.stripeSubscriptionId || undefined, input.customerId || undefined, order.stripePaymentIntentId || undefined);
      addOrderActivity(data, { orderId: order.id, operatorId: input.operatorId, action: "resynchronise", result: "succeeded", reason: null, providerReference: order.stripeCheckoutSessionId || null });
      return paid;
    }
    order.status = input.stripeStatus === "processing" ? "pending" : input.stripeStatus;
    addOrderActivity(data, { orderId: order.id, operatorId: input.operatorId, action: "resynchronise", result: input.stripeStatus === "processing" ? "processing" : "succeeded", reason: input.reason || null, providerReference: order.stripeCheckoutSessionId || null });
    return order;
  });
}

export async function recordStudyEvent(input: { userId: string; courseId: string; lessonId: string; event: ProductStudyEvent["event"]; seconds: number; clientEventId: string }, access: "paid" | "preview" = "paid") {
  return editData((data) => {
    if (!input.clientEventId.trim()) throw new Error("A client event id is required.");
    if (!["open", "video_progress", "text_progress", "complete"].includes(input.event)) throw new Error("Invalid study event.");
    if (access === "paid" && !activeEntitlement(data, input.userId, input.courseId)) throw new Error("Course access is required.");
    const course = data.courses.find((item) => item.id === input.courseId);
    if (!course || course.status !== "published") throw new Error("Course is not available.");
    const lesson = course?.sections.flatMap((section) => section.lessons).find((item) => item.id === input.lessonId);
    if (!lesson) throw new Error("Lesson not found.");
    if (access === "preview" && !lesson.isPublic) throw new Error("This lesson is outside the preview range.");
    const existingClientEvent = data.studyEvents.some((event) => event.userId === input.userId && event.clientEventId === input.clientEventId);
    if (existingClientEvent) {
      return data.studyRecords.find((record) => record.userId === input.userId && record.courseId === input.courseId) || null;
    }
    const totalCourseSeconds = course.sections.flatMap((section) => section.lessons).reduce((sum, item) => sum + item.durationMinutes * 60, 0);
    const alreadyCompleted = input.event === "complete" && data.studyEvents.some((event) => event.userId === input.userId && event.courseId === input.courseId && event.lessonId === input.lessonId && event.event === "complete");
    const seconds = alreadyCompleted ? 0 : input.event === "complete"
      ? Math.max(0, Math.min(lesson.durationMinutes * 60, Math.round(input.seconds || 0)))
      : Math.max(0, Math.min(300, Math.round(input.seconds || 0)));
    data.studyEvents.push({ id: id("study_event"), ...input, seconds, createdAt: now() });
    let record = data.studyRecords.find((item) => item.userId === input.userId && item.courseId === input.courseId);
    if (!record) {
      record = { id: id("study"), userId: input.userId, courseId: input.courseId, startedAt: now(), updatedAt: now(), currentLessonId: input.lessonId, totalSeconds: 0, progress: 0, completedAt: null };
      data.studyRecords.unshift(record);
    }
    record.currentLessonId = input.lessonId;
    record.totalSeconds += seconds;
    record.totalSeconds = Math.min(totalCourseSeconds, record.totalSeconds);
    const lessons = course.sections.flatMap((section) => section.lessons);
    const openedIds = uniqueOpenedLearningPointIds(data.studyEvents.filter((event) => event.userId === input.userId && event.courseId === input.courseId));
    const computed = courseProgressFromUniqueLearningPoints(openedIds.length, lessons.length);
    // D2.1 stored progress follows unique LPs; seconds stay on the record for study telemetry only.
    record.progress = computed.progress ?? 0;
    record.completedAt = computed.completed ? record.completedAt || now() : null;
    record.updatedAt = now();
    return record;
  });
}

export async function getConversation(userId: string, conversationId: string | undefined, courseId: string, lessonId: string | undefined, mode: "lecture" | "socratic") {
  const data = await ensureProductData();
  const existing = conversationId
    ? data.conversations.find((item) => item.id === conversationId && item.userId === userId && item.courseId === courseId && item.lessonId === (lessonId || null))
    : data.conversations.find((item) => item.userId === userId && item.courseId === courseId && item.lessonId === (lessonId || null) && item.mode === mode);
  if (existing) return existing;
  return { id: id("conversation"), userId, courseId, lessonId: lessonId || null, mode, messages: [], updatedAt: now() } satisfies ProductConversation;
}

export async function saveConversation(conversation: ProductConversation) {
  return editData((data) => {
    const existingIndex = data.conversations.findIndex((item) => item.id === conversation.id && item.userId === conversation.userId);
    const next = { ...conversation, messages: conversation.messages.slice(-12), updatedAt: now() };
    if (existingIndex >= 0) data.conversations[existingIndex] = next;
    else data.conversations.unshift(next);
    return next;
  });
}

export async function setNotificationRead(userId: string, notificationId: string, read: boolean) {
  return editData((data) => {
    const item = data.notifications.find((notification) => notification.id === notificationId && notification.userId === userId);
    if (!item) throw new Error("Notification not found.");
    item.readAt = read ? now() : null;
    return item;
  });
}

export async function markNotificationRead(userId: string, notificationId: string) {
  return setNotificationRead(userId, notificationId, true);
}

export async function createCourseForOperator(input: { title: string; description?: string; category?: ProductCourse["category"] }) {
  return editData((data) => {
    const title = input.title.trim();
    if (!title) throw new Error("Course title is required.");
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || id("course");
    if (data.courses.some((course) => course.slug === slug)) throw new Error("A course with this title already exists.");
    const category = input.category && ["Chinese Humanities", "European Humanities", "Science"].includes(input.category) ? input.category : "European Humanities";
    const course: ProductCourse = { id: id("course"), slug, title, description: input.description?.trim() || "", category, thumbnailPath: null, status: "draft", sections: [], createdAt: now(), updatedAt: now() };
    data.courses.unshift(course);
    return course;
  });
}

export async function addLessonToCourse(input: { courseId: string; title: string; body: string; durationMinutes: number; videoDurationSeconds?: number | null; isPublic?: boolean }) {
  return editData((data) => {
    const course = data.courses.find((item) => item.id === input.courseId);
    if (!course) throw new Error("Course not found.");
    const title = input.title.trim();
    const body = input.body.trim();
    const durationMinutes = Math.round(input.durationMinutes);
    if (!title) throw new Error("Lesson title is required.");
    if (!body) throw new Error("Lesson content is required.");
    if (!Number.isFinite(durationMinutes) || durationMinutes < 1 || durationMinutes > 600) throw new Error("Lesson duration must be between 1 and 600 minutes.");
    if (input.videoDurationSeconds != null && (!Number.isInteger(input.videoDurationSeconds) || input.videoDurationSeconds < 0 || input.videoDurationSeconds > 36000)) throw new Error("Video duration must be a whole number between 0 and 36000 seconds.");
    if (course.sections.some((section) => section.lessons.some((lesson) => lesson.title.toLowerCase() === title.toLowerCase()))) throw new Error("A lesson with this title already exists.");
    const section = course.sections[0] || { id: id("section"), title: "Course content", lessons: [] };
    if (!course.sections.length) course.sections.push(section);
    if (input.isPublic) course.sections.forEach((item) => item.lessons.forEach((lesson) => { lesson.isPublic = false; }));
    const lesson: ProductLesson = { id: `${course.id}-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || id("lesson")}`, title, body, durationMinutes, videoDurationSeconds: input.videoDurationSeconds ?? null, isPublic: Boolean(input.isPublic) };
    section.lessons.push(lesson);
    course.updatedAt = now();
    return lesson;
  });
}

export async function setCourseStatus(courseId: string, status: ProductCourse["status"]) {
  return editData((data) => {
    const course = data.courses.find((item) => item.id === courseId);
    if (!course) throw new Error("Course not found.");
    if (status === "published" && !course.sections.some((section) => section.lessons.length > 0)) throw new Error("A Course needs at least one Lesson before it can be published.");
    course.status = status;
    course.updatedAt = now();
    return course;
  });
}
