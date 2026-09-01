import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "crypto";
import path from "path";
import { promisify } from "util";
import { atomicWriteJson, ensureDir, now, readJson, SYSTEM_ROOT } from "./fileStore";

const scrypt = promisify(scryptCallback);
const PRODUCT_DIR = path.join(SYSTEM_ROOT, "learning_guide");
const PRODUCT_FILE = path.join(PRODUCT_DIR, "product.json");
const SESSION_DAYS = 30;
const QUOTE_MINUTES = 15;

export type Locale = "en-GB" | "zh-CN";
export type ProductUser = {
  id: string;
  email: string;
  passwordHash: string;
  nickname: string;
  locale: Locale;
  role: "student" | "operator";
  status: "active" | "disabled";
  emailVerifiedAt: string | null;
  createdAt: string;
};

export type ProductLesson = {
  id: string;
  title: string;
  body: string;
  durationMinutes: number;
  isPublic: boolean;
};

export type ProductSection = { id: string; title: string; lessons: ProductLesson[] };
export type ProductCourse = {
  id: string;
  slug: string;
  title: string;
  description: string;
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
};
export type ProductQuote = {
  id: string;
  userId: string;
  planId: string;
  amountMinor: number;
  currency: "usd";
  expiresAt: string;
  createdAt: string;
};
export type ProductOrder = {
  id: string;
  userId: string;
  planId: string;
  quoteId: string;
  amountMinor: number;
  currency: "usd";
  status: "paid" | "pending" | "failed" | "canceled" | "refunded";
  paymentMode: "demo" | "stripe";
  stripeCheckoutSessionId?: string | null;
  stripeSubscriptionId?: string | null;
  createdAt: string;
};
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
  stripeSubscriptionId?: string | null;
};
export type ProductEntitlement = {
  id: string;
  userId: string;
  courseId: string;
  state: "active" | "expired" | "revoked";
  source: "trial" | "purchase";
  validTo: string;
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

export type ProductData = {
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
      { id: "epicureanism-pc-6", courseId: "epicureanism", name: "Epicureanism · 6 months", termMonths: 6, device: "pc", amountMinor: 4900, currency: "usd" },
      { id: "epicureanism-pc-12", courseId: "epicureanism", name: "Epicureanism · 12 months", termMonths: 12, device: "pc", amountMinor: 7900, currency: "usd" },
      { id: "epicureanism-mobile-6", courseId: "epicureanism", name: "Epicureanism · 6 months · Mobile", termMonths: 6, device: "mobile", amountMinor: 2900, currency: "usd" },
      { id: "epicureanism-mobile-12", courseId: "epicureanism", name: "Epicureanism · 12 months · Mobile", termMonths: 12, device: "mobile", amountMinor: 4900, currency: "usd" },
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
  };
}

async function saveData(data: ProductData) {
  await ensureDir(PRODUCT_DIR);
  await atomicWriteJson(PRODUCT_FILE, data);
}

export async function ensureProductData() {
  const current = await readJson<ProductData | null>(PRODUCT_FILE, null);
  if (current?.version === 1) {
    if (!current.stripeEvents) current.stripeEvents = [];
    return current;
  }
  const seeded = defaultData();
  await saveData(seeded);
  return seeded;
}

async function editData<T>(mutator: (data: ProductData) => Promise<T> | T) {
  const data = await ensureProductData();
  const result = await mutator(data);
  await saveData(data);
  return result;
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

async function passwordHash(password: string) {
  const salt = randomBytes(16).toString("hex");
  const key = await scrypt(password, salt, 64) as Buffer;
  return `scrypt$${salt}$${Buffer.from(key).toString("hex")}`;
}

async function passwordMatches(password: string, stored: string) {
  const [, salt, value] = stored.split("$");
  if (!salt || !value) return false;
  const actual = await scrypt(password, salt, 64) as Buffer;
  const expected = Buffer.from(value, "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function publicUser(user: ProductUser) {
  return { id: user.id, email: user.email, nickname: user.nickname, locale: user.locale, role: user.role || "student", status: user.status, emailVerifiedAt: user.emailVerifiedAt };
}

export function isOperator(user: ProductUser) {
  const configuredEmail = process.env.BACKOFFICE_OPERATOR_EMAIL?.trim().toLowerCase();
  return user.role === "operator" || Boolean(configuredEmail && user.email === configuredEmail);
}

export async function getUserById(userId: string) {
  const data = await ensureProductData();
  return data.users.find((user) => user.id === userId) || null;
}

export async function registerUser(input: { email: string; password: string; locale?: Locale; nickname?: string }) {
  const email = input.email.trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error("Enter a valid email address.");
  if (input.password.length < 8) throw new Error("Password must contain at least 8 characters.");
  return editData(async (data) => {
    if (data.users.some((user) => user.email === email)) throw new Error("An account with this email already exists.");
    const user: ProductUser = {
      id: id("user"),
      email,
      passwordHash: await passwordHash(input.password),
      nickname: (input.nickname?.trim() || email.split("@")[0]).slice(0, 40),
      locale: input.locale === "zh-CN" ? "zh-CN" : "en-GB",
      role: process.env.BACKOFFICE_OPERATOR_EMAIL?.trim().toLowerCase() === email ? "operator" : "student",
      status: "active",
      // Local/dev mode is immediately usable. A production SES verification step can be enabled later.
      emailVerifiedAt: now(),
      createdAt: now(),
    };
    data.users.push(user);
    data.notifications.unshift({ id: id("notification"), userId: user.id, title: "Welcome to Learning Guide", body: "Your account is ready. Start with the public lesson or activate the trial.", readAt: null, createdAt: now() });
    return user;
  });
}

export async function authenticateUser(emailValue: string, password: string) {
  const data = await ensureProductData();
  const user = data.users.find((item) => item.email === emailValue.trim().toLowerCase());
  if (!user || user.status !== "active" || !(await passwordMatches(password, user.passwordHash))) throw new Error("Email or password is incorrect.");
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
  return data.users.find((user) => user.id === session.userId && user.status === "active") || null;
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

export function publicFirstLesson(course: ProductCourse) {
  return course.sections.flatMap((section) => section.lessons).find((lesson) => lesson.isPublic) || null;
}

export async function listPlans(courseId?: string) {
  const data = await ensureProductData();
  return data.plans.filter((plan) => !courseId || plan.courseId === courseId);
}

function activeEntitlement(data: ProductData, userId: string, courseId: string) {
  const entitlement = data.entitlements.find((item) => item.userId === userId && item.courseId === courseId && item.state === "active");
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

export async function activateTrial(userId: string, courseId: string) {
  return editData((data) => {
    const course = data.courses.find((item) => item.id === courseId);
    if (!course || course.status !== "published") throw new Error("Course is not available.");
    const existing = activeEntitlement(data, userId, courseId);
    if (existing) return existing;
    const previousTrial = data.subscriptions.find((item) => item.userId === userId && item.courseId === courseId && item.source === "trial");
    if (previousTrial) {
      if (new Date(previousTrial.validTo) <= new Date()) { previousTrial.state = "expired"; throw new Error("The seven-day trial has ended."); }
      previousTrial.state = "active";
      const previousEntitlement = data.entitlements.find((item) => item.userId === userId && item.courseId === courseId && item.source === "trial" && item.validTo === previousTrial.validTo);
      if (previousEntitlement) { previousEntitlement.state = "active"; return previousEntitlement; }
    }
    const validFrom = now();
    const trialEnd = new Date(validFrom);
    trialEnd.setUTCDate(trialEnd.getUTCDate() + 7);
    const subscription: ProductSubscription = { id: id("subscription"), userId, planId: "trial", courseId, state: "active", source: "trial", validFrom, validTo: trialEnd.toISOString(), cancelAtPeriodEnd: false, stripeSubscriptionId: null };
    const entitlement: ProductEntitlement = { id: id("entitlement"), userId, courseId, state: "active", source: "trial", validTo: subscription.validTo };
    data.subscriptions.unshift(subscription);
    data.entitlements.unshift(entitlement);
    data.notifications.unshift({ id: id("notification"), userId, title: "Trial activated", body: `${course.title} is available for seven days.`, readAt: null, createdAt: now() });
    return entitlement;
  });
}

export async function createQuote(userId: string, planId: string) {
  return editData((data) => {
    const plan = data.plans.find((item) => item.id === planId);
    if (!plan) throw new Error("Plan not found.");
    const createdAt = now();
    const expiresAt = new Date(Date.now() + QUOTE_MINUTES * 60_000).toISOString();
    const quote: ProductQuote = { id: id("quote"), userId, planId, amountMinor: plan.amountMinor, currency: plan.currency, expiresAt, createdAt };
    data.quotes.unshift(quote);
    return { quote, plan };
  });
}

export async function completeDemoCheckout(userId: string, quoteId: string) {
  return editData((data) => {
    const quote = data.quotes.find((item) => item.id === quoteId && item.userId === userId);
    if (!quote || new Date(quote.expiresAt) <= new Date()) throw new Error("This quote has expired. Please calculate the price again.");
    const plan = data.plans.find((item) => item.id === quote.planId);
    if (!plan) throw new Error("Plan not found.");
    const existingOrder = data.orders.find((item) => item.userId === userId && item.quoteId === quote.id && item.status === "paid");
    if (existingOrder) {
      const subscription = data.subscriptions.find((item) => item.userId === userId && item.planId === plan.id && item.source === "purchase" && item.state !== "expired");
      const entitlement = data.entitlements.find((item) => item.userId === userId && item.courseId === plan.courseId && item.state === "active");
      if (subscription && entitlement) return { order: existingOrder, subscription, entitlement };
    }
    const order: ProductOrder = { id: id("order"), userId, planId: plan.id, quoteId: quote.id, amountMinor: quote.amountMinor, currency: quote.currency, status: "paid", paymentMode: "demo", stripeCheckoutSessionId: null, stripeSubscriptionId: null, createdAt: now() };
    const validFrom = now();
    const subscription: ProductSubscription = { id: id("subscription"), userId, planId: plan.id, courseId: plan.courseId, state: "active", source: "purchase", validFrom, validTo: addMonths(validFrom, plan.termMonths), cancelAtPeriodEnd: false, stripeSubscriptionId: null };
    const entitlement: ProductEntitlement = { id: id("entitlement"), userId, courseId: plan.courseId, state: "active", source: "purchase", validTo: subscription.validTo };
    data.orders.unshift(order);
    data.subscriptions.unshift(subscription);
    data.entitlements = data.entitlements.filter((item) => !(item.userId === userId && item.courseId === plan.courseId && item.state === "active"));
    data.entitlements.unshift(entitlement);
    data.notifications.unshift({ id: id("notification"), userId, title: "Purchase complete", body: "Your course access is now available in My Learning.", readAt: null, createdAt: now() });
    return { order, subscription, entitlement };
  });
}

export async function createPendingStripeOrder(userId: string, quoteId: string) {
  return editData((data) => {
    const quote = data.quotes.find((item) => item.id === quoteId && item.userId === userId);
    if (!quote || new Date(quote.expiresAt) <= new Date()) throw new Error("This quote has expired. Please calculate the price again.");
    const plan = data.plans.find((item) => item.id === quote.planId);
    if (!plan) throw new Error("Plan not found.");
    const existing = data.orders.find((item) => item.userId === userId && item.quoteId === quote.id && ["pending", "paid"].includes(item.status));
    if (existing) return { order: existing, plan };
    const order: ProductOrder = { id: id("order"), userId, planId: plan.id, quoteId: quote.id, amountMinor: quote.amountMinor, currency: quote.currency, status: "pending", paymentMode: "stripe", stripeCheckoutSessionId: null, stripeSubscriptionId: null, createdAt: now() };
    data.orders.unshift(order);
    return { order, plan };
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

function grantPurchaseAccess(data: ProductData, userId: string, plan: ProductPlan, amountMinor: number, quoteId: string, stripeCheckoutSessionId?: string, stripeSubscriptionId?: string) {
  let order = data.orders.find((item) => item.id === quoteId || item.stripeCheckoutSessionId === stripeCheckoutSessionId);
  if (!order) order = data.orders.find((item) => item.userId === userId && item.quoteId === quoteId);
  if (!order) throw new Error("Order not found.");
  if (order.status === "paid") return order;
  order.status = "paid";
  order.amountMinor = amountMinor;
  order.paymentMode = "stripe";
  order.stripeCheckoutSessionId = stripeCheckoutSessionId || order.stripeCheckoutSessionId || null;
  order.stripeSubscriptionId = stripeSubscriptionId || order.stripeSubscriptionId || null;
  const validFrom = now();
  const subscription: ProductSubscription = { id: id("subscription"), userId, planId: plan.id, courseId: plan.courseId, state: "active", source: "purchase", validFrom, validTo: addMonths(validFrom, plan.termMonths), cancelAtPeriodEnd: false, stripeSubscriptionId: stripeSubscriptionId || null };
  const entitlement: ProductEntitlement = { id: id("entitlement"), userId, courseId: plan.courseId, state: "active", source: "purchase", validTo: subscription.validTo };
  data.subscriptions.unshift(subscription);
  data.entitlements = data.entitlements.filter((item) => !(item.userId === userId && item.courseId === plan.courseId && item.state === "active"));
  data.entitlements.unshift(entitlement);
  data.notifications.unshift({ id: id("notification"), userId, title: "Purchase complete", body: "Your course access is now available in My Learning.", readAt: null, createdAt: now() });
  return order;
}

export async function fulfilStripeCheckout(input: { eventId: string; eventType: string; sessionId: string; userId: string; quoteId: string; planId: string; subscriptionId?: string }) {
  return editData((data) => {
    data.stripeEvents ||= [];
    if (data.stripeEvents.some((item) => item.id === input.eventId)) return { duplicate: true, order: null };
    data.stripeEvents.unshift({ id: input.eventId, type: input.eventType, processedAt: now() });
    const order = data.orders.find((item) => item.userId === input.userId && (item.stripeCheckoutSessionId === input.sessionId || item.quoteId === input.quoteId));
    const plan = data.plans.find((item) => item.id === input.planId);
    if (!order || !plan) return { duplicate: false, order: null };
    const paid = grantPurchaseAccess(data, input.userId, plan, order.amountMinor, order.quoteId, input.sessionId, input.subscriptionId);
    return { duplicate: false, order: paid };
  });
}

export async function cancelSubscription(userId: string, subscriptionId: string) {
  return editData((data) => {
    const subscription = data.subscriptions.find((item) => item.id === subscriptionId && item.userId === userId);
    if (!subscription) throw new Error("Subscription not found.");
    if (new Date(subscription.validTo) <= new Date()) { subscription.state = "expired"; throw new Error("This subscription has expired."); }
    if (subscription.source === "trial") {
      subscription.state = "trial_canceled";
      const entitlement = data.entitlements.find((item) => item.userId === userId && item.courseId === subscription.courseId && item.source === "trial" && item.validTo === subscription.validTo);
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
    if (!["trial_canceled", "cancel_at_period_end"].includes(subscription.state) || new Date(subscription.validTo) <= new Date()) throw new Error("This subscription cannot be resumed.");
    subscription.state = "active";
    subscription.cancelAtPeriodEnd = false;
    const entitlement = data.entitlements.find((item) => item.userId === userId && item.courseId === subscription.courseId && item.source === subscription.source && item.validTo === subscription.validTo);
    if (entitlement) entitlement.state = "active";
    data.notifications.unshift({ id: id("notification"), userId, title: "Subscription resumed", body: "Your course access remains available until the current period ends.", readAt: null, createdAt: now() });
    return subscription;
  });
}

export async function getLearningOverview(userId: string) {
  const data = await ensureProductData();
  const records = data.studyRecords.filter((record) => record.userId === userId);
  const activeCourseIds = data.entitlements
    .filter((entitlement) => entitlement.userId === userId && entitlement.state === "active" && new Date(entitlement.validTo) > new Date())
    .map((entitlement) => entitlement.courseId);
  const courseIds = [...new Set([...records.map((record) => record.courseId), ...activeCourseIds])];
  const courses = courseIds.map((courseId) => {
    const record = records.find((item) => item.courseId === courseId);
    const course = data.courses.find((item) => item.id === courseId);
    const entitlement = activeEntitlement(data, userId, courseId);
    return {
      id: record?.id || `access_${userId}_${courseId}`,
      userId,
      courseId,
      startedAt: record?.startedAt || null,
      updatedAt: record?.updatedAt || entitlement?.validTo || null,
      currentLessonId: record?.currentLessonId || null,
      totalSeconds: record?.totalSeconds || 0,
      progress: record?.progress || 0,
      completedAt: record?.completedAt || null,
      courseTitle: course?.title || courseId,
      entitlement,
    };
  });
  const subscriptions = data.subscriptions.filter((item) => item.userId === userId).map((subscription) => ({ ...subscription, plan: data.plans.find((plan) => plan.id === subscription.planId) || null }));
  const notifications = data.notifications.filter((item) => item.userId === userId).slice(0, 20);
  return { courses, subscriptions, notifications, entitlements: data.entitlements.filter((item) => item.userId === userId) };
}

export async function recordStudyEvent(input: { userId: string; courseId: string; lessonId: string; event: ProductStudyEvent["event"]; seconds: number; clientEventId: string }) {
  return editData((data) => {
    if (!activeEntitlement(data, input.userId, input.courseId)) throw new Error("Course access is required.");
    const course = data.courses.find((item) => item.id === input.courseId);
    const lesson = course?.sections.flatMap((section) => section.lessons).find((item) => item.id === input.lessonId);
    if (!lesson) throw new Error("Lesson not found.");
    if (data.studyEvents.some((event) => event.userId === input.userId && event.clientEventId === input.clientEventId)) {
      return data.studyRecords.find((record) => record.userId === input.userId && record.courseId === input.courseId) || null;
    }
    const seconds = input.event === "complete"
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
    if (input.event === "complete") {
      record.progress = 100;
      record.completedAt = now();
    }
    else record.progress = Math.max(record.progress, Math.min(99, Math.round((record.totalSeconds / Math.max(60, lesson.durationMinutes * 60)) * 100)));
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

export async function markNotificationRead(userId: string, notificationId: string) {
  return editData((data) => {
    const item = data.notifications.find((notification) => notification.id === notificationId && notification.userId === userId);
    if (!item) throw new Error("Notification not found.");
    item.readAt = now();
    return item;
  });
}

export async function createCourseForOperator(input: { title: string; description?: string }) {
  return editData((data) => {
    const title = input.title.trim();
    if (!title) throw new Error("Course title is required.");
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || id("course");
    if (data.courses.some((course) => course.slug === slug)) throw new Error("A course with this title already exists.");
    const course: ProductCourse = { id: id("course"), slug, title, description: input.description?.trim() || "", status: "draft", sections: [], createdAt: now(), updatedAt: now() };
    data.courses.unshift(course);
    return course;
  });
}

export async function addLessonToCourse(input: { courseId: string; title: string; body: string; durationMinutes: number; isPublic?: boolean }) {
  return editData((data) => {
    const course = data.courses.find((item) => item.id === input.courseId);
    if (!course) throw new Error("Course not found.");
    const title = input.title.trim();
    const body = input.body.trim();
    const durationMinutes = Math.round(input.durationMinutes);
    if (!title) throw new Error("Lesson title is required.");
    if (!body) throw new Error("Lesson content is required.");
    if (!Number.isFinite(durationMinutes) || durationMinutes < 1 || durationMinutes > 600) throw new Error("Lesson duration must be between 1 and 600 minutes.");
    if (course.sections.some((section) => section.lessons.some((lesson) => lesson.title.toLowerCase() === title.toLowerCase()))) throw new Error("A lesson with this title already exists.");
    const section = course.sections[0] || { id: id("section"), title: "Course content", lessons: [] };
    if (!course.sections.length) course.sections.push(section);
    const lesson: ProductLesson = { id: `${course.id}-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || id("lesson")}`, title, body, durationMinutes, isPublic: Boolean(input.isPublic) };
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
