/**
 * Notification P0 domain types (Portal owns the notification domain).
 *
 * Source of truth: LG_Notification_PRD_v1 §5/§9/§13 and
 * verify-takeover-20261116/notification-p0-design.md §2.
 */

/** System-notification categories. Broadcasts use "announcement" (PRD §9.2). */
export type NotificationCategory = "subscription" | "support" | "course" | "study_group" | "announcement";

/** The two P0 channels. Broadcasts are in-app only. */
export type NotificationChannel = "in_app" | "email";

/** Languages are stored as the two P0 template languages; Profile locales are mapped at the boundary. */
export type NotificationLanguage = "en" | "zh";

export type NotificationCopy = {
  title?: string;
  message?: string;
  buttonText?: string;
  subject?: string;
  emailBody?: string;
  emailButtonText?: string;
};

/** Operator audit trail for every integration write (PRD §11.3, design §5). */
export type NotificationAuditEntry = {
  action: string;
  operator: string;
  at: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
};

/** Last-write metadata carried on mutable notification records. */
export type NotificationWriteMetadata = {
  lastOperator?: string;
  lastAction?: string;
  lastUpdatedAt?: string;
  [key: string]: unknown;
};

/** One of the 13 fixed system-notification templates (PRD §5). */
export type NotificationTemplate = {
  id: string;
  /** read-only, from the code catalogue */
  name?: string;
  category: Exclude<NotificationCategory, "announcement">;
  channels: NotificationChannel[];
  /** Subscription templates are always on and cannot be disabled in the BackOffice. */
  locked: boolean;
  enabled: boolean;
  /** Read-only operator copy: what triggers the message. */
  triggerText: string;
  /** Read-only operator copy: who receives it. */
  recipientText: string;
  /** Read-only operator copy: once-per rule. */
  sendsText: string;
  /** System-set link; may contain {{app_url}} and a *system* link variable. */
  buttonLink: string;
  en: NotificationCopy;
  /** Draft Chinese copy; an empty field falls back to English at send time. */
  zh: NotificationCopy;
  updatedAt: string | null;
  updatedBy: string | null;
  metadata?: NotificationWriteMetadata;
  /** Append-only operator audit trail (PRD §11.3). */
  audit?: NotificationAuditEntry[];
};

export type NotificationBroadcast = {
  id: string;
  titleEn: string;
  bodyEn: string;
  titleZh?: string | null;
  bodyZh?: string | null;
  buttonText?: string | null;
  buttonLink?: string | null;
  audience: "all" | "paid";
  status: "draft" | "sent" | "withdrawn";
  createdBy: string;
  createdAt: string;
  sentAt: string | null;
  withdrawnAt: string | null;
  withdrawnBy: string | null;
  /** PRD 7: a draft can be deleted; the row stays as an audited tombstone. */
  deletedAt?: string | null;
  deletedBy?: string | null;
  metadata?: NotificationWriteMetadata;
  audit?: NotificationAuditEntry[];
};

export type NotificationLogStatus = "delivered" | "read" | "withdrawn" | "sent" | "failed";

export type NotificationLogEntry = {
  id: string;
  notificationId: string | null;
  userId: string;
  templateId?: string | null;
  broadcastId?: string | null;
  channel: NotificationChannel;
  status: NotificationLogStatus;
  failureReason?: string | null;
  occurredAt: string;
  isTest: boolean;
  /** Subscription, session, ticket or course reference (PRD §8 NTF-LOG-005). */
  related?: string | null;
  /** Present on failed-before-creation rows so a duplicate event can be traced. */
  eventKey?: string | null;
  /** Test sends to an operator address that has no learner account. */
  recipientEmail?: string | null;
  recipientName?: string | null;
};

export type NotificationEmailDelivery = {
  id: string;
  logId: string;
  providerMessageId: string | null;
  status: "sent" | "delivered" | "failed";
  updatedAt: string;
};

/** The learner-facing projection returned by GET /api/my-learning/notifications. */
export type LearnerNotificationItem = {
  id: string;
  category: NotificationCategory;
  categoryLabel: string;
  templateId: string | null;
  broadcastId: string | null;
  title: string;
  body: string;
  buttonText: string | null;
  buttonLink: string | null;
  language: NotificationLanguage;
  read: boolean;
  unread: boolean;
  isTest: boolean;
  readAt: string | null;
  createdAt: string;
  displayTime: string;
};
