import { MissingNotificationDataError, renderTemplate, UnknownTemplateVariableError } from "./render";
import { notificationTemplate } from "./templates";
import { buildNotificationEmail } from "./emailLayout";
import { recordEmailDelivery, hasEmailLogInData } from "./emailLog";
import { notificationEmailRow } from "./core";
import { EmailDeliveryError, emailDeliveryConfigured, sendRenderedEmail } from "../emailService";
import { editProductData, readProductData } from "../productStore";
import { publicAppOrigin } from "../runtimeConfig";
import type { ProductData, ProductUser } from "../productStore";
import type { NotificationLanguage, NotificationTemplate } from "./types";

/**
 * Notification P0 email channel (design §6).
 *
 * The three P0 emails are rendered from the operator's stored template in the
 * learner's language with the frozen variable values, wrapped in the one fixed
 * layout, sent through the Portal SMTP path, and recorded as Sent or Failed.
 * Delivered is only set by a future provider receipt (none here).
 */

export const EMAIL_TEMPLATE_IDS = ["SUB_RENEWAL_REMINDER", "SUB_RENEWAL_FAILED", "LIVE_SESSION_REMINDER"] as const;
export type EmailTemplateId = (typeof EMAIL_TEMPLATE_IDS)[number];

export function isEmailTemplateId(value: string | null | undefined): value is EmailTemplateId {
  return Boolean(value) && (EMAIL_TEMPLATE_IDS as readonly string[]).includes(value as string);
}

export type SendEmail = (input: { to: string; subject: string; text: string; html: string }) => Promise<{ messageId?: string | null }>;

const defaultSend: SendEmail = (input) => sendRenderedEmail(input);

export function emailAppUrl(override?: string | null): string {
  const configured = (override || process.env.NEXT_PUBLIC_APP_URL || "").trim();
  if (configured) return configured.replace(/\/+$/, "");
  try {
    return publicAppOrigin().replace(/\/+$/, "");
  } catch {
    return "";
  }
}

function absoluteLink(link: string | null, appUrl: string): string | null {
  const value = (link || "").trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  if (!appUrl) return value;
  return `${appUrl}${value.startsWith("/") ? "" : "/"}${value}`;
}

function footerReason(templateId: string, language: NotificationLanguage): string {
  if (templateId === "LIVE_SESSION_REMINDER") {
    return language === "zh"
      ? "你收到此邮件是因为你预约了 Learning Guide 直播课。"
      : "You're receiving this email because you booked a Learning Guide Live Session.";
  }
  return language === "zh"
    ? "你收到此邮件是因为你拥有 Learning Guide 订阅。"
    : "You're receiving this email because you have a Learning Guide subscription.";
}

export type RenderedEmail = {
  templateId: string;
  language: NotificationLanguage;
  subject: string;
  text: string;
  html: string;
  link: string | null;
};

/**
 * Render one P0 email from a template. `template` may be the stored (operator
 * edited) row; without it the shipped catalogue default is used.
 */
export function renderNotificationEmail(input: {
  templateId: string;
  locale: string;
  params: Record<string, unknown>;
  template?: NotificationTemplate;
  now?: string | Date;
  appUrl?: string;
}): RenderedEmail {
  const template = input.template || notificationTemplate(input.templateId);
  if (!template.channels.includes("email")) {
    throw new Error(`${template.id} does not send email.`);
  }
  const appUrl = emailAppUrl(input.appUrl);
  const params = { ...input.params, app_url: appUrl };
  const rendered = renderTemplate(template, {
    locale: input.locale,
    channel: "email",
    params,
    now: input.now,
  });
  if (!rendered.subject?.trim() || !rendered.emailBody?.trim()) {
    throw new MissingNotificationDataError(["email subject", "email body"]);
  }
  const link = absoluteLink(rendered.link, appUrl);
  const built = buildNotificationEmail({
    language: rendered.language,
    subject: rendered.subject,
    body: rendered.emailBody,
    buttonText: rendered.emailButtonText,
    buttonUrl: link,
    footerReason: footerReason(template.id, rendered.language),
    appUrl,
  });
  return {
    templateId: template.id,
    language: rendered.language,
    subject: rendered.subject,
    text: built.text,
    html: built.html,
    link,
  };
}

export type SendNotificationEmailResult =
  | { ok: true; logId: string; messageId: string | null; language: NotificationLanguage; subject: string }
  | { ok: false; reason: "unknown_user" | "account_unavailable" | "email_missing" | "email_not_verified" | "disabled" | "duplicate" | "missing_data" | "invalid_template" | "email_not_configured" | "provider_error"; logId?: string };

function storedTemplate(data: ProductData, templateId: string): NotificationTemplate | null {
  return (data.notificationTemplates || []).find((item) => item.id === templateId) || null;
}

function nameFor(user: ProductUser, language: NotificationLanguage) {
  const nickname = (user.nickname || "").trim();
  if (nickname) return nickname;
  return language === "zh" ? "你" : "there";
}

type EmailFailureReason = Extract<SendNotificationEmailResult, { ok: false }>["reason"];

async function fail(input: {
  userId: string;
  notificationId?: string | null;
  templateId: string;
  reason: EmailFailureReason;
  failureReason: string;
  now: string;
  related?: string | null;
  recipientEmail?: string | null;
  recipientName?: string | null;
}): Promise<SendNotificationEmailResult> {
  const recorded = await recordEmailDelivery({
    userId: input.userId,
    notificationId: input.notificationId || null,
    templateId: input.templateId,
    status: "failed",
    failureReason: input.failureReason,
    occurredAt: input.now,
    related: input.related || null,
    recipientEmail: input.recipientEmail || null,
    recipientName: input.recipientName || null,
  });
  return { ok: false, reason: input.reason, ...(recorded.created ? { logId: recorded.logId } : {}) };
}

export type SendNotificationEmailInput = {
  userId: string;
  templateId: string;
  params: Record<string, unknown>;
  notificationId?: string | null;
  related?: string | null;
  now?: string | Date;
  appUrl?: string;
  send?: SendEmail;
  isTest?: boolean;
  locale?: string;
};

/**
 * Render and send one P0 email to the learner's verified address, recording
 * the result. Missing data blocks the send (Failed "missing data"); an SMTP
 * failure is Failed "provider error". The in-app message is unaffected.
 */
export async function sendNotificationEmailForUser(input: SendNotificationEmailInput): Promise<SendNotificationEmailResult> {
  const now = input.now ? new Date(input.now).toISOString() : new Date().toISOString();
  const data = await readProductData();
  const user = data.users.find((item) => item.id === input.userId);
  if (!user) return { ok: false, reason: "unknown_user" };
  if (!user.email?.trim()) return { ok: false, reason: "email_missing" };
  if (!user.emailVerifiedAt) {
    return fail({
      userId: user.id,
      notificationId: input.notificationId,
      templateId: input.templateId,
      reason: "email_not_verified",
      failureReason: "email not verified",
      now,
      related: input.related,
      recipientEmail: user.email,
      recipientName: user.nickname,
    });
  }
  if (user.status !== "active" || user.deactivatedAt || user.mergedIntoUserId) {
    return fail({
      userId: user.id,
      notificationId: input.notificationId,
      templateId: input.templateId,
      reason: "account_unavailable",
      failureReason: "account unavailable",
      now,
      related: input.related,
      recipientEmail: user.email,
      recipientName: user.nickname,
    });
  }
  if (input.notificationId && hasEmailLogInData(data, input.notificationId)) {
    return { ok: false, reason: "duplicate" };
  }
  const template = storedTemplate(data, input.templateId);
  if (!template || !template.channels.includes("email")) {
    return fail({
      userId: user.id,
      notificationId: input.notificationId,
      templateId: input.templateId,
      reason: "invalid_template",
      failureReason: "invalid template",
      now,
      related: input.related,
      recipientEmail: user.email,
      recipientName: user.nickname,
    });
  }
  if (!template.enabled) {
    return fail({
      userId: user.id,
      notificationId: input.notificationId,
      templateId: input.templateId,
      reason: "disabled",
      failureReason: "notification disabled",
      now,
      related: input.related,
      recipientEmail: user.email,
      recipientName: user.nickname,
    });
  }

  const locale = input.locale || user.locale;
  const language: NotificationLanguage = locale.toLowerCase().startsWith("zh") ? "zh" : "en";
  const params = { ...input.params, user_name: nameFor(user, language) };
  let rendered: RenderedEmail;
  try {
    rendered = renderNotificationEmail({
      templateId: template.id,
      locale,
      template,
      params,
      now,
      appUrl: input.appUrl,
    });
  } catch (error) {
    if (error instanceof MissingNotificationDataError) {
      return fail({
        userId: user.id,
        notificationId: input.notificationId,
        templateId: template.id,
        reason: "missing_data",
        failureReason: "missing data",
        now,
        related: input.related,
        recipientEmail: user.email,
        recipientName: user.nickname,
      });
    }
    if (error instanceof UnknownTemplateVariableError) {
      return fail({
        userId: user.id,
        notificationId: input.notificationId,
        templateId: template.id,
        reason: "invalid_template",
        failureReason: "invalid template variable",
        now,
        related: input.related,
        recipientEmail: user.email,
        recipientName: user.nickname,
      });
    }
    throw error;
  }

  if (!emailDeliveryConfigured()) {
    return fail({
      userId: user.id,
      notificationId: input.notificationId,
      templateId: template.id,
      reason: "email_not_configured",
      failureReason: "email not configured",
      now,
      related: input.related,
      recipientEmail: user.email,
      recipientName: user.nickname,
    });
  }

  const send = input.send || defaultSend;
  let messageId: string | null = null;
  try {
    const info = await send({ to: user.email, subject: rendered.subject, text: rendered.text, html: rendered.html });
    messageId = info?.messageId || null;
  } catch (error) {
    const notConfigured = error instanceof EmailDeliveryError && error.code === "not_configured";
    return fail({
      userId: user.id,
      notificationId: input.notificationId,
      templateId: template.id,
      reason: notConfigured ? "email_not_configured" : "provider_error",
      failureReason: notConfigured ? "email not configured" : "provider error",
      now,
      related: input.related,
      recipientEmail: user.email,
      recipientName: user.nickname,
    });
  }

  const recorded = await recordEmailDelivery({
    userId: user.id,
    notificationId: input.notificationId || null,
    templateId: template.id,
    status: "sent",
    failureReason: null,
    occurredAt: now,
    related: input.related || null,
    recipientEmail: user.email,
    recipientName: user.nickname,
    providerMessageId: messageId,
    isTest: Boolean(input.isTest),
  });
  return { ok: true, logId: recorded.logId, messageId, language: rendered.language, subject: rendered.subject };
}

export type DispatchEmailSummary = {
  attempted: number;
  sent: number;
  failed: number;
  skipped: number;
};

const EMAIL_CLAIM_LEASE_MS = 10 * 60_000;
const DISPATCH_WINDOW_DAYS = 7;

/**
 * Deferred email dispatch for the two email events whose write points live
 * outside the notification service (the subscription webhook writes the
 * in-app row inside its own transaction). Candidates are the P0 email
 * templates with frozen params and no email log row. A short claim field
 * prevents two process ticks mailing the same row; a result row (Sent or
 * Failed) is terminal — SMTP has no resend beyond the provider's own retries.
 */
export async function dispatchPendingNotificationEmails(options: {
  now?: string | Date;
  appUrl?: string;
  send?: SendEmail;
  limit?: number;
} = {}): Promise<DispatchEmailSummary> {
  const now = options.now ? new Date(options.now) : new Date();
  const nowIso = now.toISOString();
  const cutoff = now.getTime() - DISPATCH_WINDOW_DAYS * 86400000;
  const limit = Math.max(1, Math.min(100, options.limit || 25));
  const isCandidate = (data: ProductData, notification: ProductData["notifications"][number]) => {
    const row = notificationEmailRow(notification);
    if (!notification.templateId || !isEmailTemplateId(notification.templateId)) return false;
    if (notification.isTest || notification.withdrawnAt) return false;
    if (!row.params || typeof row.params !== "object") return false;
    if (Date.parse(notification.createdAt) < cutoff) return false;
    const template = (data.notificationTemplates || []).find((item) => item.id === notification.templateId);
    if (!template || !template.enabled || !template.channels.includes("email")) return false;
    if (hasEmailLogInData(data, notification.id)) return false;
    if (row.emailClaimedAt && now.getTime() - Date.parse(row.emailClaimedAt) < EMAIL_CLAIM_LEASE_MS) return false;
    return true;
  };
  // Read-only pre-check: the common empty tick must not open a write transaction.
  const snapshot = await readProductData();
  if (!snapshot.notifications.some((notification) => isCandidate(snapshot, notification))) {
    return { attempted: 0, sent: 0, failed: 0, skipped: 0 };
  }
  const claimed = await editProductData((data) => {
    const candidates = data.notifications
      .filter((notification) => isCandidate(data, notification))
      .slice(0, limit)
      .map((notification) => {
        const row = notificationEmailRow(notification);
        row.emailClaimedAt = nowIso;
        return {
          notificationId: notification.id,
          userId: notification.userId,
          templateId: notification.templateId!,
          params: { ...(row.params || {}) },
          related: notification.sessionId || null,
        };
      });
    return candidates;
  });

  let sent = 0;
  let failed = 0;
  let skipped = 0;
  for (const job of claimed) {
    const result = await sendNotificationEmailForUser({
      userId: job.userId,
      templateId: job.templateId,
      params: job.params,
      notificationId: job.notificationId,
      related: job.related,
      now: nowIso,
      appUrl: options.appUrl,
      send: options.send,
    });
    if (result.ok) sent += 1;
    else if (result.reason === "duplicate" || result.reason === "unknown_user" || result.reason === "email_missing") skipped += 1;
    else failed += 1;
  }
  return { attempted: claimed.length, sent, failed, skipped };
}
