import { randomUUID } from "node:crypto";
import type { MigrationOrm } from "../migrationOrm";
import type {
  ProductData,
  ProductNotification,
  ProductUser,
} from "../productStore";
import { formatRelativeTime } from "./format";
import {
  FIELD_LABELS,
  localiseLink,
  MissingNotificationDataError,
  renderTemplate,
  templateFieldLimit,
  UnknownTemplateVariableError,
  validateTemplateCopy,
  type TemplateValidationIssue,
} from "./render";
import { isNotificationTemplateId, NOTIFICATION_TEMPLATES, TEMPLATE_NAMES, templateSeedRows } from "./templates";
import type {
  LearnerNotificationItem,
  NotificationAuditEntry,
  NotificationBroadcast,
  NotificationCategory,
  NotificationChannel,
  NotificationCopy,
  NotificationLanguage,
  NotificationLogEntry,
  NotificationTemplate,
  NotificationWriteMetadata,
} from "./types";

/**
 * Pure notification-domain operations over the Portal product aggregate.
 *
 * This module deliberately does NOT import productStore at runtime (only
 * types). productStore calls these functions inside its serialised edit
 * transaction, so a check-then-insert is atomic within a write.
 */

export const NOTIFICATION_TABLES = [
  "notificationTemplates",
  "notificationBroadcasts",
  "notificationLog",
  "notificationEmailDeliveries",
] as const;

const RETENTION_DAYS = 180;
const DAY_MS = 86400000;

function makeId(prefix: string) {
  return `${prefix}_${Date.now()}_${randomUUID().slice(0, 8)}`;
}

export function notificationTables(data: ProductData) {
  data.notificationTemplates ||= [];
  data.notificationBroadcasts ||= [];
  data.notificationLog ||= [];
  data.notificationEmailDeliveries ||= [];
  return {
    templates: data.notificationTemplates,
    broadcasts: data.notificationBroadcasts,
    log: data.notificationLog,
    deliveries: data.notificationEmailDeliveries,
  };
}

/** Idempotent seed: insert a missing template, never overwrite an operator edit. */
export function ensureNotificationTemplatesInData(data: ProductData): string[] {
  const { templates } = notificationTables(data);
  const added: string[] = [];
  for (const row of templateSeedRows()) {
    if (templates.some((item) => item.id === row.id)) continue;
    templates.push(row);
    added.push(row.id);
  }
  return added;
}

/** The same idempotent seed through migrationOrm, so a data migration/boot persists it. */
export function ensureNotificationTemplatesInOrm(orm: MigrationOrm): string[] {
  const table = orm.table<NotificationTemplate>("notificationTemplates");
  const added: string[] = [];
  for (const row of templateSeedRows()) {
    if (table.findById(row.id)) continue;
    table.insert(row);
    added.push(row.id);
  }
  return added;
}

/* ------------------------------------------------------------------ *
 * Template editing (design §3, NTF-BO-010..021)
 * ------------------------------------------------------------------ */

const COPY_FIELDS: Array<keyof NotificationCopy> = ["title", "message", "buttonText", "subject", "emailBody", "emailButtonText"];

export type TemplateIssue = {
  code: string;
  field: keyof NotificationCopy;
  language: NotificationLanguage;
  channel: NotificationChannel;
  variable?: string;
  suggestion?: string;
  maxLength?: number;
  message: string;
};

export type TemplateUpdateInput = {
  id: string;
  enabled?: boolean;
  en?: NotificationCopy;
  zh?: NotificationCopy;
  expectedUpdatedAt?: string | null;
  operator: string;
  now?: string;
};

export type TemplateUpdateResult =
  | { ok: true; template: NotificationTemplate }
  | { ok: false; code: "not_found"; message: string }
  | { ok: false; code: "locked"; message: string }
  | { ok: false; code: "validation_failed"; message: string; issues: TemplateIssue[] }
  | { ok: false; code: "conflict"; message: string; current: NotificationTemplate };

function normaliseCopy(value: NotificationCopy | undefined | null): NotificationCopy {
  const copy: NotificationCopy = {};
  if (!value || typeof value !== "object") return copy;
  for (const field of COPY_FIELDS) {
    const fieldValue = (value as Record<string, unknown>)[field];
    if (typeof fieldValue === "string") copy[field] = fieldValue;
  }
  return copy;
}

function issueMessage(issue: TemplateValidationIssue, channel: NotificationChannel): string {
  const label = FIELD_LABELS[issue.field as keyof NotificationCopy] || issue.field;
  if (issue.code === "unknown_variable") {
    const base = `Unknown variable {{${issue.variable}}}.`;
    return issue.suggestion ? `${base} Use {{${issue.suggestion}}} instead.` : base;
  }
  if (issue.code === "too_long") {
    const max = templateFieldLimit(channel, issue.field as keyof NotificationCopy);
    return max ? `${label} must be ${max} characters or fewer.` : `${label} is too long.`;
  }
  if (issue.code === "zh_incomplete" || issue.code === "missing_required") {
    return `${label} is required. Fill in every required Chinese field, or clear the Chinese copy.`;
  }
  return `${label} is invalid.`;
}

function validateLanguageCopy(template: NotificationTemplate, language: NotificationLanguage, copy: NotificationCopy): TemplateIssue[] {
  const issues: TemplateIssue[] = [];
  for (const channel of template.channels) {
    const channelIssues = validateTemplateCopy(template.id, channel, copy, language === "zh"
      ? { language: "zh", requireChinese: true }
      : { language: "en" });
    for (const issue of channelIssues) {
      issues.push({
        code: issue.code,
        field: issue.field as keyof NotificationCopy,
        language,
        channel,
        ...(issue.variable ? { variable: issue.variable } : {}),
        ...(issue.suggestion ? { suggestion: issue.suggestion } : {}),
        ...(issue.code === "too_long" ? { maxLength: templateFieldLimit(channel, issue.field as keyof NotificationCopy) || undefined } : {}),
        message: issueMessage(issue, channel),
      });
    }
  }
  return issues;
}

function writeMetadata(current: NotificationWriteMetadata | undefined, operator: string, action: string, now: string): NotificationWriteMetadata {
  return { ...(current || {}), lastOperator: operator, lastAction: action, lastUpdatedAt: now };
}

function appendAudit(
  target: { audit?: NotificationAuditEntry[]; metadata?: NotificationWriteMetadata },
  action: string,
  operator: string,
  now: string,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
) {
  target.audit ||= [];
  target.audit.push({ action, operator, at: now, before, after });
  target.metadata = writeMetadata(target.metadata, operator, action, now);
}

/**
 * Operator save of one template. Only messages created after the save change
 * (PRD NTF-BO-020); `expectedUpdatedAt` guards against a silent overwrite
 * (NTF-BO-021). Subscription templates are locked on (NTF-BO-004).
 */
export function updateTemplateInData(data: ProductData, input: TemplateUpdateInput): TemplateUpdateResult {
  const template = notificationTables(data).templates.find((item) => item.id === input.id);
  if (!template) return { ok: false, code: "not_found", message: "Notification template not found." };
  const now = input.now || new Date().toISOString();

  if (input.enabled !== undefined && typeof input.enabled !== "boolean") {
    return { ok: false, code: "validation_failed", message: "enabled must be a boolean.", issues: [] };
  }
  if (template.locked && input.enabled === false) {
    return { ok: false, code: "locked", message: "Subscription notifications are always on and cannot be switched off." };
  }
  if (input.expectedUpdatedAt !== undefined && (template.updatedAt ?? null) !== input.expectedUpdatedAt) {
    return {
      ok: false,
      code: "conflict",
      message: "This notification was changed after you opened it. Reload to see the latest version.",
      current: structuredClone(template),
    };
  }

  const en = input.en === undefined ? undefined : normaliseCopy(input.en);
  const zh = input.zh === undefined ? undefined : normaliseCopy(input.zh);
  const issues = [
    ...(en ? validateLanguageCopy(template, "en", en) : []),
    ...(zh ? validateLanguageCopy(template, "zh", zh) : []),
  ];
  if (issues.length) {
    return { ok: false, code: "validation_failed", message: issues[0].message, issues };
  }

  const copyChanged = en !== undefined || zh !== undefined;
  const action = copyChanged ? "template_saved" : "template_toggled";
  const before = copyChanged
    ? { enabled: template.enabled, en: template.en, zh: template.zh }
    : { enabled: template.enabled };
  if (input.enabled !== undefined) template.enabled = input.enabled;
  if (en !== undefined) template.en = en;
  if (zh !== undefined) template.zh = zh;
  template.updatedAt = now;
  template.updatedBy = input.operator;
  const after = copyChanged
    ? { enabled: template.enabled, en: template.en, zh: template.zh }
    : { enabled: template.enabled };
  appendAudit(template, action, input.operator, now, before, after);
  return { ok: true, template };
}

/** Appends one delivery-log row; exported for the test-send path in service.ts. */
export function appendNotificationLogInData(data: ProductData, entry: Omit<NotificationLogEntry, "id">): NotificationLogEntry {
  return appendLog(data, entry);
}

export type RenderedTestNotificationInput = {
  userId: string;
  templateId: string;
  category: NotificationCategory;
  rendered: { title: string; body: string; buttonText: string | null; link: string | null; language: NotificationLanguage };
  eventKey: string;
  operator: string;
  now?: string;
};

/** Store a rendered `[TEST]` in-app message plus its Test delivery log (NTF-BO-019). */
export function insertTestNotificationInData(data: ProductData, input: RenderedTestNotificationInput) {
  const now = input.now || new Date().toISOString();
  const notification: ProductNotification = {
    id: makeId("notification"),
    userId: input.userId,
    title: `[TEST] ${input.rendered.title}`,
    body: input.rendered.body,
    readAt: null,
    createdAt: now,
    category: input.category,
    templateId: input.templateId,
    buttonText: input.rendered.buttonText || undefined,
    buttonLink: input.rendered.link || undefined,
    language: input.rendered.language,
    withdrawnAt: null,
    eventKey: input.eventKey,
    isTest: true,
  };
  data.notifications.unshift(notification);
  const log = appendLog(data, {
    notificationId: notification.id,
    userId: input.userId,
    templateId: input.templateId,
    channel: "in_app",
    status: "delivered",
    failureReason: null,
    occurredAt: now,
    isTest: true,
    related: null,
  });
  return { notification, log };
}

export type CreateNotificationInput = {
  userId: string;
  templateId: string;
  eventKey: string;
  params: Record<string, unknown>;
  isTest?: boolean;
  related?: string | null;
  /** Live Session link carried by the reminders strip (BUG-0109). */
  sessionId?: string;
  /**
   * When set, an unread, non-withdrawn row whose event key starts with this
   * prefix is updated in place instead of stacking a second message (PRD §5
   * HELPDESK_TICKET_REPLIED: "if an unread one for the same ticket exists, it
   * is updated instead").
   */
  replaceUnreadEventKeyPrefix?: string;
  /**
   * Fan-out: the keys already used (see buildSeenEventKeys), so the duplicate
   * check is one Set lookup instead of a scan of every row per recipient.
   */
  seenEventKeys?: Set<string>;
  /**
   * Freeze the rendered variables for the deferred email dispatcher. Callers
   * that send the email themselves in the same action pass false so the
   * dispatcher never mails the row a second time.
   */
  freezeEmailParams?: boolean;
  now?: string;
};

/**
 * Internal state the email channel freezes onto a notification row. The design
 * says rendering uses the learner's language and variable values at send time;
 * keeping the params on the row lets the deferred dispatcher render a template
 * whose write point (the subscription webhook, outside this module) only had
 * the in-app channel to create. `emailClaimedAt` is the dispatcher's short
 * lease so two process ticks do not both mail one row.
 */
export type NotificationEmailState = {
  params?: Record<string, unknown>;
  emailClaimedAt?: string;
};
export type NotificationEmailRow = ProductNotification & NotificationEmailState;

export function notificationEmailRow(notification: ProductNotification): NotificationEmailRow {
  return notification as NotificationEmailRow;
}

export type CreateNotificationResult =
  | { created: true; notification: ProductNotification; log: NotificationLogEntry }
  | { created: false; reason: "duplicate" | "disabled" | "missing_data" | "unknown_template" | "unknown_user" | "invalid_template"; variables?: string[] };

function appendLog(data: ProductData, entry: Omit<NotificationLogEntry, "id">): NotificationLogEntry {
  const row: NotificationLogEntry = { ...entry, id: makeId("nlog") };
  notificationTables(data).log.unshift(row);
  return row;
}

function categoryForTemplate(template: NotificationTemplate): NotificationCategory {
  return template.category;
}

/** The "user + event key" pairs of every non-test message and log entry, built once for a fan-out. */
export function buildSeenEventKeys(data: ProductData): Set<string> {
  const seen = new Set<string>();
  for (const item of data.notifications) if (item.eventKey && !item.isTest) seen.add(`${item.userId}\u0000${item.eventKey}`);
  for (const entry of notificationTables(data).log) if (entry.eventKey && !entry.isTest) seen.add(`${entry.userId}\u0000${entry.eventKey}`);
  return seen;
}

/**
 * Render + store one system notification. The same event key for the same
 * learner can only create one non-test row. Missing data records Failed
 * "missing data" and sends nothing (PRD §10).
 */
export function createNotificationInData(data: ProductData, input: CreateNotificationInput): CreateNotificationResult {
  const template = notificationTables(data).templates.find((item) => item.id === input.templateId);
  if (!template) return { created: false, reason: "unknown_template" };
  const user = data.users.find((item) => item.id === input.userId);
  if (!user) return { created: false, reason: "unknown_user" };
  const now = input.now || new Date().toISOString();

  const seenKey = `${input.userId}\u0000${input.eventKey}`;
  const duplicate = !input.isTest && (input.seenEventKeys
    ? input.seenEventKeys.has(seenKey)
    : data.notifications.some((item) => item.userId === input.userId && item.eventKey === input.eventKey && !item.isTest)
      || notificationTables(data).log.some((entry) => entry.userId === input.userId && entry.eventKey === input.eventKey && !entry.isTest)
  );
  if (duplicate) return { created: false, reason: "duplicate" };
  // Every outcome from here writes a row or a log entry carrying this event key.
  if (!input.isTest) input.seenEventKeys?.add(seenKey);

  if (!template.enabled && !input.isTest) {
    // The event is consumed: switching the template back on must not send a
    // message for an event that happened while it was off (PRD §10).
    appendLog(data, {
      notificationId: null,
      userId: input.userId,
      templateId: template.id,
      channel: "in_app",
      status: "failed",
      failureReason: "notification disabled",
      occurredAt: now,
      isTest: false,
      related: input.related || null,
      eventKey: input.eventKey,
    });
    return { created: false, reason: "disabled" };
  }

  let rendered;
  try {
    rendered = renderTemplate(template, { locale: user.locale, channel: "in_app", params: input.params, now });
  } catch (error) {
    if (error instanceof MissingNotificationDataError) {
      appendLog(data, {
        notificationId: null,
        userId: input.userId,
        templateId: template.id,
        channel: "in_app",
        status: "failed",
        failureReason: "missing data",
        occurredAt: now,
        isTest: Boolean(input.isTest),
        related: input.related || null,
        eventKey: input.eventKey,
      });
      return { created: false, reason: "missing_data", variables: error.variables };
    }
    if (error instanceof UnknownTemplateVariableError) {
      appendLog(data, {
        notificationId: null,
        userId: input.userId,
        templateId: template.id,
        channel: "in_app",
        status: "failed",
        failureReason: "invalid template variable",
        occurredAt: now,
        isTest: Boolean(input.isTest),
        related: input.related || null,
        eventKey: input.eventKey,
      });
      return { created: false, reason: "invalid_template", variables: error.variables };
    }
    throw error;
  }

  const title = input.isTest ? `[TEST] ${rendered.title}` : rendered.title;
  // One unread row per HelpDesk ticket: a new reply refreshes it rather than
  // stacking a second message (PRD §5). The event key moves to the newest
  // reply so a replay of that reply is still a duplicate.
  const replaceable = !input.isTest && input.replaceUnreadEventKeyPrefix
    ? data.notifications.find((item) => item.userId === input.userId
      && !item.readAt && !item.withdrawnAt && !item.isTest
      && item.templateId === template.id
      && Boolean(item.eventKey?.startsWith(input.replaceUnreadEventKeyPrefix!)))
    : undefined;
  let notification: ProductNotification;
  if (replaceable) {
    replaceable.title = title;
    replaceable.body = rendered.body;
    replaceable.createdAt = now;
    replaceable.category = categoryForTemplate(template);
    replaceable.buttonText = rendered.buttonText || undefined;
    replaceable.buttonLink = rendered.link || undefined;
    replaceable.language = rendered.language;
    replaceable.eventKey = input.eventKey;
    if (input.sessionId) replaceable.sessionId = input.sessionId;
    notification = replaceable;
  } else {
    notification = {
      id: makeId("notification"),
      userId: input.userId,
      title,
      body: rendered.body,
      readAt: null,
      createdAt: now,
      category: categoryForTemplate(template),
      templateId: template.id,
      buttonText: rendered.buttonText || undefined,
      buttonLink: rendered.link || undefined,
      language: rendered.language,
      withdrawnAt: null,
      eventKey: input.eventKey,
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      ...(input.isTest ? { isTest: true } : {}),
    };
    data.notifications.unshift(notification);
  }
  if (template.channels.includes("email") && input.freezeEmailParams !== false) {
    // Frozen variable values for the deferred email channel. Only the three
    // P0 email templates carry this; in-app-only rows stay as they are.
    notificationEmailRow(notification).params = { ...input.params };
  }
  const log = appendLog(data, {
    notificationId: notification.id,
    userId: input.userId,
    templateId: template.id,
    channel: "in_app",
    status: "delivered",
    failureReason: null,
    occurredAt: now,
    isTest: Boolean(input.isTest),
    related: input.related || null,
    eventKey: input.eventKey,
  });
  return { created: true, notification, log };
}

/* ------------------------------------------------------------------ *
 * Legacy write-point adapter (modules that still supply their own copy)
 * ------------------------------------------------------------------ */

const LEGACY_TITLES: Record<string, string> = {
  "Live Session reminder": "LIVE_SESSION_REMINDER",
  "直播课提醒": "LIVE_SESSION_REMINDER",
  "Live Session rescheduled": "LIVE_SESSION_RESCHEDULED",
  "直播课时间已更改": "LIVE_SESSION_RESCHEDULED",
  "Live Session cancelled": "LIVE_SESSION_CANCELLED",
  "直播课已取消": "LIVE_SESSION_CANCELLED",
  "Support replied to your request": "HELPDESK_TICKET_REPLIED",
  "客服回复了你的工单": "HELPDESK_TICKET_REPLIED",
};

const LEGACY_BUTTONS: Record<string, { en: string; zh: string; link: (sessionId?: string) => string | null }> = {
  LIVE_SESSION_REMINDER: { en: "Join now", zh: "立即加入", link: (sessionId) => sessionId ? `/portal/study-groups/sessions/${sessionId}` : null },
  LIVE_SESSION_RESCHEDULED: { en: "View session", zh: "查看直播课", link: (sessionId) => sessionId ? `/portal/study-groups/sessions/${sessionId}` : null },
  LIVE_SESSION_CANCELLED: { en: "View session", zh: "查看直播课", link: (sessionId) => sessionId ? `/portal/study-groups/sessions/${sessionId}` : null },
  HELPDESK_TICKET_REPLIED: { en: "View reply", zh: "查看回复", link: () => "/account/my-learning/support" },
};

function languageOf(text: string): NotificationLanguage {
  return /[一-鿿]/.test(text) ? "zh" : "en";
}

function categoryForLegacy(templateId: string | undefined, title: string): NotificationCategory | undefined {
  if (templateId) return notificationTemplateCategory(templateId);
  if (/Study Group|学习小组/i.test(title)) return "study_group";
  return undefined;
}

function notificationTemplateCategory(templateId: string): NotificationCategory | undefined {
  return NOTIFICATION_TEMPLATES.find((item) => item.id === templateId)?.category;
}

export type LegacyNotificationInput = {
  userId: string;
  title: string;
  body: string;
  sessionId?: string;
  copies?: Partial<Record<"en-GB" | "zh-CN", { title: string; body: string }>>;
  now?: string;
};

/**
 * Wire the existing Study Group and HelpDesk write points into the notification
 * domain without changing their module contracts: classify the row, attach the
 * template id/language/link and record the delivery. HelpDesk updates an
 * existing unread reply row for the same ticket instead of stacking a second
 * (PRD §5 HELPDESK_TICKET_REPLIED).
 */
export function recordLegacyNotificationInData(data: ProductData, input: LegacyNotificationInput): ProductNotification {
  const now = input.now || new Date().toISOString();
  const templateId = LEGACY_TITLES[input.title];
  const language = languageOf(input.title);
  const category = categoryForLegacy(templateId, input.title);
  const buttons = templateId ? LEGACY_BUTTONS[templateId] : undefined;
  const buttonText = buttons ? (language === "zh" ? buttons.zh : buttons.en) : undefined;
  const learner = data.users.find((user) => user.id === input.userId);
  const buttonLink = localiseLink(buttons?.link(input.sessionId) || null, learner?.locale ?? language) || undefined;

  if (templateId === "HELPDESK_TICKET_REPLIED") {
    const number = input.body.match(/\b[A-Z]{2}-\d{6}-\d{4}\b/)?.[0];
    const existing = number
      ? data.notifications.find((item) => item.userId === input.userId
        && item.templateId === "HELPDESK_TICKET_REPLIED"
        && !item.readAt && !item.withdrawnAt && item.body.includes(number))
      : undefined;
    if (existing) {
      existing.title = input.title;
      existing.body = input.body;
      existing.createdAt = now;
      existing.language = language;
      existing.category = category;
      existing.buttonText = buttonText;
      existing.buttonLink = buttonLink;
      appendLog(data, {
        notificationId: existing.id, userId: input.userId, templateId, channel: "in_app",
        status: "delivered", failureReason: null, occurredAt: now, isTest: false, related: number || null,
      });
      return existing;
    }
  }

  const notification: ProductNotification = {
    id: makeId("notification"),
    userId: input.userId,
    title: input.title,
    body: input.body,
    readAt: null,
    createdAt: now,
    ...(category ? { category } : {}),
    ...(templateId ? { templateId } : {}),
    ...(buttonText ? { buttonText } : {}),
    ...(buttonLink ? { buttonLink } : {}),
    language,
    withdrawnAt: null,
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    ...(input.copies ? { copies: input.copies } : {}),
  };
  data.notifications.unshift(notification);
  appendLog(data, {
    notificationId: notification.id,
    userId: input.userId,
    templateId: templateId || null,
    channel: "in_app",
    status: "delivered",
    failureReason: null,
    occurredAt: now,
    isTest: false,
    related: input.sessionId || null,
  });
  return notification;
}

/* ------------------------------------------------------------------ *
 * Learner inbox
 * ------------------------------------------------------------------ */

export const CATEGORY_LABELS: Record<NotificationCategory, { en: string; zh: string }> = {
  subscription: { en: "Subscription", zh: "订阅" },
  study_group: { en: "Study group", zh: "学习小组" },
  announcement: { en: "Announcement", zh: "公告" },
  support: { en: "Support", zh: "客服" },
  course: { en: "New course", zh: "新课程" },
};

export function categoryLabel(category: NotificationCategory, language: NotificationLanguage) {
  return CATEGORY_LABELS[category]?.[language] || CATEGORY_LABELS.announcement[language];
}

/**
 * Rows from before Notification P0 (welcome, trial notices) were never part of
 * the P0 catalogue; they carry no category/template/broadcast marker and are
 * not shown in the new Notification Center or counted in its badge.
 */
function learnerVisible(item: ProductNotification) {
  return Boolean(item.category || item.templateId || item.broadcastId);
}

function learnerItems(data: ProductData, userId: string, language: NotificationLanguage, now: Date): LearnerNotificationItem[] {
  const cutoff = now.getTime() - RETENTION_DAYS * DAY_MS;
  return data.notifications
    .filter((item) => item.userId === userId && learnerVisible(item) && !item.withdrawnAt && Date.parse(item.createdAt) >= cutoff)
    .map((item) => {
      const isTest = Boolean(item.isTest);
      const category = item.category || (item.broadcastId ? "announcement" : "subscription");
      return {
        id: item.id,
        category,
        categoryLabel: categoryLabel(category, language),
        templateId: item.templateId || null,
        broadcastId: item.broadcastId || null,
        title: item.title,
        body: item.body,
        buttonText: item.buttonText || null,
        buttonLink: item.buttonLink || null,
        language: item.language || language,
        // A test message is shown to its recipient but is never "unread".
        read: isTest || Boolean(item.readAt),
        unread: !isTest && !item.readAt,
        isTest,
        readAt: item.readAt,
        createdAt: item.createdAt,
        displayTime: formatRelativeTime(item.createdAt, now, language),
      } satisfies LearnerNotificationItem;
    })
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id));
}

export type LearnerListOptions = {
  filter?: "all" | "unread";
  limit?: number;
  cursor?: string | null;
  language?: NotificationLanguage;
  now?: string | Date;
};

export type LearnerListResult = {
  items: LearnerNotificationItem[];
  unreadCount: number;
  /** Items matching the filter before the cursor is applied. */
  total: number;
  nextCursor: string | null;
};

export type NotificationCursor = { createdAt: string; id: string };

export function encodeCursor(cursor: NotificationCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeCursor(value: string | null | undefined): NotificationCursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<NotificationCursor>;
    return typeof parsed.createdAt === "string" && typeof parsed.id === "string" ? { createdAt: parsed.createdAt, id: parsed.id } : null;
  } catch {
    return null;
  }
}

export function listLearnerNotificationsInData(data: ProductData, userId: string, options: LearnerListOptions = {}): LearnerListResult {
  const now = options.now ? new Date(options.now) : new Date();
  const language: NotificationLanguage = options.language || "en";
  const limit = Math.min(50, Math.max(1, options.limit || 20));
  const all = learnerItems(data, userId, language, now);
  const unreadCount = all.filter((item) => !item.read).length;
  const filtered = options.filter === "unread" ? all.filter((item) => !item.read) : all;
  const cursor = decodeCursor(options.cursor);
  const remaining = cursor
    ? filtered.filter((item) => item.createdAt < cursor.createdAt || (item.createdAt === cursor.createdAt && item.id < cursor.id))
    : filtered;
  const items = remaining.slice(0, limit);
  const nextCursor = remaining.length > limit ? encodeCursor({ createdAt: items[items.length - 1].createdAt, id: items[items.length - 1].id }) : null;
  return { items, unreadCount, total: filtered.length, nextCursor };
}

export function unreadCountInData(data: ProductData, userId: string, now = new Date()): number {
  const cutoff = now.getTime() - RETENTION_DAYS * DAY_MS;
  return data.notifications.filter((item) =>
    item.userId === userId && learnerVisible(item) && !item.withdrawnAt && !item.isTest && !item.readAt && Date.parse(item.createdAt) >= cutoff,
  ).length;
}

export function setNotificationReadInData(data: ProductData, userId: string, notificationId: string, read: boolean, now = new Date().toISOString()) {
  const item = data.notifications.find((notification) => notification.id === notificationId && notification.userId === userId);
  if (!item) throw new Error("Notification not found.");
  item.readAt = read ? now : null;
  appendLog(data, {
    notificationId: item.id, userId, templateId: item.templateId || null, broadcastId: item.broadcastId || null,
    channel: "in_app", status: read ? "read" : "delivered", failureReason: null, occurredAt: now, isTest: Boolean(item.isTest),
  });
  return item;
}

/* ------------------------------------------------------------------ *
 * Audiences (PRD §7.4)
 * ------------------------------------------------------------------ */

export function allAudienceUsers(data: ProductData): ProductUser[] {
  return data.users.filter((user) =>
    Boolean(user.email) && Boolean(user.emailVerifiedAt) && user.status === "active" && !user.deactivatedAt && !user.mergedIntoUserId,
  );
}

/** PRD §7.4: paid = access at send time, including cancel-at-period-end and grace. */
function subscriptionHasLiveAccess(subscription: ProductData["subscriptions"][number], now: number) {
  if (subscription.supersededBy) return false;
  if (subscription.state === "active" || subscription.state === "cancel_at_period_end") {
    return Date.parse(subscription.validTo) > now;
  }
  if (subscription.state === "grace") {
    // Grace keeps access after the period end until graceEndsAt (period end + 3 days).
    const graceEnd = subscription.graceEndsAt
      ? Date.parse(subscription.graceEndsAt)
      : Date.parse(subscription.validTo) + 3 * DAY_MS;
    return Number.isFinite(graceEnd) ? graceEnd > now : false;
  }
  return false;
}

export function paidAudienceUsers(data: ProductData, now = new Date()): ProductUser[] {
  const live = new Set(
    data.subscriptions
      .filter((subscription) => subscription.source === "purchase" && subscriptionHasLiveAccess(subscription, now.getTime()))
      .map((subscription) => subscription.userId),
  );
  return allAudienceUsers(data).filter((user) => live.has(user.id));
}

export function audienceUsers(data: ProductData, audience: "all" | "paid", now = new Date()): ProductUser[] {
  return audience === "paid" ? paidAudienceUsers(data, now) : allAudienceUsers(data);
}

/* ------------------------------------------------------------------ *
 * Broadcasts
 * ------------------------------------------------------------------ */

export type BroadcastDraftInput = {
  titleEn: string;
  bodyEn: string;
  titleZh?: string | null;
  bodyZh?: string | null;
  buttonText?: string | null;
  buttonLink?: string | null;
  audience: "all" | "paid";
  createdBy: string;
};

export type BroadcastUpdateInput = Partial<Omit<BroadcastDraftInput, "createdBy">>;

export class BroadcastError extends Error {
  constructor(public readonly code: "invalid" | "not_found" | "not_draft" | "not_sent", message: string) {
    super(message);
    this.name = "BroadcastError";
  }
}

function validBroadcastLink(link: string) {
  return /^https:\/\//.test(link) || link.startsWith("/");
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

type NormalisedBroadcastFields = {
  titleEn: string;
  bodyEn: string;
  titleZh: string | null;
  bodyZh: string | null;
  buttonText: string | null;
  buttonLink: string | null;
  audience: "all" | "paid";
};

/** PRD NTF-BC-010..012: content limits, paired button and a safe link. */
function validateBroadcastFields(input: {
  titleEn: unknown; bodyEn: unknown; titleZh?: unknown; bodyZh?: unknown;
  buttonText?: unknown; buttonLink?: unknown; audience: unknown;
}): NormalisedBroadcastFields {
  const titleEn = stringValue(input.titleEn);
  const bodyEn = stringValue(input.bodyEn);
  const titleZh = stringValue(input.titleZh) || null;
  const bodyZh = stringValue(input.bodyZh) || null;
  const buttonText = stringValue(input.buttonText) || null;
  const buttonLink = stringValue(input.buttonLink) || null;
  if (!titleEn || titleEn.length > 60) throw new BroadcastError("invalid", "English title must be 1–60 characters.");
  if (!bodyEn || bodyEn.length > 300) throw new BroadcastError("invalid", "English message must be 1–300 characters.");
  if ((titleZh || "").length > 60) throw new BroadcastError("invalid", "Chinese title must be 60 characters or fewer.");
  if ((bodyZh || "").length > 300) throw new BroadcastError("invalid", "Chinese message must be 300 characters or fewer.");
  if ((buttonText || "").length > 24) throw new BroadcastError("invalid", "Button text must be 24 characters or fewer.");
  if (Boolean(buttonText) !== Boolean(buttonLink)) throw new BroadcastError("invalid", "Button text and link must be provided together.");
  if (buttonLink && !validBroadcastLink(buttonLink)) throw new BroadcastError("invalid", "Button link must start with https:// or /.");
  if (input.audience !== "all" && input.audience !== "paid") throw new BroadcastError("invalid", "Audience must be all or paid.");
  return { titleEn, bodyEn, titleZh, bodyZh, buttonText, buttonLink, audience: input.audience };
}

export function createBroadcastDraftInData(data: ProductData, input: BroadcastDraftInput, now = new Date().toISOString()): NotificationBroadcast {
  const fields = validateBroadcastFields(input);
  const createdBy = stringValue(input.createdBy);
  if (!createdBy) throw new BroadcastError("invalid", "createdBy is required.");
  const { broadcasts } = notificationTables(data);
  const broadcast: NotificationBroadcast = {
    id: makeId("broadcast"),
    ...fields,
    status: "draft",
    createdBy,
    createdAt: now,
    sentAt: null,
    withdrawnAt: null,
    withdrawnBy: null,
  };
  appendAudit(broadcast, "broadcast_draft_saved", createdBy, now, null, { status: "draft", audience: fields.audience });
  broadcasts.unshift(broadcast);
  return broadcast;
}

function broadcastSummary(broadcast: NotificationBroadcast) {
  return {
    titleEn: broadcast.titleEn,
    bodyEn: broadcast.bodyEn,
    titleZh: broadcast.titleZh,
    bodyZh: broadcast.bodyZh,
    buttonText: broadcast.buttonText,
    buttonLink: broadcast.buttonLink,
    audience: broadcast.audience,
    status: broadcast.status,
  };
}

/** Save a draft (PRD 7.2 Save draft). Only a draft can be edited. */
export function updateBroadcastDraftInData(
  data: ProductData,
  broadcastId: string,
  patch: BroadcastUpdateInput,
  operator: string,
  now = new Date().toISOString(),
): NotificationBroadcast {
  const broadcast = notificationTables(data).broadcasts.find((item) => item.id === broadcastId);
  if (!broadcast || broadcast.deletedAt) throw new BroadcastError("not_found", "Broadcast not found.");
  if (broadcast.status !== "draft") throw new BroadcastError("not_draft", "Only a draft can be edited.");
  const before = broadcastSummary(broadcast);
  const pick = <T>(next: T | undefined, current: T): T => (next === undefined ? current : next);
  const fields = validateBroadcastFields({
    titleEn: pick(patch.titleEn, broadcast.titleEn),
    bodyEn: pick(patch.bodyEn, broadcast.bodyEn),
    titleZh: pick(patch.titleZh, broadcast.titleZh),
    bodyZh: pick(patch.bodyZh, broadcast.bodyZh),
    buttonText: pick(patch.buttonText, broadcast.buttonText),
    buttonLink: pick(patch.buttonLink, broadcast.buttonLink),
    audience: pick(patch.audience, broadcast.audience),
  });
  Object.assign(broadcast, fields);
  appendAudit(broadcast, "broadcast_draft_saved", operator, now, before, broadcastSummary(broadcast));
  return broadcast;
}

/** PRD 7: delete a draft. The row remains as an audited tombstone. */
export function deleteBroadcastDraftInData(data: ProductData, broadcastId: string, operator: string, now = new Date().toISOString()) {
  const broadcast = notificationTables(data).broadcasts.find((item) => item.id === broadcastId);
  if (!broadcast || broadcast.deletedAt) throw new BroadcastError("not_found", "Broadcast not found.");
  if (broadcast.status !== "draft") throw new BroadcastError("not_draft", "Only a draft can be deleted.");
  broadcast.deletedAt = now;
  broadcast.deletedBy = operator;
  appendAudit(broadcast, "broadcast_deleted", operator, now, { status: "draft" }, { status: "deleted" });
  return { deleted: true as const };
}

export function sendBroadcastInData(data: ProductData, broadcastId: string, actor: string, now = new Date().toISOString()) {
  const broadcast = notificationTables(data).broadcasts.find((item) => item.id === broadcastId);
  if (!broadcast || broadcast.deletedAt) throw new BroadcastError("not_found", "Broadcast not found.");
  if (broadcast.status !== "draft") throw new BroadcastError("not_draft", "Only a draft can be sent.");
  const recipients = audienceUsers(data, broadcast.audience, new Date(now));
  for (const user of recipients) {
    const language: NotificationLanguage = user.locale.toLowerCase().startsWith("zh") && broadcast.titleZh && broadcast.bodyZh ? "zh" : "en";
    const notification: ProductNotification = {
      id: makeId("notification"),
      userId: user.id,
      title: (language === "zh" ? broadcast.titleZh! : broadcast.titleEn),
      body: (language === "zh" ? broadcast.bodyZh! : broadcast.bodyEn),
      readAt: null,
      createdAt: now,
      category: "announcement",
      broadcastId: broadcast.id,
      buttonText: broadcast.buttonText || undefined,
      buttonLink: localiseLink(broadcast.buttonLink ?? null, user.locale) || undefined,
      language,
      withdrawnAt: null,
      eventKey: `broadcast:${broadcast.id}:${user.id}`,
    };
    data.notifications.unshift(notification);
    appendLog(data, {
      notificationId: notification.id, userId: user.id, templateId: null, broadcastId: broadcast.id,
      channel: "in_app", status: "delivered", failureReason: null, occurredAt: now, isTest: false,
    });
  }
  broadcast.status = "sent";
  broadcast.sentAt = now;
  appendAudit(broadcast, "broadcast_sent", actor, now, { status: "draft" }, { status: "sent", recipients: recipients.length });
  return { recipients: recipients.length };
}

export function withdrawBroadcastInData(data: ProductData, broadcastId: string, actor: string, now = new Date().toISOString()) {
  const broadcast = notificationTables(data).broadcasts.find((item) => item.id === broadcastId);
  if (!broadcast || broadcast.deletedAt) throw new BroadcastError("not_found", "Broadcast not found.");
  if (broadcast.status !== "sent") throw new BroadcastError("not_sent", "Only a sent broadcast can be withdrawn.");
  broadcast.status = "withdrawn";
  broadcast.withdrawnAt = now;
  broadcast.withdrawnBy = actor;
  let withdrawn = 0;
  for (const notification of data.notifications) {
    if (notification.broadcastId !== broadcast.id || notification.withdrawnAt) continue;
    notification.withdrawnAt = now;
    withdrawn += 1;
    appendLog(data, {
      notificationId: notification.id, userId: notification.userId, templateId: null, broadcastId: broadcast.id,
      channel: "in_app", status: "withdrawn", failureReason: null, occurredAt: now, isTest: Boolean(notification.isTest),
    });
  }
  appendAudit(broadcast, "broadcast_withdrawn", actor, now, { status: "sent" }, { status: "withdrawn", withdrawn });
  return { withdrawn };
}

export function broadcastReadRateInData(data: ProductData, broadcastId: string) {
  const rows = data.notifications.filter((item) => item.broadcastId === broadcastId && !item.isTest);
  const read = rows.filter((item) => item.readAt).length;
  return { recipients: rows.length, read, rate: rows.length ? read / rows.length : 0 };
}

export const BROADCAST_PAGE_SIZE = 20;

/** Broadcast list: newest first, 20 per page, read rate refreshed on read (NTF-BC-001..004). */
export function listBroadcastsInData(data: ProductData, page = 1) {
  const pageNumber = Math.max(1, Math.floor(page || 1));
  const { broadcasts } = notificationTables(data);
  const rows = [...broadcasts]
    .filter((broadcast) => !broadcast.deletedAt)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id))
    .map((broadcast) => ({ ...broadcast, ...broadcastReadRateInData(data, broadcast.id) }));
  return {
    items: rows.slice((pageNumber - 1) * BROADCAST_PAGE_SIZE, pageNumber * BROADCAST_PAGE_SIZE),
    total: rows.length,
    page: pageNumber,
    pageSize: BROADCAST_PAGE_SIZE,
  };
}

/** "View" detail: the broadcast, its live read rate and the recorded status times. */
export function broadcastDetailInData(data: ProductData, broadcastId: string) {
  const broadcast = notificationTables(data).broadcasts.find((item) => item.id === broadcastId);
  if (!broadcast || broadcast.deletedAt) return null;
  const readRate = broadcastReadRateInData(data, broadcastId);
  return {
    broadcast: { ...broadcast, ...readRate },
    readRate,
    timeline: [
      { status: "draft", at: broadcast.createdAt, by: broadcast.createdBy },
      ...(broadcast.sentAt ? [{ status: "sent", at: broadcast.sentAt, by: broadcast.audit?.find((item) => item.action === "broadcast_sent")?.operator || broadcast.createdBy }] : []),
      ...(broadcast.withdrawnAt ? [{ status: "withdrawn", at: broadcast.withdrawnAt, by: broadcast.withdrawnBy || "" }] : []),
    ],
  };
}

/* ------------------------------------------------------------------ *
 * Send log (PRD §8)
 * ------------------------------------------------------------------ */

export type SendLogFilters = {
  recipient?: string;
  template?: string;
  broadcast?: string;
  channel?: NotificationChannel;
  status?: NotificationLogEntry["status"];
  from?: string;
  to?: string;
  page?: number;
};

export type SendLogItem = {
  id: string;
  occurredAt: string;
  recipientEmail: string;
  recipientName: string;
  notificationId: string | null;
  templateId: string | null;
  broadcastId: string | null;
  notificationName: string;
  channel: NotificationChannel;
  status: NotificationLogEntry["status"];
  failureReason: string | null;
  isTest: boolean;
  related: string | null;
};

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Operator dates are HKT days; a bare date covers the whole day (PRD §4.4). */
function parseFilterBound(value: string | undefined, endOfDay: boolean): number | null {
  if (!value) return null;
  if (DATE_ONLY.test(value)) return Date.parse(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}+08:00`);
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function sendLogItem(
  data: ProductData,
  entry: NotificationLogEntry,
  lookups: {
    users: Map<string, ProductUser>;
    broadcasts: Map<string, NotificationBroadcast>;
    templates: Map<string, NotificationTemplate>;
  },
): SendLogItem {
  const user = lookups.users.get(entry.userId);
  const template = entry.templateId ? lookups.templates.get(entry.templateId) : undefined;
  const broadcast = entry.broadcastId ? lookups.broadcasts.get(entry.broadcastId) : undefined;
  return {
    id: entry.id,
    occurredAt: entry.occurredAt,
    recipientEmail: user?.email || entry.recipientEmail || "",
    recipientName: user?.nickname || entry.recipientName || "",
    notificationId: entry.notificationId,
    templateId: entry.templateId || null,
    broadcastId: entry.broadcastId || null,
    notificationName: template ? TEMPLATE_NAMES[template.id] || template.id : broadcast?.titleEn || "Broadcast",
    channel: entry.channel,
    status: entry.status,
    failureReason: entry.failureReason || null,
    isTest: entry.isTest,
    related: entry.related || null,
  };
}

export function querySendLogInData(data: ProductData, filters: SendLogFilters = {}, now = new Date()) {
  const pageSize = 20;
  const page = Math.max(1, Math.floor(filters.page || 1));
  const cutoff = now.getTime() - RETENTION_DAYS * DAY_MS;
  const defaultFrom = now.getTime() - 7 * DAY_MS;
  const requestedFrom = parseFilterBound(filters.from, false);
  const requestedTo = parseFilterBound(filters.to, true);
  // Read side of the 180-day rule: never return an expired record.
  const from = Math.max(requestedFrom ?? defaultFrom, cutoff);
  const to = requestedTo ?? Infinity;
  const users = new Map(data.users.map((user) => [user.id, user]));
  const broadcasts = new Map(notificationTables(data).broadcasts.map((item) => [item.id, item]));
  const templates = new Map(notificationTables(data).templates.map((item) => [item.id, item]));
  // One row per message per channel: the newest status of each channel wins.
  const latest = new Map<string, NotificationLogEntry>();
  for (const entry of [...notificationTables(data).log].sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))) {
    const key = `${entry.notificationId || entry.id}:${entry.channel}`;
    if (!latest.has(key)) latest.set(key, entry);
  }
  const rows: SendLogItem[] = [...latest.values()].flatMap((entry) => {
    const time = Date.parse(entry.occurredAt);
    if (Number.isNaN(time) || time < from || time > to || time < cutoff) return [];
    if (filters.channel && entry.channel !== filters.channel) return [];
    if (filters.status && entry.status !== filters.status) return [];
    const item = sendLogItem(data, entry, { users, broadcasts, templates });
    if (filters.recipient) {
      const needle = filters.recipient.toLowerCase();
      if (!item.recipientEmail.toLowerCase().includes(needle) && !item.recipientName.toLowerCase().includes(needle)) return [];
    }
    if (filters.template && entry.templateId !== filters.template) return [];
    if (filters.broadcast && entry.broadcastId !== filters.broadcast) return [];
    return [item];
  }).sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));
  return {
    items: rows.slice((page - 1) * pageSize, page * pageSize),
    total: rows.length,
    page,
    pageSize,
  };
}

export type SendLogDetail = {
  entry: SendLogItem;
  message: {
    notificationId: string;
    title: string;
    body: string;
    buttonText: string | null;
    buttonLink: string | null;
    language: NotificationLanguage;
    category: NotificationCategory | null;
    createdAt: string;
    readAt: string | null;
    withdrawnAt: string | null;
  } | null;
  timeline: Array<{ status: NotificationLogEntry["status"]; occurredAt: string; failureReason: string | null }>;
  isTest: boolean;
};

/** "View" panel: the message as sent, status times, failure reason and related record (NTF-LOG-005). */
export function sendLogDetailInData(data: ProductData, logId: string, now = new Date()): SendLogDetail | null {
  const log = notificationTables(data).log.find((entry) => entry.id === logId);
  if (!log) return null;
  if (Date.parse(log.occurredAt) < now.getTime() - RETENTION_DAYS * DAY_MS) return null;
  const users = new Map(data.users.map((user) => [user.id, user]));
  const broadcasts = new Map(notificationTables(data).broadcasts.map((item) => [item.id, item]));
  const templates = new Map(notificationTables(data).templates.map((item) => [item.id, item]));
  const entry = sendLogItem(data, log, { users, broadcasts, templates });
  const notification = log.notificationId ? data.notifications.find((item) => item.id === log.notificationId) : undefined;
  const relatedLogs = log.notificationId
    ? notificationTables(data).log.filter((item) => item.notificationId === log.notificationId)
    : [log];
  return {
    entry,
    message: notification ? {
      notificationId: notification.id,
      title: notification.title,
      body: notification.body,
      buttonText: notification.buttonText || null,
      buttonLink: notification.buttonLink || null,
      language: notification.language || "en",
      category: notification.category || null,
      createdAt: notification.createdAt,
      readAt: notification.readAt,
      withdrawnAt: notification.withdrawnAt || null,
    } : null,
    timeline: [...relatedLogs]
      .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt))
      .map((item) => ({ status: item.status, occurredAt: item.occurredAt, failureReason: item.failureReason || null })),
    isTest: log.isTest,
  };
}

/** Daily clean-up (design §7): drop records older than 180 days. */
export function purgeExpiredNotificationRecordsInData(data: ProductData, now = new Date()) {
  const cutoff = now.getTime() - RETENTION_DAYS * DAY_MS;
  const notificationsBefore = data.notifications.length;
  const logsBefore = (data.notificationLog || []).length;
  const deliveriesBefore = (data.notificationEmailDeliveries || []).length;
  data.notifications = data.notifications.filter((item) => Date.parse(item.createdAt) >= cutoff);
  data.notificationLog = (data.notificationLog || []).filter((item) => Date.parse(item.occurredAt) >= cutoff);
  const liveLogIds = new Set(data.notificationLog.map((item) => item.id));
  data.notificationEmailDeliveries = (data.notificationEmailDeliveries || []).filter((item) => liveLogIds.has(item.logId));
  return {
    notifications: notificationsBefore - data.notifications.length,
    logs: logsBefore - data.notificationLog.length,
    deliveries: deliveriesBefore - data.notificationEmailDeliveries.length,
  };
}

/* ------------------------------------------------------------------ *
 * Event map (design §4)
 * ------------------------------------------------------------------ */

export const FANOUT_EVENTS = new Set(["COURSE_NEW_LAUNCH"]);

export function templateIdForEvent(eventType: string): string | null {
  return isNotificationTemplateId(eventType) ? eventType : null;
}

export function categoryHourLabel(category: NotificationCategory) {
  return categoryLabel(category, "en");
}

export { RETENTION_DAYS };
