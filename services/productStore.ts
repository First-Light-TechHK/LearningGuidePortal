import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "crypto";
import path from "path";
import { promisify } from "util";
import { atomicWriteJson, ensureDir, now, readBinary, readJson, removeDir, SYSTEM_ROOT, writeBinary } from "./fileStore";
import { isProductionEnvironment } from "./runtimeConfig";

const scrypt = promisify(scryptCallback);
const PRODUCT_DIR = path.join(SYSTEM_ROOT, "learning_guide");
const PRODUCT_FILE = path.join(PRODUCT_DIR, "product.json");
const QUOTE_MINUTES = 15;
const TRIAL_DAYS = 3;

export type Locale = "en-GB" | "zh-CN";
export type ProductUser = {
  id: string;
  email: string;
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
  category?: string | null;
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
  kind?: "purchase" | "trial_activation";
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
export type ProductAccount = { id: string; userId: string; provider: "google" | "wechat"; providerSubject: string; createdAt: string };

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
      { id: "epicureanism-pc-6", courseId: "epicureanism", name: "Epicureanism · 6 months", termMonths: 6, device: "pc", amountMinor: 4900, currency: "usd", scope: "category", category: "European Humanities" },
      { id: "epicureanism-pc-12", courseId: "epicureanism", name: "Epicureanism · 12 months", termMonths: 12, device: "pc", amountMinor: 7900, currency: "usd", scope: "category", category: "European Humanities" },
      { id: "epicureanism-mobile-6", courseId: "epicureanism", name: "Epicureanism · 6 months · Mobile", termMonths: 6, device: "mobile", amountMinor: 2900, currency: "usd", scope: "course", category: "European Humanities" },
      { id: "epicureanism-mobile-12", courseId: "epicureanism", name: "Epicureanism · 12 months · Mobile", termMonths: 12, device: "mobile", amountMinor: 4900, currency: "usd", scope: "course", category: "European Humanities" },
      { id: "everything-pc-6", courseId: "*", name: "Everything · 6 months", termMonths: 6, device: "pc", amountMinor: 9900, currency: "usd", scope: "everything", category: null },
      { id: "everything-pc-12", courseId: "*", name: "Everything · 12 months", termMonths: 12, device: "pc", amountMinor: 15900, currency: "usd", scope: "everything", category: null },
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
    current.plans.forEach((plan) => { plan.scope ||= plan.id.endsWith("-pc-6") || plan.id.endsWith("-pc-12") ? "category" : plan.courseId === "*" ? "everything" : "course"; plan.category ??= plan.scope === "category" ? "European Humanities" : null; });
    if (!current.plans.some((plan) => plan.id === "everything-pc-6")) current.plans.push({ id: "everything-pc-6", courseId: "*", name: "Everything · 6 months", termMonths: 6, device: "pc", amountMinor: 9900, currency: "usd", scope: "everything", category: null });
    if (!current.plans.some((plan) => plan.id === "everything-pc-12")) current.plans.push({ id: "everything-pc-12", courseId: "*", name: "Everything · 12 months", termMonths: 12, device: "pc", amountMinor: 15900, currency: "usd", scope: "everything", category: null });
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
      return existing;
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
    return user;
  });
}

export async function getOrCreateSocialUser(input: { provider: "google" | "wechat"; providerSubject: string; email: string; nickname?: string; locale?: Locale }) {
  const email = input.email.trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error("The provider did not return a usable email address.");
  return editData(async (data) => {
    const account = data.accounts.find((item) => item.provider === input.provider && item.providerSubject === input.providerSubject);
    if (account) {
      const user = data.users.find((item) => item.id === account.userId);
      if (!user) throw new ProductAuthError("account_unavailable", "This account is not available.");
      if (user.status === "disabled") throw new ProductAuthError("account_disabled", "This account has been disabled.");
      if (user.status !== "active") throw new ProductAuthError("account_unavailable", "This account is not available.");
      if (user.email !== email && !data.users.some((item) => item.id !== user.id && item.email === email)) user.email = email;
      return user;
    }
    if (data.users.some((item) => item.email === email)) throw new ProductAuthError("account_conflict", `An account already uses this email. Sign in with that account before linking ${input.provider === "google" ? "Google" : "WeChat"}.`);
    const nickname = input.nickname && /^[A-Za-z0-9 ]{2,30}$/.test(input.nickname.trim()) ? input.nickname.trim() : "Learner";
    const user: ProductUser = { id: id("user"), email, passwordHash: null, nickname, locale: input.locale === "zh-CN" ? "zh-CN" : "en-GB", role: process.env.BACKOFFICE_OPERATOR_EMAIL?.trim().toLowerCase() === email ? "operator" : "student", status: "active", emailVerifiedAt: now(), createdAt: now() };
    data.users.push(user);
    data.accounts.push({ id: id("account"), userId: user.id, provider: input.provider, providerSubject: input.providerSubject, createdAt: now() });
    data.notifications.unshift({ id: id("notification"), userId: user.id, title: "Welcome to Learning Guide", body: "Your account is ready. Start with the public lesson or activate the trial.", readAt: null, createdAt: now() });
    return user;
  });
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
  if (!user) return { accepted: true as const, user: null, token: null };
  return { accepted: true as const, user, token: await issueEmailVerificationToken(user.id, true) };
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
  const user = data.users.find((item) => item.email === email && item.status === "active" && item.passwordHash);
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
  return data.users.find((user) => user.id === session.userId && user.status === "active" && Boolean(user.emailVerifiedAt)) || null;
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
  return data.plans.filter((plan) => plan.device === "pc" && (courseId ? plan.courseId === courseId : ["category", "everything"].includes(plan.scope || "course")));
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
  const entitlement = data.entitlements.find((item) => item.userId === userId && (item.courseId === courseId || item.courseId === "*") && item.state === "active");
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

function grantTrialAccess(data: ProductData, userId: string, courseId: string) {
  const course = data.courses.find((item) => item.id === courseId);
  if (!course || course.status !== "published") throw new Error("Course is not available.");
  const existing = activeEntitlement(data, userId, courseId);
  if (existing) {
    const subscription = data.subscriptions.find((item) => item.userId === userId && item.courseId === courseId && item.source === "trial" && item.validTo === existing.validTo) || null;
    return { subscription, entitlement: existing };
  }
  const previousTrial = data.subscriptions.find((item) => item.userId === userId && item.courseId === courseId && item.source === "trial");
  if (previousTrial) {
    if (new Date(previousTrial.validTo) <= new Date()) {
      previousTrial.state = "expired";
      throw new Error("The three-day trial has ended.");
    }
    previousTrial.state = "active";
    const previousEntitlement = data.entitlements.find((item) => item.userId === userId && item.courseId === courseId && item.source === "trial" && item.validTo === previousTrial.validTo);
    if (previousEntitlement) {
      previousEntitlement.state = "active";
      return { subscription: previousTrial, entitlement: previousEntitlement };
    }
  }
  const validFrom = now();
  const trialEnd = new Date(validFrom);
  trialEnd.setUTCDate(trialEnd.getUTCDate() + TRIAL_DAYS);
  const subscription: ProductSubscription = { id: id("subscription"), userId, planId: "trial", courseId, state: "active", source: "trial", validFrom, validTo: trialEnd.toISOString(), cancelAtPeriodEnd: false, stripeSubscriptionId: null };
  const entitlement: ProductEntitlement = { id: id("entitlement"), userId, courseId, state: "active", source: "trial", validTo: subscription.validTo };
  data.subscriptions.unshift(subscription);
  data.entitlements.unshift(entitlement);
  data.notifications.unshift({ id: id("notification"), userId, title: "Trial activated", body: `${course.title} is available for ${TRIAL_DAYS} days.`, readAt: null, createdAt: now() });
  return { subscription, entitlement };
}

export async function activateTrial(userId: string, courseId: string) {
  return editData((data) => grantTrialAccess(data, userId, courseId).entitlement);
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
    let order = data.orders.find((item) => item.userId === userId && item.quoteId === quote.id && item.paymentMode === "demo" && item.kind === "purchase");
    if (!order) {
      order = { id: id("order"), userId, planId: plan.id, quoteId: quote.id, amountMinor: quote.amountMinor, currency: quote.currency, status: "pending", paymentMode: "demo", kind: "purchase", stripeCheckoutSessionId: null, stripeSubscriptionId: null, stripePaymentIntentId: null, createdAt: now() };
      data.orders.unshift(order);
    }
    if (order.status === "paid") {
      const subscription = data.subscriptions.find((item) => item.userId === userId && item.planId === plan.id && item.source === "purchase" && item.state !== "expired");
      const entitlement = data.entitlements.find((item) => item.userId === userId && item.courseId === plan.courseId && item.state === "active");
      if (subscription && entitlement) return { order, subscription, entitlement };
    }
    return fulfilDemoPurchase(data, userId, order, plan);
  });
}

function fulfilDemoPurchase(data: ProductData, userId: string, order: ProductOrder, plan: ProductPlan) {
    if (order.status === "paid") {
      const subscription = data.subscriptions.find((item) => item.userId === userId && item.planId === plan.id && item.source === "purchase" && item.state !== "expired");
      const entitlement = data.entitlements.find((item) => item.userId === userId && item.courseId === plan.courseId && item.state === "active");
      if (subscription && entitlement) return { order, subscription, entitlement };
    }
    if (!["pending", "paid"].includes(order.status)) throw new Error("This payment attempt cannot be completed.");
    order.status = "paid";
    order.failureReason = null;
    const validFrom = now();
    const subscription: ProductSubscription = { id: id("subscription"), userId, planId: plan.id, courseId: plan.courseId, state: "active", source: "purchase", validFrom, validTo: addMonths(validFrom, plan.termMonths), cancelAtPeriodEnd: false, stripeSubscriptionId: null };
    const entitlement: ProductEntitlement = { id: id("entitlement"), userId, courseId: plan.courseId, state: "active", source: "purchase", validTo: subscription.validTo };
    data.subscriptions.unshift(subscription);
    const trial = data.subscriptions.find((item) => item.userId === userId && item.courseId === plan.courseId && item.source === "trial" && item.state === "active");
    if (trial) trial.state = "expired";
    data.entitlements.forEach((item) => {
      if (item.userId === userId && item.courseId === plan.courseId && item.source === "trial" && item.state === "active") item.state = "expired";
    });
    data.entitlements = data.entitlements.filter((item) => !(item.userId === userId && item.courseId === plan.courseId && item.state === "active"));
    data.entitlements.unshift(entitlement);
    data.notifications.unshift({ id: id("notification"), userId, title: "Purchase complete", body: "Your course access is now available in My Learning.", readAt: null, createdAt: now() });
    return { order, subscription, entitlement };
}

export async function createPendingDemoOrder(userId: string, quoteId: string) {
  return editData((data) => {
    const quote = data.quotes.find((item) => item.id === quoteId && item.userId === userId);
    if (!quote || new Date(quote.expiresAt) <= new Date()) throw new Error("This quote has expired. Please calculate the price again.");
    const plan = data.plans.find((item) => item.id === quote.planId);
    if (!plan) throw new Error("Plan not found.");
    const existing = data.orders.find((item) => item.userId === userId && item.quoteId === quote.id && item.paymentMode === "demo" && item.kind === "purchase" && ["pending", "paid"].includes(item.status));
    if (existing) return { order: existing, plan };
    const order: ProductOrder = { id: id("order"), userId, planId: plan.id, quoteId: quote.id, amountMinor: quote.amountMinor, currency: quote.currency, status: "pending", paymentMode: "demo", kind: "purchase", stripeCheckoutSessionId: null, stripeSubscriptionId: null, stripePaymentIntentId: null, createdAt: now() };
    data.orders.unshift(order);
    return { order, plan };
  });
}

export async function completeDemoOrder(userId: string, orderId: string) {
  return editData((data) => {
    const order = data.orders.find((item) => item.id === orderId && item.userId === userId && item.paymentMode === "demo" && item.kind === "purchase");
    if (!order) throw new Error("Payment order not found.");
    const plan = data.plans.find((item) => item.id === order.planId);
    if (!plan) throw new Error("Plan not found.");
    return fulfilDemoPurchase(data, userId, order, plan);
  });
}

export async function createPendingDemoTrialOrder(userId: string, planId: string, courseId?: string) {
  return editData((data) => {
    const plan = data.plans.find((item) => item.id === planId) || data.plans.find((item) => !planId && item.courseId === courseId);
    if (!plan) throw new Error("Plan not found.");
    const course = data.courses.find((item) => item.id === plan.courseId);
    if (!course || course.status !== "published") throw new Error("Course is not available.");
    const existing = data.orders.find((item) => item.userId === userId && item.planId === plan.id && item.paymentMode === "demo" && item.kind === "trial_activation" && ["pending", "paid"].includes(item.status));
    if (existing) return { order: existing, plan };
    if (data.entitlements.some((item) => item.userId === userId && item.courseId === plan.courseId && item.state === "active" && new Date(item.validTo) > new Date())) throw new Error("This course already has active access.");
    if (data.subscriptions.some((item) => item.userId === userId && item.courseId === plan.courseId && item.source === "trial")) throw new Error("The three-day trial has already been used for this course.");
    const createdAt = now();
    const quote: ProductQuote = { id: id("trial_quote"), userId, planId: plan.id, amountMinor: plan.amountMinor, currency: plan.currency, expiresAt: new Date(Date.now() + QUOTE_MINUTES * 60_000).toISOString(), createdAt };
    const order: ProductOrder = { id: id("order"), userId, planId: plan.id, quoteId: quote.id, amountMinor: 0, currency: plan.currency, status: "pending", paymentMode: "demo", kind: "trial_activation", stripeCheckoutSessionId: null, stripeSubscriptionId: null, stripePaymentIntentId: null, createdAt };
    data.quotes.unshift(quote);
    data.orders.unshift(order);
    return { order, plan };
  });
}

export async function completeDemoTrialOrder(userId: string, orderId: string) {
  return editData((data) => {
    const order = data.orders.find((item) => item.id === orderId && item.userId === userId && item.paymentMode === "demo" && item.kind === "trial_activation");
    if (!order) throw new Error("Trial order not found.");
    const plan = data.plans.find((item) => item.id === order.planId);
    if (!plan) throw new Error("Plan not found.");
    if (!["pending", "paid"].includes(order.status)) throw new Error("This trial payment attempt cannot be completed.");
    const result = grantTrialAccess(data, userId, plan.courseId);
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
    const plan = data.plans.find((item) => item.id === quote.planId);
    if (!plan) throw new Error("Plan not found.");
    const existing = data.orders.find((item) => item.userId === userId && item.quoteId === quote.id && ["pending", "paid"].includes(item.status));
    if (existing) return { order: existing, plan };
    const order: ProductOrder = { id: id("order"), userId, planId: plan.id, quoteId: quote.id, amountMinor: quote.amountMinor, currency: quote.currency, status: "pending", paymentMode: "stripe", kind: "purchase", stripeCheckoutSessionId: null, stripeSubscriptionId: null, stripePaymentIntentId: null, createdAt: now() };
    data.orders.unshift(order);
    return { order, plan };
  });
}

export async function createPendingStripeTrialOrder(userId: string, planId: string) {
  return editData((data) => {
    const plan = data.plans.find((item) => item.id === planId);
    if (!plan) throw new Error("Plan not found.");
    const course = data.courses.find((item) => item.id === plan.courseId);
    if (!course || course.status !== "published") throw new Error("Course is not available.");
    if (data.entitlements.some((item) => item.userId === userId && item.courseId === plan.courseId && item.state === "active" && new Date(item.validTo) > new Date())) throw new Error("This course already has active access.");
    const existingTrial = data.subscriptions.find((item) => item.userId === userId && item.courseId === plan.courseId && item.source === "trial" && item.state !== "expired" && new Date(item.validTo) > new Date());
    if (existingTrial) throw new Error("A trial is already active for this course.");
    const createdAt = now();
    const quote: ProductQuote = { id: id("trial_quote"), userId, planId, amountMinor: plan.amountMinor, currency: plan.currency, expiresAt: new Date(Date.now() + QUOTE_MINUTES * 60_000).toISOString(), createdAt };
    data.quotes.unshift(quote);
    const existing = data.orders.find((item) => item.userId === userId && item.quoteId === quote.id && ["pending", "paid"].includes(item.status));
    if (existing) return { order: existing, plan };
    const order: ProductOrder = { id: id("order"), userId, planId, quoteId: quote.id, amountMinor: 0, currency: plan.currency, status: "pending", paymentMode: "stripe", kind: "trial_activation", stripeCheckoutSessionId: null, stripeSubscriptionId: null, stripePaymentIntentId: null, createdAt };
    data.orders.unshift(order);
    return { order, plan };
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
    const subscription: ProductSubscription = { id: id("subscription"), userId: order.userId, planId: plan.id, courseId: plan.courseId, state: "active", source: "trial", validFrom, validTo: trialEnd.toISOString(), cancelAtPeriodEnd: false, stripeSubscriptionId: input.subscriptionId, stripeCustomerId: input.customerId || null, graceEndsAt: null };
    const entitlement: ProductEntitlement = { id: id("entitlement"), userId: order.userId, courseId: plan.courseId, state: "active", source: "trial", validTo: subscription.validTo };
    data.subscriptions.unshift(subscription);
    data.entitlements = data.entitlements.filter((item) => !(item.userId === order.userId && item.courseId === plan.courseId && item.state === "active"));
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
    const trialEntitlement = data.entitlements.find((item) => item.userId === trial.userId && item.courseId === trial.courseId && item.source === "trial" && item.state === "active");
    if (trialEntitlement) trialEntitlement.state = "expired";
    const validFrom = now();
    const subscription: ProductSubscription = { id: id("subscription"), userId: trial.userId, planId: plan.id, courseId: plan.courseId, state: "active", source: "purchase", validFrom, validTo: addMonths(validFrom, plan.termMonths), cancelAtPeriodEnd: false, stripeSubscriptionId: input.subscriptionId, stripeCustomerId: trial.stripeCustomerId || null, graceEndsAt: null };
    const order: ProductOrder = { id: id("order"), userId: trial.userId, planId: plan.id, quoteId: `invoice_${input.invoiceId}`, amountMinor: input.amountMinor, currency: plan.currency, status: "paid", paymentMode: "stripe", kind: "purchase", stripeCheckoutSessionId: null, stripeSubscriptionId: input.subscriptionId, stripePaymentIntentId: input.paymentIntentId || null, stripeInvoiceId: input.invoiceId, lastStripeStatus: "paid", lastSyncedAt: now(), createdAt: now() };
    const entitlement: ProductEntitlement = { id: id("entitlement"), userId: trial.userId, courseId: plan.courseId, state: "active", source: "purchase", validTo: subscription.validTo };
    data.subscriptions.unshift(subscription);
    data.entitlements = data.entitlements.filter((item) => !(item.userId === trial.userId && item.courseId === plan.courseId && item.state === "active"));
    data.entitlements.unshift(entitlement);
    data.orders.unshift(order);
    data.notifications.unshift({ id: id("notification"), userId: trial.userId, title: "Subscription active", body: "Your trial has converted and course access continues.", readAt: null, createdAt: now() });
    return order;
  });
}

export async function applyStripePaidInvoice(input: { subscriptionId: string; invoiceId: string; amountMinor: number; paymentIntentId?: string | null; currentPeriodStart?: string | null; currentPeriodEnd?: string | null }) {
  return editData((data) => {
    if (data.orders.some((order) => order.stripeInvoiceId === input.invoiceId)) return null;
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
    const entitlement = data.entitlements.find((item) => item.userId === subscription.userId && item.courseId === subscription.courseId && item.source === "purchase" && item.state === "active");
    if (entitlement) entitlement.validTo = end;
    const initialOrder = data.orders.find((order) => order.stripeSubscriptionId === input.subscriptionId && order.kind === "purchase" && !order.stripeInvoiceId);
    if (initialOrder) {
      initialOrder.stripeInvoiceId = input.invoiceId;
      initialOrder.stripePaymentIntentId = input.paymentIntentId || initialOrder.stripePaymentIntentId || null;
      initialOrder.lastStripeStatus = "paid";
      initialOrder.lastSyncedAt = now();
      return initialOrder;
    }
    const order: ProductOrder = { id: id("order"), userId: subscription.userId, planId: plan.id, quoteId: `invoice_${input.invoiceId}`, amountMinor: input.amountMinor, currency: plan.currency, status: "paid", paymentMode: "stripe", kind: "purchase", stripeCheckoutSessionId: null, stripeSubscriptionId: input.subscriptionId, stripePaymentIntentId: input.paymentIntentId || null, stripeInvoiceId: input.invoiceId, lastStripeStatus: "paid", lastSyncedAt: now(), createdAt: now() };
    data.orders.unshift(order);
    data.notifications.unshift({ id: id("notification"), userId: subscription.userId, title: "Subscription renewed", body: "Your subscription payment was successful and course access continues.", readAt: null, createdAt: now() });
    return order;
  });
}

export async function markStripeTrialGrace(subscriptionId: string) {
  return editData((data) => {
    const subscription = data.subscriptions.find((item) => item.stripeSubscriptionId === subscriptionId && item.source === "trial" && item.state !== "expired");
    if (!subscription) return null;
    const graceEnd = new Date();
    graceEnd.setUTCDate(graceEnd.getUTCDate() + TRIAL_DAYS);
    subscription.state = "grace";
    subscription.graceEndsAt = graceEnd.toISOString();
    subscription.validTo = graceEnd.toISOString();
    const entitlement = data.entitlements.find((item) => item.userId === subscription.userId && item.courseId === subscription.courseId && item.source === "trial" && item.state === "active");
    if (entitlement) entitlement.validTo = subscription.validTo;
    data.notifications.unshift({ id: id("notification"), userId: subscription.userId, title: "Payment requires attention", body: "Your course access remains available while payment is resolved.", readAt: null, createdAt: now() });
    return subscription;
  });
}

export async function markStripeSubscriptionGrace(subscriptionId: string) {
  return editData((data) => {
    const subscription = data.subscriptions.find((item) => item.stripeSubscriptionId === subscriptionId && item.source === "purchase" && item.state !== "expired");
    if (!subscription) return null;
    const graceEnd = new Date();
    graceEnd.setUTCDate(graceEnd.getUTCDate() + TRIAL_DAYS);
    subscription.state = "grace";
    subscription.graceEndsAt = graceEnd.toISOString();
    subscription.validTo = graceEnd.toISOString();
    const entitlement = data.entitlements.find((item) => item.userId === subscription.userId && item.courseId === subscription.courseId && item.source === "purchase" && item.state === "active");
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
  const subscription: ProductSubscription = { id: id("subscription"), userId, planId: plan.id, courseId: plan.courseId, state: "active", source: "purchase", validFrom, validTo: addMonths(validFrom, plan.termMonths), cancelAtPeriodEnd: false, stripeSubscriptionId: stripeSubscriptionId || null, stripeCustomerId: stripeCustomerId || null };
  const entitlement: ProductEntitlement = { id: id("entitlement"), userId, courseId: plan.courseId, state: "active", source: "purchase", validTo: subscription.validTo };
  data.subscriptions.unshift(subscription);
  const trial = data.subscriptions.find((item) => item.userId === userId && item.courseId === plan.courseId && item.source === "trial" && item.state === "active");
  if (trial) trial.state = "expired";
  data.entitlements.forEach((item) => {
    if (item.userId === userId && item.courseId === plan.courseId && item.source === "trial" && item.state === "active") item.state = "expired";
  });
  data.entitlements = data.entitlements.filter((item) => !(item.userId === userId && item.courseId === plan.courseId && item.state === "active"));
  data.entitlements.unshift(entitlement);
  data.notifications.unshift({ id: id("notification"), userId, title: "Purchase complete", body: "Your course access is now available in My Learning.", readAt: null, createdAt: now() });
  return order;
}

export async function fulfilStripeCheckout(input: { eventId: string; eventType: string; sessionId: string; userId: string; quoteId: string; planId: string; subscriptionId?: string; customerId?: string; paymentIntentId?: string }) {
  return editData((data) => {
    data.stripeEvents ||= [];
    if (data.stripeEvents.some((item) => item.id === input.eventId)) return { duplicate: true, order: null };
    data.stripeEvents.unshift({ id: input.eventId, type: input.eventType, processedAt: now() });
    const order = data.orders.find((item) => item.userId === input.userId && (item.stripeCheckoutSessionId === input.sessionId || item.quoteId === input.quoteId));
    const plan = data.plans.find((item) => item.id === input.planId);
    if (!order || !plan) return { duplicate: false, order: null };
    const paid = grantPurchaseAccess(data, input.userId, plan, order.amountMinor, order.quoteId, input.sessionId, input.subscriptionId, input.customerId, input.paymentIntentId);
    return { duplicate: false, order: paid };
  });
}

export async function claimStripeEvent(eventId: string, eventType: string) {
  return editData((data) => {
    data.stripeEvents ||= [];
    if (data.stripeEvents.some((item) => item.id === eventId)) return false;
    data.stripeEvents.unshift({ id: eventId, type: eventType, processedAt: now() });
    return true;
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
  return editData((data) => {
    const currentTime = new Date();
    data.entitlements.forEach((entitlement) => {
      if (entitlement.state === "active" && new Date(entitlement.validTo) <= currentTime) entitlement.state = "expired";
    });
    data.subscriptions.forEach((subscription) => {
      if (["active", "cancel_at_period_end", "grace"].includes(subscription.state) && new Date(subscription.validTo) <= currentTime) subscription.state = "expired";
    });
    const records = data.studyRecords.filter((record) => record.userId === userId);
    // My Learning is a study history, not an access list. Access appears here only
    // after the learner opens the full course and a Study Record exists.
    const courseIds = [...new Set(records.map((record) => record.courseId))];
    const courses = courseIds.map((courseId) => {
      const record = records.find((item) => item.courseId === courseId);
      const course = data.courses.find((item) => item.id === courseId);
      const entitlement = activeEntitlement(data, userId, courseId);
      const lessons = course?.sections.flatMap((section) => section.lessons) || [];
      const completedLessonIds = data.studyEvents.filter((event) => event.userId === userId && event.courseId === courseId && event.event === "complete").map((event) => event.lessonId);
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
        progress: record?.progress || 0,
        completedAt: record?.completedAt || null,
        completedLessonIds: [...new Set(completedLessonIds)],
        courseTitle: course?.title || courseId,
        entitlement,
      };
    });
    const subscriptions = data.subscriptions.filter((item) => item.userId === userId).map((subscription) => ({ ...subscription, plan: data.plans.find((plan) => plan.id === subscription.planId) || null }));
    const orders = data.orders.filter((item) => item.userId === userId).map((order) => ({ ...order, plan: data.plans.find((plan) => plan.id === order.planId) || null }));
    const notifications = data.notifications.filter((item) => item.userId === userId).slice(0, 20);
    const entitlements = data.entitlements.filter((item) => item.userId === userId && item.state === "active" && new Date(item.validTo) > currentTime);
    return { courses, subscriptions, orders, notifications, entitlements };
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
      const entitlement = data.entitlements.find((item) => item.userId === order.userId && item.courseId === plan.courseId && item.source === "purchase" && item.state === "active");
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
        const subscription: ProductSubscription = { id: id("subscription"), userId: order.userId, planId: plan.id, courseId: plan.courseId, state: "active", source: "trial", validFrom, validTo: trialEnd.toISOString(), cancelAtPeriodEnd: false, stripeSubscriptionId: order.stripeSubscriptionId || input.subscriptionId || null, stripeCustomerId: input.customerId || null, graceEndsAt: null };
        const entitlement: ProductEntitlement = { id: id("entitlement"), userId: order.userId, courseId: plan.courseId, state: "active", source: "trial", validTo: subscription.validTo };
        data.subscriptions.unshift(subscription);
        data.entitlements = data.entitlements.filter((item) => !(item.userId === order.userId && item.courseId === plan.courseId && item.state === "active"));
        data.entitlements.unshift(entitlement);
        data.notifications.unshift({ id: id("notification"), userId: order.userId, title: "Trial activated", body: `${plan.name} is available for ${TRIAL_DAYS} days.`, readAt: null, createdAt: now() });
        addOrderActivity(data, { orderId: order.id, operatorId: input.operatorId, action: "resynchronise", result: "succeeded", reason: null, providerReference: order.stripeCheckoutSessionId || null });
        return order;
      }
      const paid = grantPurchaseAccess(data, order.userId, plan, order.amountMinor, order.quoteId, order.stripeCheckoutSessionId || undefined, order.stripeSubscriptionId || undefined, input.customerId || undefined, order.stripePaymentIntentId || undefined);
      addOrderActivity(data, { orderId: order.id, operatorId: input.operatorId, action: "resynchronise", result: "succeeded", reason: null, providerReference: order.stripeCheckoutSessionId || null });
      return paid;
    }
    order.status = input.stripeStatus === "processing" ? "pending" : input.stripeStatus;
    addOrderActivity(data, { orderId: order.id, operatorId: input.operatorId, action: "resynchronise", result: input.stripeStatus === "processing" ? "processing" : "succeeded", reason: input.reason || null, providerReference: order.stripeCheckoutSessionId || null });
    return order;
  });
}

export async function recordStudyEvent(input: { userId: string; courseId: string; lessonId: string; event: ProductStudyEvent["event"]; seconds: number; clientEventId: string }) {
  return editData((data) => {
    if (!input.clientEventId.trim()) throw new Error("A client event id is required.");
    if (!["open", "video_progress", "text_progress", "complete"].includes(input.event)) throw new Error("Invalid study event.");
    if (!activeEntitlement(data, input.userId, input.courseId)) throw new Error("Course access is required.");
    const course = data.courses.find((item) => item.id === input.courseId);
    if (!course || course.status !== "published") throw new Error("Course is not available.");
    const lesson = course?.sections.flatMap((section) => section.lessons).find((item) => item.id === input.lessonId);
    if (!lesson) throw new Error("Lesson not found.");
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
    record.progress = Math.min(100, Math.round((record.totalSeconds / Math.max(60, totalCourseSeconds)) * 100));
    if (record.progress >= 100) record.completedAt = record.completedAt || now();
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
    if (input.isPublic) course.sections.forEach((item) => item.lessons.forEach((lesson) => { lesson.isPublic = false; }));
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
