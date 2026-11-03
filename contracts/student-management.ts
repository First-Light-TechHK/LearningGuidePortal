// Student Management & Feature Access (PRD "Learning Guide Student Management PRD v1.0", 2026-11-01).
// The Backoffice Portal (LearningGuideAdmin) reads and changes learner accounts and feature access only
// through these integration contracts; Portal owns the data and decides access on every request.

export const FEATURE_KEYS = ["improve_tutor", "ai_support_assistant"] as const;
export type FeatureKey = typeof FEATURE_KEYS[number];
export const OVERRIDE_VALUES = ["default", "allow", "deny"] as const;
export type OverrideValue = typeof OVERRIDE_VALUES[number];
export type AccountStatus = "active" | "inactive";
export type EmailVerification = "verified" | "pending" | "admin_exempt";
export type SignInMethod = "email" | "google" | "wechat";

/** Why a feature is on or off for one learner, in evaluation order (PRD 6.2; emergency off decided 2026-11-02). */
export const ACCESS_REASONS = ["account_inactive", "emergency_off", "missing_prerequisite", "override_deny", "override_allow", "global_on", "global_off"] as const;
export type AccessReason = typeof ACCESS_REASONS[number];

/** The Backoffice employee who made a change; Admin authenticates the employee and passes who it was. */
export type StaffActor = { id: string; name: string; role: string };
export type StaffStamp = { at: string; byName: string };

export const STUDENT_STATUS_FILTERS = ["active", "inactive"] as const;
export const SUBSCRIPTION_FILTERS = ["current", "none", "grace", "ending"] as const;
export const SPECIAL_ACCESS_FILTERS = ["any", "none", ...FEATURE_KEYS] as const;
export type StudentStatusFilter = typeof STUDENT_STATUS_FILTERS[number];
export type SubscriptionFilter = typeof SUBSCRIPTION_FILTERS[number];
export type SpecialAccessFilter = typeof SPECIAL_ACCESS_FILTERS[number];

export const STUDENT_PAGE_SIZE_MAX = 100;
export const STUDENT_REASON_MAX = 500;
export const STUDENT_REFERENCE_MAX = 120;

export type StudentListQuery = {
  q?: string;
  status?: StudentStatusFilter;
  subscription?: SubscriptionFilter;
  special?: SpecialAccessFilter;
  page: number;
  pageSize: number;
};

export type SubscriptionState = "active" | "cancel_at_period_end" | "grace" | "expired" | "trial_canceled";
export type StudentSubscriptionSummary = { count: number; label: string | null; state: SubscriptionState | null };
export type StudentListItem = {
  id: string;
  name: string;
  email: string | null;
  accountStatus: AccountStatus;
  emailVerification: EmailVerification;
  subscription: StudentSubscriptionSummary;
  /** Individual exceptions only (Allow / Deny), never features that are on for everyone (PRD 3.1). */
  specialAccess: Array<{ feature: FeatureKey; value: Exclude<OverrideValue, "default"> }>;
  registeredAt: string;
};
export type StudentListResponse = {
  items: StudentListItem[];
  total: number;
  page: number;
  pageSize: number;
  /** Account states of every registered record (PRD 3.2), not just this page or filter. */
  counts: { total: number; active: number; inactive: number };
};

export type StudentSubscription = {
  id: string;
  label: string;
  scope: "course" | "category" | "everything";
  device: "pc" | "mobile";
  source: "trial" | "purchase";
  state: SubscriptionState;
  current: boolean;
  aiTutor: boolean;
  validFrom: string;
  validTo: string;
  graceEndsAt: string | null;
  renews: boolean;
  /** The paid order that started it, for the Order Management view; null when there is none (trial without payment). */
  orderId: string | null;
};

export type StudentFeatureAccess = { feature: FeatureKey; override: OverrideValue; enabled: boolean; reason: AccessReason };

export type StudentDetails = {
  id: string;
  name: string;
  email: string | null;
  accountStatus: AccountStatus;
  deactivation: (StaffStamp & { reason: string }) | null;
  emailVerification: EmailVerification;
  emailExemption: (StaffStamp & { reference: string }) | null;
  emailChange: (StaffStamp & { reference: string }) | null;
  registeredAt: string;
  profile: { country: string | null; ageRange: string | null; education: string | null; interests: string[]; language: "en-GB" | "zh-CN" };
  signInMethods: SignInMethod[];
  hasPassword: boolean;
  subscriptions: StudentSubscription[];
  features: StudentFeatureAccess[];
  /** Sent back with an override save; a different value means someone else saved first (409 version_conflict). */
  overridesVersion: string;
  /** Password reset / first-password link (PRD 5.3): only to a verified or admin-attested primary email of an Active account. */
  passwordLink: { available: true; kind: "reset" | "setup" } | { available: false; blockedBy: "inactive" | "no_email" | "email_unverified" };
};

export const STUDENT_ACTIONS = ["deactivate", "activate", "change_email", "resend_verification", "send_password_link"] as const;
export type StudentAction = typeof STUDENT_ACTIONS[number];
export type StudentActionInput =
  | { action: "deactivate" | "activate"; actor: StaffActor; reason: string }
  | { action: "change_email"; actor: StaffActor; email: string; reason: string; exemption: { reference: string } | null }
  | { action: "resend_verification" | "send_password_link"; actor: StaffActor };
export type StudentActionResponse = {
  student: StudentDetails;
  /** null: the action sends no mail. sent false: the change was saved but the mail did not go out (PRD 8, no false success). */
  email: { sent: boolean } | null;
};

export type OverridesInput = { actor: StaffActor; reason: string; expectedVersion: string; overrides: Partial<Record<FeatureKey, OverrideValue>> };

export type FeatureSetting = {
  feature: FeatureKey;
  globalEnabled: boolean;
  emergencyOff: (StaffStamp & { reason: string }) | null;
  overrides: { allow: number; deny: number };
  /** Active learners on Default who meet the prerequisite: who a global On reaches (the Off → On confirmation). */
  eligibleDefault: number;
  updated: StaffStamp | null;
};
export type FeatureSettingsResponse = { features: FeatureSetting[]; version: string };
export type FeatureSettingsInput = { actor: StaffActor; reason: string; expectedVersion: string; features: Partial<Record<FeatureKey, { enabled: boolean }>> };
export type EmergencyInput = { actor: StaffActor; feature: FeatureKey; off: boolean; reason: string };

/** What the signed-in learner may use (GET /api/me/features); the AI Tutor reads it for improve_tutor. */
export type MyFeaturesResponse = { features: Record<FeatureKey, { enabled: boolean; reason: AccessReason }> };

export const STUDENT_PROBLEMS = {
  integration_disabled: 503,
  invalid_token: 401,
  validation_failed: 400,
  not_found: 404,
  version_conflict: 409,
  email_taken: 409,
  email_unverified: 409,
  account_inactive: 409,
  rate_limited: 429,
  email_unavailable: 503,
  email_delivery_failed: 502,
  students_unavailable: 500,
} as const;
export type StudentProblemCode = keyof typeof STUDENT_PROBLEMS;

export class StudentProblem extends Error {
  readonly status: number;
  constructor(public readonly code: StudentProblemCode, public readonly detail: string = code, public readonly field?: string) {
    super(code);
    this.status = STUDENT_PROBLEMS[code];
  }
}

export function studentProblemBody(problem: StudentProblem) {
  return {
    type: `https://www.ilovelearningguide.com/problems/students/${problem.code}`,
    title: problem.code,
    status: problem.status,
    detail: problem.detail,
    code: problem.code,
    ...(problem.field ? { field: problem.field } : {}),
  };
}

// ------------------------------------------------------------------ parsers (every input is untrusted)

function invalid(field: string, detail: string): never {
  throw new StudentProblem("validation_failed", detail, field);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function oneOf<T extends string>(values: readonly T[], value: unknown, field: string): T {
  if (typeof value === "string" && (values as readonly string[]).includes(value)) return value as T;
  return invalid(field, `${field} must be one of ${values.join(", ")}.`);
}

function text(value: unknown, field: string, max: number, required = true): string {
  if (typeof value !== "string") return required ? invalid(field, `${field} is required.`) : "";
  const trimmed = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
  if (required && !trimmed) invalid(field, `${field} is required.`);
  if (trimmed.length > max) invalid(field, `${field} must be at most ${max} characters.`);
  return trimmed;
}

export function parseStaffActor(value: unknown): StaffActor {
  if (!isRecord(value)) return invalid("actor", "actor is required.");
  return { id: text(value.id, "actor.id", 64), name: text(value.name, "actor.name", 120), role: text(value.role, "actor.role", 40) };
}

export function parseStudentListQuery(params: URLSearchParams): StudentListQuery {
  const page = Number(params.get("page") ?? "1");
  const pageSize = Number(params.get("pageSize") ?? "10");
  if (!Number.isInteger(page) || page < 1 || page > 100_000) invalid("page", "page must be a positive whole number.");
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > STUDENT_PAGE_SIZE_MAX) invalid("pageSize", `pageSize must be 1 to ${STUDENT_PAGE_SIZE_MAX}.`);
  const q = (params.get("q") ?? "").trim();
  if (q.length > 120) invalid("q", "q must be at most 120 characters.");
  const optional = <T extends string>(name: string, values: readonly T[]) => {
    const raw = params.get(name);
    return raw === null || raw === "" || raw === "all" ? undefined : oneOf(values, raw, name);
  };
  return {
    ...(q ? { q } : {}),
    status: optional("status", STUDENT_STATUS_FILTERS),
    subscription: optional("subscription", SUBSCRIPTION_FILTERS),
    special: optional("special", SPECIAL_ACCESS_FILTERS),
    page,
    pageSize,
  };
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseStudentActionInput(value: unknown): StudentActionInput {
  if (!isRecord(value)) return invalid("body", "Send a JSON object.");
  const action = oneOf(STUDENT_ACTIONS, value.action, "action");
  const actor = parseStaffActor(value.actor);
  if (action === "deactivate" || action === "activate") return { action, actor, reason: text(value.reason, "reason", STUDENT_REASON_MAX) };
  if (action === "change_email") {
    const email = text(value.email, "email", 254).toLowerCase();
    if (!EMAIL.test(email)) invalid("email", "Enter a valid email address.");
    let exemption: { reference: string } | null = null;
    if (value.exemption !== undefined && value.exemption !== null) {
      if (!isRecord(value.exemption)) invalid("exemption", "exemption must be an object.");
      exemption = { reference: text(value.exemption.reference, "exemption.reference", STUDENT_REFERENCE_MAX) };
    }
    return { action, actor, email, reason: text(value.reason, "reason", STUDENT_REASON_MAX), exemption };
  }
  return { action, actor };
}

export function parseOverridesInput(value: unknown): OverridesInput {
  if (!isRecord(value)) return invalid("body", "Send a JSON object.");
  if (!isRecord(value.overrides)) invalid("overrides", "overrides is required.");
  const overrides: Partial<Record<FeatureKey, OverrideValue>> = {};
  for (const [key, raw] of Object.entries(value.overrides as Record<string, unknown>)) {
    const feature = oneOf(FEATURE_KEYS, key, "overrides");
    overrides[feature] = oneOf(OVERRIDE_VALUES, raw, `overrides.${feature}`);
  }
  if (Object.keys(overrides).length === 0) invalid("overrides", "Change at least one feature.");
  return { actor: parseStaffActor(value.actor), reason: text(value.reason, "reason", STUDENT_REASON_MAX), expectedVersion: text(value.expectedVersion, "expectedVersion", 64), overrides };
}

export function parseFeatureSettingsInput(value: unknown): FeatureSettingsInput {
  if (!isRecord(value)) return invalid("body", "Send a JSON object.");
  if (!isRecord(value.features)) invalid("features", "features is required.");
  const features: Partial<Record<FeatureKey, { enabled: boolean }>> = {};
  for (const [key, raw] of Object.entries(value.features as Record<string, unknown>)) {
    const feature = oneOf(FEATURE_KEYS, key, "features");
    if (!isRecord(raw) || typeof raw.enabled !== "boolean") invalid(`features.${feature}`, "enabled must be true or false.");
    features[feature] = { enabled: (raw as { enabled: boolean }).enabled };
  }
  if (Object.keys(features).length === 0) invalid("features", "Change at least one feature.");
  return { actor: parseStaffActor(value.actor), reason: text(value.reason, "reason", STUDENT_REASON_MAX, false), expectedVersion: text(value.expectedVersion, "expectedVersion", 64), features };
}

export function parseEmergencyInput(value: unknown): EmergencyInput {
  if (!isRecord(value)) return invalid("body", "Send a JSON object.");
  if (typeof value.off !== "boolean") invalid("off", "off must be true or false.");
  return { actor: parseStaffActor(value.actor), feature: oneOf(FEATURE_KEYS, value.feature, "feature"), off: value.off as boolean, reason: text(value.reason, "reason", STUDENT_REASON_MAX) };
}
