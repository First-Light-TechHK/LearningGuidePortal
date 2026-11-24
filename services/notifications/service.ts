import { randomUUID } from "node:crypto";
import {
  appendNotificationLogInData,
  audienceUsers,
  broadcastDetailInData,
  buildSeenEventKeys,
  createBroadcastDraftInData,
  createNotificationInData,
  deleteBroadcastDraftInData,
  encodeCursor,
  ensureNotificationTemplatesInData,
  FANOUT_EVENTS,
  insertTestNotificationInData,
  listBroadcastsInData,
  listLearnerNotificationsInData,
  purgeExpiredNotificationRecordsInData,
  querySendLogInData,
  sendBroadcastInData,
  sendBroadcastTestInData,
  sendLogDetailInData,
  setNotificationReadInData,
  templateIdForEvent,
  unreadCountInData,
  updateBroadcastDraftInData,
  updateTemplateInData,
  withdrawBroadcastInData,
  type BroadcastDraftInput,
  type BroadcastUpdateInput,
  type SendLogFilters,
  type TemplateUpdateInput,
} from "./core";
import { NOTIFICATION_TEMPLATES, sampleTemplateParams, TEMPLATE_CATEGORY_ORDER, TEMPLATE_NAMES } from "./templates";
import { MissingNotificationDataError, renderTemplate, UnknownTemplateVariableError } from "./render";
import type { LearnerListOptions, LearnerListResult } from "./core";
import type { NotificationChannel, NotificationCopy, NotificationLanguage, NotificationLogEntry, NotificationTemplate } from "./types";
import { EmailDeliveryError, emailDeliveryConfigured, sendHelpdeskUpdateEmail } from "../emailService";
import { ensureProductData, editProductData, readProductData, type ProductNotification } from "../productStore";
import { sendNotificationEmailForUser, type SendEmail, type SendNotificationEmailResult } from "./email";

/**
 * Application service for the notification domain. Route handlers stay thin
 * (parse → validate → call here → return); all writes go through the Portal's
 * serialised product transaction.
 */

export type NotificationEventInput = {
  eventType: string;
  eventKey: string;
  userId?: string | null;
  email?: string | null;
  params?: Record<string, unknown> | null;
  isTest?: boolean;
};

export type NotificationEventResult =
  | { created: true; recipients: number; notificationId: string; notificationIds: string[] }
  | { created: false; reason: "unknown_event" | "duplicate" | "disabled" | "missing_data" | "unknown_user" | "unknown_template" | "invalid_template" | "invalid_request" | "no_recipients"; recipients: number; variables?: string[] };

function templateOrder(template: NotificationTemplate) {
  return NOTIFICATION_TEMPLATES.findIndex((item) => item.id === template.id);
}

export async function listTemplates(): Promise<NotificationTemplate[]> {
  const data = await ensureProductData();
  ensureNotificationTemplatesInData(data);
  return [...(data.notificationTemplates || [])].sort((left, right) =>
    TEMPLATE_CATEGORY_ORDER.indexOf(left.category) - TEMPLATE_CATEGORY_ORDER.indexOf(right.category)
    || templateOrder(left) - templateOrder(right)).map((row) => ({ ...row, name: TEMPLATE_NAMES[row.id] || row.id }));
}

export async function getTemplate(templateId: string): Promise<NotificationTemplate | null> {
  const templates = await listTemplates();
  return templates.find((item) => item.id === templateId) || null;
}

/** Operator save through the serialised product transaction (NTF-BO-020/021). */
export async function updateTemplate(input: TemplateUpdateInput) {
  return editProductData((data) => {
    ensureNotificationTemplatesInData(data);
    return updateTemplateInData(data, input);
  });
}

/* ------------------------------------------------------------------ *
 * "Send test to me" (NTF-BO-019)
 * ------------------------------------------------------------------ */

export type TemplateTestInput = {
  templateId: string;
  channel: NotificationChannel;
  language: NotificationLanguage;
  operatorEmail: string;
  operator: string;
  /** Unsaved editor content; absent fields use the saved template. */
  copy?: Partial<Record<NotificationLanguage, NotificationCopy>>;
  params?: Record<string, unknown> | null;
  now?: string;
};

export type TemplateTestResult =
  | { ok: true; channel: NotificationChannel; language: NotificationLanguage; sentTo: string; notificationId?: string; logId: string }
  | { ok: false; code: "not_found" | "invalid_channel" | "validation_failed" | "no_learner" | "email_not_configured" | "email_failed"; message: string; logId?: string };

function auditTemplateTestInData(data: Awaited<ReturnType<typeof ensureProductData>>, templateId: string, operator: string, now: string, channel: NotificationChannel) {
  const template = (data.notificationTemplates || []).find((item) => item.id === templateId);
  if (!template) return;
  template.audit ||= [];
  template.audit.push({ action: "test_sent", operator, at: now, before: null, after: { channel } });
  template.metadata = { ...(template.metadata || {}), lastOperator: operator, lastAction: "test_sent", lastUpdatedAt: now };
}

function testLogUserId(data: Awaited<ReturnType<typeof ensureProductData>>, email: string) {
  const user = data.users.find((item) => (item.email || "").trim().toLowerCase() === email);
  return { user, userId: user?.id || `operator:${email}` };
}

/**
 * Send the open channel/language content, saved or not, to the operator.
 * In-app goes to the learner account with that email; email goes to the
 * operator address. Titles/subjects are prefixed [TEST] and the log row is
 * isTest so every statistic ignores it.
 */
export async function sendTemplateTest(input: TemplateTestInput): Promise<TemplateTestResult> {
  const template = await getTemplate(input.templateId);
  if (!template) return { ok: false, code: "not_found", message: "Notification template not found." };
  if (!template.channels.includes(input.channel)) {
    return { ok: false, code: "invalid_channel", message: `This notification does not send ${input.channel === "email" ? "email" : "in-app"} messages.` };
  }
  const email = input.operatorEmail.trim().toLowerCase();
  const now = input.now || new Date().toISOString();
  const working: NotificationTemplate = {
    ...template,
    en: input.copy?.en ?? template.en,
    zh: input.copy?.zh ?? template.zh,
  };
  const params = { ...sampleTemplateParams(template.id), ...(input.params || {}) };
  // An in-app test lives on this site, so its button stays site-relative instead of using the sample domain.
  if (input.channel === "in_app" && !input.params?.app_url) delete params.app_url;
  let rendered;
  try {
    rendered = renderTemplate(working, {
      locale: input.language === "zh" ? "zh-CN" : "en-GB",
      channel: input.channel,
      params,
      now,
    });
  } catch (error) {
    if (error instanceof MissingNotificationDataError || error instanceof UnknownTemplateVariableError) {
      return { ok: false, code: "validation_failed", message: error.message };
    }
    throw error;
  }

  if (input.channel === "in_app") {
    return editProductData((data) => {
      const user = data.users.find((item) =>
        (item.email || "").trim().toLowerCase() === email
        && item.status === "active"
        && !item.deactivatedAt
        && !item.mergedIntoUserId);
      if (!user) {
        return { ok: false, code: "no_learner", message: "No learner account uses that email address." } as const;
      }
      const result = insertTestNotificationInData(data, {
        userId: user.id,
        templateId: template.id,
        category: template.category,
        rendered,
        eventKey: `test:${template.id}:${randomUUID()}`,
        operator: input.operator,
        now,
      });
      auditTemplateTestInData(data, template.id, input.operator, now, "in_app");
      return {
        ok: true,
        channel: "in_app",
        language: rendered.language,
        sentTo: user.email || email,
        notificationId: result.notification.id,
        logId: result.log.id,
      } as const;
    });
  }

  const subject = `[TEST] ${rendered.subject || rendered.title}`;
  const text = rendered.emailBody || rendered.body;
  let status: "sent" | "failed" = "sent";
  let failureReason: string | null = null;
  if (!emailDeliveryConfigured()) {
    status = "failed";
    failureReason = "email not configured";
  } else {
    try {
      await sendHelpdeskUpdateEmail({ to: email, subject, text });
    } catch (error) {
      if (!(error instanceof EmailDeliveryError)) throw error;
      status = "failed";
      failureReason = "provider error";
    }
  }

  const log = await editProductData((data) => {
    const { userId } = testLogUserId(data, email);
    const entry = appendNotificationLogInData(data, {
      notificationId: null,
      userId,
      templateId: template.id,
      channel: "email",
      status,
      failureReason,
      occurredAt: now,
      isTest: true,
      related: null,
      recipientEmail: email,
      recipientName: "",
    });
    auditTemplateTestInData(data, template.id, input.operator, now, "email");
    return entry;
  });

  if (status === "failed") {
    return {
      ok: false,
      code: failureReason === "email not configured" ? "email_not_configured" : "email_failed",
      message: failureReason === "email not configured" ? "Email delivery is not configured on Portal." : "The email provider rejected the test message.",
      logId: log.id,
    };
  }
  return { ok: true, channel: "email", language: rendered.language, sentTo: email, logId: log.id };
}

function normaliseEmail(value: string | null | undefined) {
  return (value || "").trim().toLowerCase();
}

/**
 * One system event → notifications. COURSE_NEW_LAUNCH fans out to every paid
 * subscriber when the event does not name one; the key is suffixed per learner
 * so the unique event_key still protects each message.
 */
export async function emitNotificationEvent(input: NotificationEventInput): Promise<NotificationEventResult> {
  const templateId = templateIdForEvent(input.eventType);
  if (!templateId) return { created: false, reason: "unknown_event", recipients: 0 };
  const eventKey = input.eventKey.trim();
  if (!eventKey) return { created: false, reason: "invalid_request", recipients: 0 };
  const params = input.params && typeof input.params === "object" ? input.params : {};
  const explicitUserId = input.userId?.trim() || "";
  const explicitEmail = normaliseEmail(input.email);

  return editProductData((data) => {
    ensureNotificationTemplatesInData(data);
    const now = new Date().toISOString();
    const resolveUser = () => {
      if (explicitUserId) return data.users.find((user) => user.id === explicitUserId) || null;
      if (explicitEmail) return data.users.find((user) => normaliseEmail(user.email) === explicitEmail) || null;
      return null;
    };
    const recipient = resolveUser();
    if ((explicitUserId || explicitEmail) && !recipient) return { created: false, reason: "unknown_user", recipients: 0 } as const;
    if (recipient && (recipient.status !== "active" || recipient.deactivatedAt || recipient.mergedIntoUserId)) {
      return { created: false, reason: "unknown_user", recipients: 0 } as const;
    }

    if (!recipient && !FANOUT_EVENTS.has(templateId)) {
      return { created: false, reason: "unknown_user", recipients: 0 } as const;
    }

    const recipients = recipient ? [recipient] : audienceUsers(data, "paid", new Date(now));
    if (!recipients.length) return { created: false, reason: "no_recipients", recipients: 0 } as const;
    const created: string[] = [];
    let lastReason: NotificationEventResult | null = null;
    const seenEventKeys = recipients.length > 1 ? buildSeenEventKeys(data) : undefined;
    for (const user of recipients) {
      const key = recipient ? eventKey : `${eventKey}:${user.id}`;
      const result = createNotificationInData(data, {
        userId: user.id,
        templateId,
        eventKey: key,
        params,
        isTest: Boolean(input.isTest),
        now,
        seenEventKeys,
      });
      if (result.created) created.push(result.notification.id);
      else lastReason = { created: false, reason: result.reason, recipients: 0, ...(result.variables ? { variables: result.variables } : {}) };
    }
    if (!created.length) {
      if (lastReason && lastReason.created === false) return { ...lastReason, recipients: recipients.length };
      return { created: false, reason: "duplicate", recipients: recipients.length };
    }
    return { created: true, recipients: created.length, notificationId: created[0], notificationIds: created };
  });
}

export type CatalogueNotificationInput = {
  templateId: string;
  userId: string;
  eventKey: string;
  params: Record<string, unknown>;
  /** Defaults to the template's own channels; filtered to those it supports. */
  channels?: NotificationChannel[];
  related?: string | null;
  /** Live Session link carried by the reminders strip. */
  sessionId?: string;
  /** Refresh an unread row of the same template/ticket instead of stacking. */
  replaceUnreadEventKeyPrefix?: string;
  isTest?: boolean;
  now?: string;
  locale?: string;
  appUrl?: string;
  /** Test hook for the email channel; production uses the Portal SMTP path. */
  send?: SendEmail;
};

export type CatalogueNotificationResult =
  | {
    created: true;
    notification: ProductNotification;
    log: NotificationLogEntry;
    channels: NotificationChannel[];
    email?: SendNotificationEmailResult;
  }
  | {
    created: false;
    reason: "duplicate" | "disabled" | "missing_data" | "unknown_template" | "unknown_user" | "invalid_template";
    variables?: string[];
    channels: NotificationChannel[];
    email?: SendNotificationEmailResult;
  };

/**
 * One template-aware send path for catalogue events that originate inside the
 * Portal: it applies the enabled switch, renders the operator's copy (language
 * fallback, missing data and unknown variables block the send), dedupes the
 * event key, writes the in-app row and its log, and sends the email channel to
 * the learner's verified address (PRD §5/§10). Study Group and HelpDesk events
 * use it so a switch or a copy edit applies to what is actually sent.
 */
export async function emitCatalogueNotification(input: CatalogueNotificationInput): Promise<CatalogueNotificationResult> {
  const template = (await listTemplates()).find((item) => item.id === input.templateId);
  if (!template) return { created: false, reason: "unknown_template", channels: [] };
  const requested = input.channels || template.channels;
  const channels = requested.filter((channel) => template.channels.includes(channel));
  // Every P0 catalogue template carries an in-app message; it anchors the
  // frozen row. A caller asking for email only is a programming error.
  if (!channels.includes("in_app")) return { created: false, reason: "invalid_template", channels };

  const result = await editProductData((data) => createNotificationInData(data, {
    userId: input.userId,
    templateId: input.templateId,
    eventKey: input.eventKey,
    params: input.params,
    isTest: input.isTest,
    related: input.related || input.sessionId || null,
    sessionId: input.sessionId,
    replaceUnreadEventKeyPrefix: input.replaceUnreadEventKeyPrefix,
    // This path owns the email send below; the deferred dispatcher must not
    // mail the same row again.
    freezeEmailParams: false,
    now: input.now,
  }));
  if (!result.created) return { ...result, channels };

  let email: SendNotificationEmailResult | undefined;
  if (channels.includes("email")) {
    email = await sendNotificationEmailForUser({
      userId: input.userId,
      templateId: input.templateId,
      params: input.params,
      notificationId: result.notification.id,
      related: input.related || input.sessionId || null,
      now: input.now,
      locale: input.locale,
      appUrl: input.appUrl,
      send: input.send,
      isTest: input.isTest,
    });
  }
  return { ...result, channels, ...(email ? { email } : {}) };
}

export async function listLearnerNotifications(userId: string, options: LearnerListOptions = {}): Promise<LearnerListResult> {
  const data = await readProductData();
  const user = data.users.find((item) => item.id === userId);
  const language: NotificationLanguage = options.language || (user?.locale.toLowerCase().startsWith("zh") ? "zh" : "en");
  return listLearnerNotificationsInData(data, userId, { ...options, language });
}

export async function unreadNotificationCount(userId: string): Promise<number> {
  return unreadCountInData(await readProductData(), userId);
}

export async function setNotificationRead(userId: string, notificationId: string, read: boolean) {
  return editProductData((data) => {
    const item = setNotificationReadInData(data, userId, notificationId, read);
    return { notification: item, unreadCount: unreadCountInData(data, userId) };
  });
}

export async function audienceCounts(now = new Date()) {
  const data = await readProductData();
  return {
    all: audienceUsers(data, "all", now).length,
    paid: audienceUsers(data, "paid", now).length,
  };
}

export async function createBroadcastDraft(input: BroadcastDraftInput) {
  return editProductData((data) => createBroadcastDraftInData(data, input));
}

export async function sendBroadcast(broadcastId: string, actor: string) {
  return editProductData((data) => sendBroadcastInData(data, broadcastId, actor));
}

/** "Send test to me" on the broadcast editor (NTF-BC-014): on-screen content, nothing saved. */
export async function sendBroadcastTest(input: Parameters<typeof sendBroadcastTestInData>[1]) {
  return editProductData((data) => sendBroadcastTestInData(data, input));
}

export async function withdrawBroadcast(broadcastId: string, actor: string) {
  return editProductData((data) => withdrawBroadcastInData(data, broadcastId, actor));
}

/** Broadcast list, newest first, 20 per page, with live read rates (NTF-BC-001..004). */
export async function listBroadcasts(page = 1) {
  return listBroadcastsInData(await readProductData(), page);
}

export async function updateBroadcast(broadcastId: string, patch: BroadcastUpdateInput, operator: string) {
  return editProductData((data) => updateBroadcastDraftInData(data, broadcastId, patch, operator));
}

export async function deleteBroadcast(broadcastId: string, operator: string) {
  return editProductData((data) => deleteBroadcastDraftInData(data, broadcastId, operator));
}

export async function broadcastDetail(broadcastId: string) {
  return broadcastDetailInData(await readProductData(), broadcastId);
}

export async function querySendLog(filters: SendLogFilters) {
  return querySendLogInData(await readProductData(), filters);
}

/** Send-log "View" detail (NTF-LOG-005), 404 once the row is past 180 days. */
export async function sendLogDetail(logId: string) {
  return sendLogDetailInData(await readProductData(), logId);
}

/** Daily retention clean-up (design §7, NTF-LOG-007). */
export async function purgeExpiredNotificationRecords() {
  return editProductData((data) => purgeExpiredNotificationRecordsInData(data));
}

export { encodeCursor };
