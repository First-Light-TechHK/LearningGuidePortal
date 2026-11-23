import { randomUUID } from "node:crypto";
import { editProductData, readProductData } from "../productStore";
import { appendNotificationLogInData } from "./core";
import type { ProductNotification } from "../productStore";
import type { NotificationLogEntry } from "./types";

/**
 * Email delivery logging (design §6/§2).
 *
 * SMTP gives us Sent or Failed only. Delivered is reserved for a future
 * provider receipt; nothing here may claim it. One email log row per message
 * (the unique event key already guarantees one message), plus its
 * notification_email_deliveries row carrying the provider message id.
 */

export type EmailDeliveryStatus = "sent" | "failed";

export type EmailDeliveryInput = {
  userId: string;
  notificationId?: string | null;
  templateId: string | null;
  status: EmailDeliveryStatus;
  failureReason?: string | null;
  occurredAt: string;
  related?: string | null;
  recipientEmail?: string | null;
  recipientName?: string | null;
  providerMessageId?: string | null;
  isTest?: boolean;
};

export type EmailDeliveryRecord = {
  logId: string;
  created: boolean;
  deduplicated: boolean;
};

function appendDeliveryInData(
  data: Parameters<typeof appendNotificationLogInData>[0],
  entry: Omit<NotificationLogEntry, "id">,
  providerMessageId: string | null,
): NotificationLogEntry {
  const log = appendNotificationLogInData(data, entry);
  data.notificationEmailDeliveries ||= [];
  data.notificationEmailDeliveries.push({
    id: `email_delivery_${randomUUID()}`,
    logId: log.id,
    providerMessageId: providerMessageId || null,
    status: entry.status === "sent" ? "sent" : "failed",
    updatedAt: entry.occurredAt,
  });
  return log;
}

/** Record one email result. A message is logged once; a replay returns the first row. */
export async function recordEmailDelivery(input: EmailDeliveryInput): Promise<EmailDeliveryRecord> {
  return editProductData((data) => {
    if (input.notificationId) {
      const existing = (data.notificationLog || []).find(
        (entry) => entry.notificationId === input.notificationId && entry.channel === "email",
      );
      if (existing) return { logId: existing.id, created: false, deduplicated: true };
    }
    const log = appendDeliveryInData(data, {
      notificationId: input.notificationId || null,
      userId: input.userId,
      templateId: input.templateId,
      broadcastId: null,
      channel: "email",
      status: input.status,
      failureReason: input.failureReason || null,
      occurredAt: input.occurredAt,
      isTest: Boolean(input.isTest),
      related: input.related || null,
      recipientEmail: input.recipientEmail || null,
      recipientName: input.recipientName || null,
    }, input.providerMessageId || null);
    return { logId: log.id, created: true, deduplicated: false };
  });
}

const REMINDER_TITLES = new Set(["Live Session reminder", "直播课提醒"]);
const REMINDER_MATCH_WINDOW_MS = 15 * 60_000;

export function isLiveSessionReminderTitle(value: string): boolean {
  return REMINDER_TITLES.has(value.trim());
}

export type StudyGroupReminderEmailInput = {
  to: string;
  subject: string;
  status: EmailDeliveryStatus;
  failureReason?: string | null;
  providerMessageId?: string | null;
  occurredAt?: string;
  /** The Live Session id from the dispatch link, so two overlapping sessions log separately. */
  sessionId?: string | null;
};

/**
 * The existing Study Group T-10 dispatch (modules/group-study) owns the send
 * call; it cannot pass a notification id. Resolve the notification row it just
 * wrote for this recipient (same title, inside the reminder window) and log the
 * email result against it. Non-reminder subjects (a reschedule notice) are not
 * part of this email channel and return null.
 */
export async function recordStudyGroupReminderEmail(input: StudyGroupReminderEmailInput): Promise<EmailDeliveryRecord | null> {
  if (!isLiveSessionReminderTitle(input.subject)) return null;
  const to = input.to.trim().toLowerCase();
  // A recipient with no Portal account has no learner send-log row to attach
  // to; a read-only lookup keeps that case from writing anything.
  const snapshot = await readProductData();
  const recipient = snapshot.users.find((item) => (item.email || "").trim().toLowerCase() === to);
  if (!recipient) return null;
  const occurredAt = input.occurredAt || new Date().toISOString();
  const sessionId = (input.sessionId || "").trim();
  return editProductData((data) => {
    const user = data.users.find((item) => item.id === recipient.id);
    if (!user) return null;
    const notification = [...data.notifications]
      .filter((item: ProductNotification) =>
        item.userId === user.id
        && item.templateId === "LIVE_SESSION_REMINDER"
        && !item.isTest
        && (!sessionId || item.sessionId === sessionId)
        && (!input.subject || isLiveSessionReminderTitle(item.title))
        && Math.abs(Date.parse(item.createdAt) - Date.parse(occurredAt)) <= REMINDER_MATCH_WINDOW_MS)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
    if (notification) {
      const existing = (data.notificationLog || []).find((entry) => entry.notificationId === notification.id && entry.channel === "email");
      if (existing) return { logId: existing.id, created: false, deduplicated: true };
    }
    const log = appendDeliveryInData(data, {
      notificationId: notification?.id || null,
      userId: user.id,
      templateId: "LIVE_SESSION_REMINDER",
      broadcastId: null,
      channel: "email",
      status: input.status,
      failureReason: input.failureReason || null,
      occurredAt,
      isTest: false,
      related: notification?.sessionId || sessionId || null,
      recipientEmail: user.email || input.to,
      recipientName: user.nickname || null,
    }, input.providerMessageId || null);
    return { logId: log.id, created: true, deduplicated: false };
  });
}

/** Does this notification already have an email log row (any result)? */
export function hasEmailLogInData(data: { notificationLog?: NotificationLogEntry[] }, notificationId: string): boolean {
  return (data.notificationLog || []).some((entry) => entry.notificationId === notificationId && entry.channel === "email");
}

/**
 * Reserved provider-receipt interface (design §6). SMTP cannot call this;
 * a future provider webhook may, with the provider's message id and delivery
 * time. It appends a Delivered status to the email log timeline and marks the
 * delivery row delivered. Nothing in the SMTP path calls it, so a successful
 * SMTP send stays Sent until a receipt actually arrives.
 */
export async function recordEmailDeliveryReceipt(input: {
  logId: string;
  deliveredAt?: string;
  providerMessageId?: string | null;
}): Promise<{ ok: boolean; logId?: string }> {
  return editProductData((data) => {
    const delivery = (data.notificationEmailDeliveries || []).find((item) => item.logId === input.logId);
    const original = (data.notificationLog || []).find((item) => item.id === input.logId && item.channel === "email");
    if (!delivery || !original) return { ok: false };
    const occurredAt = input.deliveredAt || new Date().toISOString();
    delivery.status = "delivered";
    delivery.providerMessageId = input.providerMessageId || delivery.providerMessageId || null;
    delivery.updatedAt = occurredAt;
    const log = appendNotificationLogInData(data, {
      notificationId: original.notificationId,
      userId: original.userId,
      templateId: original.templateId,
      broadcastId: original.broadcastId,
      channel: "email",
      status: "delivered",
      failureReason: null,
      occurredAt,
      isTest: original.isTest,
      related: original.related,
      eventKey: original.eventKey,
      recipientEmail: original.recipientEmail,
      recipientName: original.recipientName,
    });
    return { ok: true, logId: log.id };
  });
}
