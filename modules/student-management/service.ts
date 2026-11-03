// Student Management application service (PRD sections 3 to 8). Business rules only: Route Handlers parse and
// authorise, this file reads and changes the product aggregate through productStore's queue, and featureAccess.ts
// decides access. Every change records who made it (StaffActor from the Backoffice) in studentAdminEvents.
import { createHash, randomBytes } from "node:crypto";
import {
  FEATURE_KEYS,
  StudentProblem,
  type EmergencyInput,
  type EmailVerification,
  type FeatureKey,
  type FeatureSettingsInput,
  type FeatureSettingsResponse,
  type MyFeaturesResponse,
  type OverridesInput,
  type SignInMethod,
  type StaffActor,
  type StudentActionInput,
  type StudentActionResponse,
  type StudentDetails,
  type StudentListItem,
  type StudentListQuery,
  type StudentListResponse,
  type StudentSubscription,
} from "@/contracts/student-management";
import { emailDeliveryConfigured, sendPasswordResetEmail, sendVerificationEmail, sendHelpdeskUpdateEmail } from "@/services/emailService";
import { withPlanAiPoints } from "@/services/planAiPoints";
import {
  editProductData,
  issueEmailVerificationToken,
  issuePasswordResetToken,
  readProductData,
  type ProductData,
  type ProductPlan,
  type ProductSubscription,
  type ProductUser,
  type StaffRecord,
} from "@/services/productStore";
import { publicAppOrigin } from "@/services/runtimeConfig";
import { decideAll, decideFeature, FEATURE_CATALOGUE, featureState, globalSetting, hasAiTutor, isCurrentSubscription, overrideFor } from "./featureAccess";

const ALL_COURSES = "All courses";

/** Learning accounts only: staff accounts and records merged into another account are not students (PRD 3.2). */
export function isLearner(user: ProductUser) {
  return (user.role ?? "student") === "student" && user.status !== "disabled" && !user.mergedIntoUserId;
}

function accountStatus(user: ProductUser) {
  return user.deactivatedAt ? "inactive" as const : "active" as const;
}

function emailVerification(user: ProductUser): EmailVerification {
  if (!user.emailVerifiedAt) return "pending";
  return user.emailExemption ? "admin_exempt" : "verified";
}

function stamp(record: StaffRecord | null | undefined) {
  return record ? { at: record.at, byName: record.byName } : null;
}

function staffRecord(actor: StaffActor): StaffRecord {
  return { at: new Date().toISOString(), byId: actor.id, byName: actor.name };
}

function recordEvent(data: ProductData, event: { userId: string | null; action: string; actor: StaffActor; before: unknown; after: unknown; reason?: string | null; reference?: string | null }) {
  (data.studentAdminEvents ||= []).push({
    id: `sme_${Date.now()}_${randomBytes(4).toString("hex")}`,
    userId: event.userId,
    action: event.action,
    actor: { id: event.actor.id, name: event.actor.name, role: event.actor.role },
    before: event.before ?? null,
    after: event.after ?? null,
    reason: event.reason ?? null,
    reference: event.reference ?? null,
    createdAt: new Date().toISOString(),
  });
}

function findLearner(data: ProductData, userId: string) {
  const user = data.users.find((item) => item.id === userId);
  if (!user || !isLearner(user)) throw new StudentProblem("not_found", "No such student.");
  return user;
}

function subscriptionLabel(data: ProductData, subscription: ProductSubscription, plan: ProductPlan | undefined) {
  const scope = subscription.scope || plan?.scope || (subscription.courseId === "*" ? "everything" : "course");
  if (scope === "everything") return ALL_COURSES;
  if (scope === "category") return subscription.scopeId || plan?.category || plan?.name || "Category";
  const courseId = subscription.scopeId || subscription.courseId;
  return data.courses.find((course) => course.id === courseId)?.title || plan?.name || courseId;
}

function orderFor(data: ProductData, subscription: ProductSubscription) {
  const paid = data.orders.filter((order) => order.userId === subscription.userId && (order.status === "paid" || order.status === "refunded"));
  const byStripe = subscription.stripeSubscriptionId ? paid.filter((order) => order.stripeSubscriptionId === subscription.stripeSubscriptionId) : [];
  const candidates = byStripe.length ? byStripe : paid.filter((order) => order.planId === subscription.planId && Date.parse(order.createdAt) <= Date.parse(subscription.validFrom) + 86_400_000);
  return candidates.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]?.id ?? null;
}

function subscriptionsOf(data: ProductData, userId: string, plans: ProductPlan[], at: number): StudentSubscription[] {
  return data.subscriptions
    .filter((item) => item.userId === userId)
    .map((item) => {
      const plan = plans.find((candidate) => candidate.id === item.planId);
      const current = isCurrentSubscription(item, at);
      return {
        id: item.id,
        label: subscriptionLabel(data, item, plan),
        scope: (item.scope || plan?.scope || (item.courseId === "*" ? "everything" : "course")) as StudentSubscription["scope"],
        device: item.device || plan?.device || "pc",
        source: item.source,
        state: current || item.state === "expired" || item.state === "trial_canceled" ? item.state : "expired",
        current,
        aiTutor: (plan?.aiPoints ?? 0) > 0,
        validFrom: item.validFrom,
        validTo: item.validTo,
        graceEndsAt: item.graceEndsAt ?? null,
        renews: current && item.state === "active" && !item.cancelAtPeriodEnd,
        orderId: orderFor(data, item),
      } satisfies StudentSubscription;
    })
    // Current plans first (soonest end last within them), then ended ones, newest first.
    .sort((a, b) => Number(b.current) - Number(a.current) || b.validTo.localeCompare(a.validTo));
}

function specialAccessOf(data: ProductData, userId: string) {
  return featureState(data).overrides
    .filter((item) => item.userId === userId && (FEATURE_KEYS as readonly string[]).includes(item.feature))
    .sort((a, b) => FEATURE_KEYS.indexOf(a.feature as FeatureKey) - FEATURE_KEYS.indexOf(b.feature as FeatureKey))
    .map((item) => ({ feature: item.feature as FeatureKey, value: item.value }));
}

function overridesVersion(data: ProductData, userId: string) {
  const rows = featureState(data).overrides.filter((item) => item.userId === userId).map((item) => [item.feature, item.value, item.updated.at]).sort();
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex").slice(0, 16);
}

function signInMethods(data: ProductData, user: ProductUser): SignInMethod[] {
  const methods: SignInMethod[] = [];
  if (user.passwordHash) methods.push("email");
  for (const provider of ["google", "wechat"] as const) if (data.accounts.some((account) => account.userId === user.id && account.provider === provider)) methods.push(provider);
  return methods;
}

function passwordLink(user: ProductUser): StudentDetails["passwordLink"] {
  if (user.deactivatedAt) return { available: false, blockedBy: "inactive" };
  if (!user.email) return { available: false, blockedBy: "no_email" };
  if (!user.emailVerifiedAt) return { available: false, blockedBy: "email_unverified" };
  return { available: true, kind: user.passwordHash ? "reset" : "setup" };
}

function details(data: ProductData, user: ProductUser, at = Date.now()): StudentDetails {
  const plans = withPlanAiPoints(data.plans);
  return {
    id: user.id,
    name: user.nickname,
    email: user.email,
    accountStatus: accountStatus(user),
    deactivation: user.deactivatedAt && user.deactivation ? { at: user.deactivation.at, byName: user.deactivation.byName, reason: user.deactivation.reason } : null,
    emailVerification: emailVerification(user),
    emailExemption: user.emailVerifiedAt && user.emailExemption ? { at: user.emailExemption.at, byName: user.emailExemption.byName, reference: user.emailExemption.reference } : null,
    emailChange: user.emailChange ? { at: user.emailChange.at, byName: user.emailChange.byName, reference: user.emailChange.reference } : null,
    registeredAt: user.createdAt,
    profile: { country: user.country || null, ageRange: user.ageRange || null, education: user.education || null, interests: user.areasOfInterest || [], language: user.locale === "zh-CN" ? "zh-CN" : "en-GB" },
    signInMethods: signInMethods(data, user),
    hasPassword: Boolean(user.passwordHash),
    subscriptions: subscriptionsOf(data, user.id, plans, at),
    features: decideAll(data, user, at).map(({ feature, override, enabled, reason }) => ({ feature, override, enabled, reason })),
    overridesVersion: overridesVersion(data, user.id),
    passwordLink: passwordLink(user),
  };
}

// ------------------------------------------------------------------ list

function matchesSubscription(data: ProductData, userId: string, filter: StudentListQuery["subscription"], at: number) {
  if (!filter) return true;
  const current = data.subscriptions.filter((item) => item.userId === userId && isCurrentSubscription(item, at));
  if (filter === "none") return current.length === 0;
  if (filter === "current") return current.length > 0;
  if (filter === "grace") return current.some((item) => item.state === "grace");
  return current.some((item) => item.state === "cancel_at_period_end" || item.cancelAtPeriodEnd);
}

function listItem(data: ProductData, user: ProductUser, plans: ProductPlan[], at: number): StudentListItem {
  const current = subscriptionsOf(data, user.id, plans, at).filter((item) => item.current);
  return {
    id: user.id,
    name: user.nickname,
    email: user.email,
    accountStatus: accountStatus(user),
    emailVerification: emailVerification(user),
    subscription: { count: current.length, label: current[0]?.label ?? null, state: current[0]?.state ?? null },
    specialAccess: specialAccessOf(data, user.id),
    registeredAt: user.createdAt,
  };
}

export async function listStudents(query: StudentListQuery, at = Date.now()): Promise<StudentListResponse> {
  const data = await readProductData();
  const learners = data.users.filter(isLearner);
  const counts = { total: learners.length, active: learners.filter((user) => !user.deactivatedAt).length, inactive: learners.filter((user) => user.deactivatedAt).length };
  const needle = query.q?.toLowerCase();
  const filtered = learners.filter((user) => {
    if (needle && !(user.nickname.toLowerCase().includes(needle) || (user.email || "").includes(needle) || user.id.toLowerCase() === needle)) return false;
    if (query.status && accountStatus(user) !== query.status) return false;
    if (!matchesSubscription(data, user.id, query.subscription, at)) return false;
    if (query.special) {
      const special = specialAccessOf(data, user.id);
      if (query.special === "none" && special.length) return false;
      if (query.special === "any" && !special.length) return false;
      if (query.special !== "none" && query.special !== "any" && !special.some((item) => item.feature === query.special)) return false;
    }
    return true;
  });
  // Latest registration first; the id keeps the order stable between pages (PRD 3.1).
  filtered.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  const plans = withPlanAiPoints(data.plans);
  const start = (query.page - 1) * query.pageSize;
  return { items: filtered.slice(start, start + query.pageSize).map((user) => listItem(data, user, plans, at)), total: filtered.length, page: query.page, pageSize: query.pageSize, counts };
}

export async function getStudent(userId: string): Promise<StudentDetails> {
  const data = await readProductData();
  return details(data, findLearner(data, userId));
}

// ------------------------------------------------------------------ individual overrides (PRD 6.2, 6.4)

export async function saveOverrides(userId: string, input: OverridesInput): Promise<StudentDetails> {
  return editProductData((data) => {
    const user = findLearner(data, userId);
    if (user.deactivatedAt) throw new StudentProblem("account_inactive", "Reactivate the account before changing its access.");
    if (overridesVersion(data, userId) !== input.expectedVersion) throw new StudentProblem("version_conflict", "Someone else changed this student's access. Reload to see the latest.");
    const state = (data.featureAccess ||= { globals: [], overrides: [], version: 0 });
    for (const feature of FEATURE_KEYS) {
      const next = input.overrides[feature];
      if (next === undefined) continue;
      const before = overrideFor(data, userId, feature);
      if (before === next) continue;
      state.overrides = state.overrides.filter((item) => !(item.userId === userId && item.feature === feature));
      if (next !== "default") state.overrides.push({ userId, feature, value: next, reason: input.reason, updated: staffRecord(input.actor) });
      recordEvent(data, { userId, action: "feature_override.changed", actor: input.actor, before: { feature, value: before }, after: { feature, value: next }, reason: input.reason });
    }
    return details(data, user);
  });
}

// ------------------------------------------------------------------ account actions (PRD 4.2, 5)

function emailUnavailable(): never {
  throw new StudentProblem("email_unavailable", "Email delivery is not configured in this environment.");
}

async function trySend(send: () => Promise<unknown>) {
  try { await send(); return true; } catch { return false; }
}

function cooldown(error: unknown): never {
  if (error instanceof Error && (error.message.startsWith("VERIFICATION_COOLDOWN") || error.message === "VERIFICATION_DAILY_LIMIT" || error.message.startsWith("Please wait"))) {
    throw new StudentProblem("rate_limited", "A link was sent moments ago. Wait a minute before sending another.");
  }
  throw error;
}

function verifyUrl(origin: string, locale: string, token: string) {
  return `${origin}/${locale}/portal/verify-email?token=${encodeURIComponent(token)}`;
}

export async function runStudentAction(userId: string, input: StudentActionInput, request: Request): Promise<StudentActionResponse> {
  switch (input.action) {
    case "deactivate":
    case "activate": {
      const student = await editProductData((data) => {
        const user = findLearner(data, userId);
        const deactivate = input.action === "deactivate";
        // Repeating the same action changes nothing and records nothing (idempotent).
        if (Boolean(user.deactivatedAt) === deactivate) return details(data, user);
        const before = accountStatus(user);
        if (deactivate) {
          const record = staffRecord(input.actor);
          user.deactivatedAt = record.at;
          user.deactivation = { ...record, reason: input.reason };
          // PRD 4.2: sign the learner out everywhere now. Subscriptions and Stripe are not touched.
          data.sessions = data.sessions.filter((session) => session.userId !== user.id);
        } else {
          user.deactivatedAt = null;
          user.deactivation = null;
        }
        recordEvent(data, { userId, action: deactivate ? "account.deactivated" : "account.activated", actor: input.actor, before: { status: before }, after: { status: accountStatus(user) }, reason: input.reason });
        return details(data, user);
      });
      return { student, email: null };
    }
    case "change_email": {
      const configured = emailDeliveryConfigured();
      const origin = configured && !input.exemption ? publicAppOrigin(request) : "";
      const { student, previousEmail, locale } = await editProductData((data) => {
        const user = findLearner(data, userId);
        if (user.email === input.email) throw new StudentProblem("validation_failed", "This is already the student's email.", "email");
        // PRD 5.2 / ST-05: never merge or reassign; any other record holding the address blocks the change.
        if (data.users.some((item) => item.id !== user.id && (item.email || "").toLowerCase() === input.email)) throw new StudentProblem("email_taken", "This email belongs to another account. Use the account recovery process.", "email");
        const record = staffRecord(input.actor);
        const previous = user.email;
        const before = { email: previous, verification: emailVerification(user) };
        user.email = input.email;
        user.emailChange = { ...record, reference: input.reason, previousEmail: previous };
        if (input.exemption) {
          user.emailVerifiedAt = record.at;
          user.emailExemption = { ...record, reference: input.exemption.reference };
        } else {
          user.emailVerifiedAt = null;
          user.emailExemption = null;
        }
        // Links minted for the old address must not work any more, and sessions are revalidated (PRD 5.2).
        for (const token of [...data.verificationTokens, ...data.passwordResetTokens]) if (token.userId === user.id && !token.usedAt) token.usedAt = record.at;
        data.sessions = data.sessions.filter((session) => session.userId !== user.id);
        recordEvent(data, { userId, action: input.exemption ? "email.changed_admin_exempt" : "email.changed", actor: input.actor, before, after: { email: user.email, verification: emailVerification(user) }, reason: input.reason, reference: input.exemption?.reference ?? null });
        return { student: details(data, user), previousEmail: previous, locale: user.locale === "zh-CN" ? "zh-CN" as const : "en-GB" as const };
      });
      if (!configured) return { student, email: { sent: false } };
      let sent: boolean;
      if (input.exemption) {
        sent = await trySend(() => sendHelpdeskUpdateEmail({ to: input.email, subject: locale === "zh-CN" ? "Learning Guide 账号邮箱已更新" : "Your Learning Guide email was updated", text: locale === "zh-CN" ? "您好：\n\n您的 Learning Guide 账号联系邮箱已由客服更新为这个地址。如果这不是您申请的，请联系我们。\n\nLearning Guide" : "Hello,\n\nOur support team updated the contact email of your Learning Guide account to this address. If you did not ask for this, please contact us.\n\nLearning Guide" }));
      } else {
        // The change is already saved: a failure here is reported as not sent (the drawer offers Resend), never as an error.
        const token = await issueEmailVerificationToken(userId).catch(() => null);
        sent = token !== null && await trySend(() => sendVerificationEmail({ to: input.email, url: verifyUrl(origin, locale, token), locale }));
      }
      if (previousEmail) {
        // Best effort, and it never says the new address (PRD 5.2).
        await trySend(() => sendHelpdeskUpdateEmail({ to: previousEmail, subject: locale === "zh-CN" ? "Learning Guide 账号邮箱已更改" : "Your Learning Guide email was changed", text: locale === "zh-CN" ? "您好：\n\n您的 Learning Guide 账号联系邮箱已由客服更改，此地址不再用于登录。如果这不是您申请的，请联系我们。\n\nLearning Guide" : "Hello,\n\nOur support team changed the contact email of your Learning Guide account. This address is no longer used to sign in. If you did not ask for this, please contact us.\n\nLearning Guide" }));
      }
      return { student, email: { sent } };
    }
    case "resend_verification": {
      if (!emailDeliveryConfigured()) emailUnavailable();
      const origin = publicAppOrigin(request);
      const data = await readProductData();
      const user = findLearner(data, userId);
      if (user.deactivatedAt) throw new StudentProblem("account_inactive", "Reactivate the account first.");
      if (!user.email) throw new StudentProblem("validation_failed", "This account has no email address.");
      if (user.emailVerifiedAt) throw new StudentProblem("validation_failed", "This email is already verified.");
      const token = await issueEmailVerificationToken(userId, true).catch(cooldown);
      const locale = user.locale === "zh-CN" ? "zh-CN" : "en-GB";
      if (!(await trySend(() => sendVerificationEmail({ to: user.email!, url: verifyUrl(origin, locale, token), locale })))) throw new StudentProblem("email_delivery_failed", "The verification email could not be sent. Try again.");
      const student = await editProductData((current) => {
        const target = findLearner(current, userId);
        recordEvent(current, { userId, action: "email.verification_sent", actor: input.actor, before: null, after: { email: target.email } });
        return details(current, target);
      });
      return { student, email: { sent: true } };
    }
    case "send_password_link": {
      if (!emailDeliveryConfigured()) emailUnavailable();
      const origin = publicAppOrigin(request);
      const data = await readProductData();
      const user = findLearner(data, userId);
      const link = passwordLink(user);
      if (!link.available) {
        if (link.blockedBy === "inactive") throw new StudentProblem("account_inactive", "Reactivate the account first.");
        throw new StudentProblem("email_unverified", "The email must be verified or marked Admin-exempt before a password link can be sent.");
      }
      const token = await issuePasswordResetToken(userId).catch(cooldown);
      const locale = user.locale === "zh-CN" ? "zh-CN" : "en-GB";
      const url = `${origin}/${locale}/portal/reset-password?${new URLSearchParams({ token, returnTo: `/${locale}/account/my-learning` })}`;
      if (!(await trySend(() => sendPasswordResetEmail({ to: user.email!, url, locale })))) throw new StudentProblem("email_delivery_failed", "The password email could not be sent. Try again.");
      const student = await editProductData((current) => {
        const target = findLearner(current, userId);
        recordEvent(current, { userId, action: link.kind === "reset" ? "password.reset_link_sent" : "password.setup_link_sent", actor: input.actor, before: null, after: { email: target.email } });
        return details(current, target);
      });
      return { student, email: { sent: true } };
    }
  }
}

// ------------------------------------------------------------------ global settings (PRD 7)

function settings(data: ProductData, at = Date.now()): FeatureSettingsResponse {
  const learners = data.users.filter(isLearner);
  const plans = withPlanAiPoints(data.plans);
  const overrides = featureState(data).overrides;
  return {
    version: String(featureState(data).version),
    features: FEATURE_KEYS.map((feature) => {
      const global = globalSetting(data, feature);
      const rows = overrides.filter((item) => item.feature === feature);
      const eligibleDefault = learners.filter((user) => user.status === "active" && !user.deactivatedAt && overrideFor(data, user.id, feature) === "default"
        && (FEATURE_CATALOGUE[feature].prerequisite !== "ai_tutor" || hasAiTutor(data, user.id, at, plans))).length;
      return {
        feature,
        globalEnabled: global.enabled,
        emergencyOff: global.emergencyOff ? { at: global.emergencyOff.at, byName: global.emergencyOff.byName, reason: global.emergencyOff.reason } : null,
        overrides: { allow: rows.filter((item) => item.value === "allow").length, deny: rows.filter((item) => item.value === "deny").length },
        eligibleDefault,
        updated: stamp(global.updated),
      };
    }),
  };
}

export async function getFeatureSettings() {
  return settings(await readProductData());
}

function globalRow(data: ProductData, feature: FeatureKey) {
  const state = (data.featureAccess ||= { globals: [], overrides: [], version: 0 });
  let row = state.globals.find((item) => item.feature === feature);
  if (!row) {
    row = { feature, enabled: FEATURE_CATALOGUE[feature].defaultEnabled, emergencyOff: null, updated: null };
    state.globals.push(row);
  }
  return { state, row };
}

export async function saveFeatureSettings(input: FeatureSettingsInput) {
  return editProductData((data) => {
    if (String(featureState(data).version) !== input.expectedVersion) throw new StudentProblem("version_conflict", "Someone else changed these settings. Reload to see the latest.");
    let changed = false;
    for (const feature of FEATURE_KEYS) {
      const next = input.features[feature];
      if (!next) continue;
      const { row } = globalRow(data, feature);
      if (row.enabled === next.enabled) continue;
      // Stored individual overrides are never touched by a global change (PRD 6.2, FA-06).
      recordEvent(data, { userId: null, action: "feature_global.changed", actor: input.actor, before: { feature, enabled: row.enabled }, after: { feature, enabled: next.enabled }, reason: input.reason || null });
      row.enabled = next.enabled;
      row.updated = staffRecord(input.actor);
      changed = true;
    }
    if (changed) featureState(data).version += 1;
    return settings(data);
  });
}

export async function setEmergencyOff(input: EmergencyInput) {
  return editProductData((data) => {
    const { state, row } = globalRow(data, input.feature);
    if (Boolean(row.emergencyOff) === input.off) return settings(data);
    recordEvent(data, { userId: null, action: input.off ? "feature_emergency.off" : "feature_emergency.resumed", actor: input.actor, before: { feature: input.feature, emergencyOff: Boolean(row.emergencyOff) }, after: { feature: input.feature, emergencyOff: input.off }, reason: input.reason });
    row.emergencyOff = input.off ? { ...staffRecord(input.actor), reason: input.reason } : null;
    state.version += 1;
    return settings(data);
  });
}

// ------------------------------------------------------------------ learner side (PRD 6.2 step 5: enforce on the server)

export async function myFeatures(userId: string): Promise<MyFeaturesResponse> {
  const data = await readProductData();
  const user = data.users.find((item) => item.id === userId);
  const features = {} as MyFeaturesResponse["features"];
  for (const feature of FEATURE_KEYS) {
    features[feature] = user ? (({ enabled, reason }) => ({ enabled, reason }))(decideFeature(data, user, feature)) : { enabled: false, reason: "account_inactive" };
  }
  return { features };
}

export async function isFeatureEnabled(userId: string, feature: FeatureKey) {
  return (await myFeatures(userId)).features[feature].enabled;
}
