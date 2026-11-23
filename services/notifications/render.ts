import { AMOUNT_VARIABLES, DATE_VARIABLES, SYSTEM_LINK_VARIABLES, TEMPLATE_CATEGORY_ORDER, templateVariables, TIME_VARIABLES } from "./templates";
import { formatAmount, formatHktDate, formatHktDateTimeHkt, formatPoints } from "./format";
import type { NotificationChannel, NotificationCopy, NotificationLanguage, NotificationTemplate } from "./types";

export type TemplateCopy = NotificationCopy;

export type RenderInput = {
  locale: string;
  channel: NotificationChannel;
  params: Record<string, unknown>;
  /** Injected for deterministic tests; rendering only formats values. */
  now?: string | Date;
};

export type RenderedNotification = {
  language: NotificationLanguage;
  title: string;
  body: string;
  buttonText: string | null;
  subject: string | null;
  emailBody: string | null;
  emailButtonText: string | null;
  link: string | null;
};

export class MissingNotificationDataError extends Error {
  constructor(public readonly variables: string[]) {
    super(`Notification data is missing: ${variables.join(", ")}`);
    this.name = "MissingNotificationDataError";
  }
}

export class UnknownTemplateVariableError extends Error {
  constructor(public readonly variables: string[]) {
    super(`Unknown notification variable: ${variables.join(", ")}`);
    this.name = "UnknownTemplateVariableError";
  }
}

const PLACEHOLDER = /{{\s*([a-z0-9_]+)\s*}}/g;

export function placeholders(value: string | undefined | null): string[] {
  if (!value) return [];
  return [...new Set([...value.matchAll(PLACEHOLDER)].map((match) => match[1]))];
}

function allowedVariables(templateId: string): Set<string> {
  return new Set([...templateVariables(templateId), ...SYSTEM_LINK_VARIABLES]);
}

function isBlank(value: unknown) {
  return value === undefined || value === null || (typeof value === "string" && value.trim() === "");
}

function resolveVariable(name: string, value: unknown, language: NotificationLanguage): string {
  if (DATE_VARIABLES.has(name)) return formatHktDate(value as string | number | Date, language);
  if (TIME_VARIABLES.has(name)) return formatHktDateTimeHkt(value as string | number | Date, language);
  if (AMOUNT_VARIABLES.has(name)) return formatAmount(value as number | string, language);
  if (name === "ai_points") return formatPoints(value as number | string);
  return String(value);
}

function renderText(
  value: string | undefined,
  language: NotificationLanguage,
  params: Record<string, unknown>,
  missing: Set<string>,
  unknown: Set<string>,
  allowed: Set<string>,
): string | null {
  if (value === undefined) return null;
  return value.replace(PLACEHOLDER, (_match, name: string) => {
    if (!allowed.has(name)) {
      unknown.add(name);
      return "";
    }
    const raw = params[name];
    if (isBlank(raw)) {
      // Link variables are optional; text variables block the send.
      if ((SYSTEM_LINK_VARIABLES as readonly string[]).includes(name)) return "";
      missing.add(name);
      return "";
    }
    return resolveVariable(name, raw, language);
  });
}

function copyComplete(copy: TemplateCopy, channel: NotificationChannel) {
  if (channel === "email") return Boolean(copy.subject?.trim() && copy.emailBody?.trim());
  return Boolean(copy.title?.trim() && copy.message?.trim());
}

export function copyForLanguage(template: NotificationTemplate, language: NotificationLanguage, channel: NotificationChannel): TemplateCopy {
  if (language === "zh" && copyComplete(template.zh, channel)) return template.zh;
  return template.en;
}

/**
 * Render at send time: the learner's language, formatted variables and a
 * frozen result. Missing text data throws MissingNotificationDataError so the
 * caller can record Failed "missing data" instead of sending a broken message.
 */
export function renderTemplate(template: NotificationTemplate, input: RenderInput): RenderedNotification {
  const language: NotificationLanguage = input.locale.toLowerCase().startsWith("zh") ? "zh" : "en";
  const copy = copyForLanguage(template, language, input.channel);
  const usedLanguage: NotificationLanguage = copy === template.zh ? "zh" : "en";
  const allowed = allowedVariables(template.id);
  const params = { ...input.params };
  const missing = new Set<string>();
  const unknown = new Set<string>();

  const render = (value: string | undefined) => renderText(value, usedLanguage, params, missing, unknown, allowed);

  const isEmail = input.channel === "email";
  const title = render(isEmail ? copy.subject : copy.title);
  const body = render(isEmail ? copy.emailBody : copy.message);
  const buttonText = render(isEmail ? copy.emailButtonText : copy.buttonText);

  const linkTemplate = template.buttonLink;
  const linkRendered = linkTemplate.replace(PLACEHOLDER, (_match, name: string) => {
    if (!(SYSTEM_LINK_VARIABLES as readonly string[]).includes(name)) return "";
    const raw = params[name];
    return isBlank(raw) ? "" : String(raw);
  });
  const link = linkRendered.trim() ? linkRendered : null;

  if (unknown.size) throw new UnknownTemplateVariableError([...unknown].sort());
  if (missing.size) throw new MissingNotificationDataError([...missing].sort());

  return {
    language: usedLanguage,
    title: title ?? "",
    body: body ?? "",
    buttonText: buttonText || null,
    subject: isEmail ? title ?? "" : copy.subject ?? null,
    emailBody: isEmail ? body ?? "" : copy.emailBody ?? null,
    emailButtonText: isEmail ? buttonText : copy.emailButtonText ?? null,
    link,
  };
}

export type TemplateValidationCode = "unknown_variable" | "too_long" | "missing_required" | "zh_incomplete";

export type TemplateValidationIssue = {
  code: TemplateValidationCode;
  field: string;
  variable?: string;
  suggestion?: string;
};

/** PRD NTF-BO-017: a misspelt variable names the right one where possible. */
const SUGGESTIONS: Record<string, string> = {
  amount_due: "renewal_amount",
  renewal_price: "renewal_amount",
  amount: "renewal_amount",
  price: "renewal_amount",
  due_date: "grace_end_date",
  grace_date: "grace_end_date",
  expiry_date: "expired_date",
  plan: "plan_name",
  plan_type: "plan_name",
  student_name: "user_name",
  learner_name: "user_name",
  course: "course_title",
  ticket: "ticket_subject",
  session: "session_title",
};

const LIMITS: Record<NotificationChannel, Array<[keyof TemplateCopy, number]>> = {
  in_app: [["title", 60], ["message", 300], ["buttonText", 24]],
  email: [["subject", 100], ["emailBody", 2000], ["emailButtonText", 24]],
};

export const FIELD_LABELS: Record<keyof TemplateCopy, string> = {
  title: "Title",
  message: "Message",
  buttonText: "Button text",
  subject: "Subject",
  emailBody: "Body",
  emailButtonText: "Button text",
};

export function templateFieldLimit(channel: NotificationChannel, field: keyof TemplateCopy): number | null {
  return LIMITS[channel].find(([name]) => name === field)?.[1] ?? null;
}

const REQUIRED: Record<NotificationChannel, Array<keyof TemplateCopy>> = {
  in_app: ["title", "message"],
  email: ["subject", "emailBody"],
};

/**
 * Operator-save validation for one channel/language copy: unknown variables,
 * lengths and (for Chinese) all-or-nothing required fields.
 */
export function validateTemplateCopy(
  templateId: string,
  channel: NotificationChannel,
  copy: TemplateCopy,
  options: { language?: NotificationLanguage; requireChinese?: boolean } = {},
): TemplateValidationIssue[] {
  const language = options.language || "en";
  const allowed = allowedVariables(templateId);
  const issues: TemplateValidationIssue[] = [];
  for (const field of Object.keys(copy) as Array<keyof TemplateCopy>) {
    const value = copy[field];
    if (typeof value !== "string") continue;
    for (const variable of placeholders(value)) {
      if (allowed.has(variable)) continue;
      issues.push({ code: "unknown_variable", field, variable, ...(SUGGESTIONS[variable] ? { suggestion: SUGGESTIONS[variable] } : {}) });
    }
  }
  for (const [field, max] of LIMITS[channel]) {
    const value = copy[field];
    if (typeof value === "string" && value.length > max) issues.push({ code: "too_long", field });
  }
  const hasAny = Object.values(copy).some((value) => typeof value === "string" && value.trim());
  if (hasAny && (language === "en" || options.requireChinese)) {
    for (const field of REQUIRED[channel]) {
      if (!String(copy[field] || "").trim()) issues.push({ code: "missing_required", field });
    }
  }
  if (language === "zh" && options.requireChinese) {
    const filled = Object.values(copy).some((value) => typeof value === "string" && value.trim());
    if (filled && !copyComplete(copy, channel)) issues.push({ code: "zh_incomplete", field: REQUIRED[channel][0] });
  }
  return issues;
}

/** Category ordering used by the BackOffice list (PRD NTF-BO-001). */
export function categoryRank(category: NotificationTemplate["category"]) {
  return TEMPLATE_CATEGORY_ORDER.indexOf(category);
}
