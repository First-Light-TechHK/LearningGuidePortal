import type { NotificationTemplate } from "./types";

/**
 * The fixed 13-template P0 catalogue (PRD §5, Figma B01–B06/F01–F02).
 *
 * English copy is the required default. Chinese copy is an initial draft from
 * the PRD/Figma examples and is marked for product replacement (template sheet
 * v0.3 is not published yet; design open question 1). Operators may clear any
 * Chinese field; a message falls back to English when the Chinese copy for the
 * channel is incomplete.
 */

const LINK = {
  subscription: "{{app_url}}/my-learning/subscription",
  ticket: "{{ticket_link}}",
  course: "{{course_link}}",
  session: "{{session_link}}",
};

function template(value: Omit<NotificationTemplate, "updatedAt" | "updatedBy">): NotificationTemplate {
  return { ...value, updatedAt: null, updatedBy: null };
}

/** Fixed BackOffice catalogue names (B01). Not user-facing copy and not stored; editing a title never renames a template. */
export const TEMPLATE_NAMES: Record<string, string> = {
  SUB_SUCCESS: "Subscription successful",
  SUB_RENEWAL_REMINDER: "Renewal reminder (D-5)",
  SUB_RENEWAL_FAILED: "Renewal payment failed",
  SUB_RENEWAL_SUCCESS: "Renewal successful",
  SUB_UPGRADE_SUCCESS: "Upgrade successful",
  SUB_AUTORENEW_CANCELLED: "Auto-renewal cancelled",
  SUB_EXPIRED: "Subscription expired",
  HELPDESK_TICKET_REPLIED: "Support ticket reply",
  COURSE_NEW_LAUNCH: "New course published",
  LIVE_SESSION_BOOKED: "Live Session booked",
  LIVE_SESSION_REMINDER: "Live Session reminder",
  LIVE_SESSION_CANCELLED: "Live Session cancelled",
  LIVE_SESSION_RESCHEDULED: "Live Session rescheduled",
};

export const NOTIFICATION_TEMPLATES: NotificationTemplate[] = [
  template({
    id: "SUB_SUCCESS",
    category: "subscription",
    channels: ["in_app"],
    locked: true,
    enabled: true,
    triggerText: "A new subscription to any plan is paid and activated, including an extra Course or Category. Not renewals or upgrades. Sent immediately.",
    recipientText: "The subscriber",
    sendsText: "Once per subscription order",
    buttonLink: LINK.subscription,
    en: {
      title: "Subscription successful",
      message: "Your {{plan_name}} subscription is now active until {{valid_to}}. {{ai_points}} AI points have been added to your account.",
      buttonText: "Start learning",
    },
    zh: {
      title: "订阅成功",
      message: "你的{{plan_name}}订阅已生效，有效期至{{valid_to}}。账户已增加 {{ai_points}} 个 AI 点数。",
      buttonText: "开始学习",
    },
  }),
  template({
    id: "SUB_RENEWAL_REMINDER",
    category: "subscription",
    channels: ["in_app", "email"],
    locked: true,
    enabled: true,
    triggerText: "5 days before the subscription end date, daily job at 10:00 HKT. Skipped if auto-renewal is off.",
    recipientText: "The subscriber",
    sendsText: "Once per billing period · skipped if auto-renewal is off",
    buttonLink: LINK.subscription,
    en: {
      title: "Your subscription renews soon",
      message: "Your {{plan_name}} subscription will renew automatically on {{renewal_date}} for {{renewal_amount}}. If you'd like to continue, there's nothing you need to do.",
      buttonText: "Manage subscription",
      subject: "Your subscription renews soon",
      emailBody: "Hi {{user_name}},\n\nYour {{plan_name}} subscription will renew automatically on {{renewal_date}} for {{renewal_amount}}. If you'd like to continue, there's nothing you need to do.\n\nYou can manage your subscription at any time.\n\nThe Learning Guide Team",
      emailButtonText: "Manage subscription",
    },
    zh: {
      title: "你的订阅即将续费",
      message: "你的{{plan_name}}订阅将于{{renewal_date}}自动续费 {{renewal_amount}}。如希望继续，你无需操作。",
      buttonText: "管理订阅",
      subject: "你的订阅即将续费",
      emailBody: "你好 {{user_name}}：\n\n你的{{plan_name}}订阅将于{{renewal_date}}自动续费 {{renewal_amount}}。如希望继续，你无需操作。\n\n你可以随时管理订阅。\n\nLearning Guide 团队",
      emailButtonText: "管理订阅",
    },
  }),
  template({
    id: "SUB_RENEWAL_FAILED",
    category: "subscription",
    channels: ["in_app", "email"],
    locked: true,
    enabled: true,
    triggerText: "Stripe confirms the renewal charge failed (first attempt only). Sent immediately.",
    recipientText: "The subscriber",
    sendsText: "Once per billing period · the retry does not send it again",
    buttonLink: LINK.subscription,
    en: {
      title: "Payment failed for your renewal",
      message: "We couldn't renew your {{plan_name}} subscription for {{renewal_amount}}. You can still access your courses until {{grace_end_date}}. Update your payment method to keep your access.",
      buttonText: "Update payment",
      subject: "Action needed: your renewal payment didn't go through",
      emailBody: "Hi {{user_name}},\n\nWe tried to renew your {{plan_name}} subscription, but the payment of {{renewal_amount}} didn't go through.\n\nYou can still access your courses until {{grace_end_date}}. To keep your access, please update your payment method or pay now.\n\nIf you have any questions, contact us through Help in My Learning.\n\nThe Learning Guide Team",
      emailButtonText: "Update payment",
    },
    zh: {
      title: "续费支付失败",
      message: "我们未能为你的{{plan_name}}订阅续费 {{renewal_amount}}。你仍可使用课程至{{grace_end_date}}。请更新支付方式以保留访问权限。",
      buttonText: "更新支付方式",
      subject: "需要处理：续费支付未成功",
      emailBody: "你好 {{user_name}}：\n\n我们尝试为你的{{plan_name}}订阅续费，但 {{renewal_amount}} 的支付未成功。\n\n你仍可使用课程至{{grace_end_date}}。如需保留访问权限，请更新支付方式或立即支付。\n\n如有疑问，请通过“我的学习”中的帮助联系我们。\n\nLearning Guide 团队",
      emailButtonText: "更新支付方式",
    },
  }),
  template({
    id: "SUB_RENEWAL_SUCCESS",
    category: "subscription",
    channels: ["in_app"],
    locked: true,
    enabled: true,
    triggerText: "The renewal charge succeeds, including a Stripe retry or a manual Pay now during the grace period. Sent immediately.",
    recipientText: "The subscriber",
    sendsText: "Once per billing period",
    buttonLink: LINK.subscription,
    en: {
      title: "Subscription renewed",
      message: "Your {{plan_name}} subscription renewed for {{renewal_amount}} and is now active until {{new_valid_to}}.",
      buttonText: "Manage subscription",
    },
    zh: {
      title: "订阅已续费",
      message: "你的{{plan_name}}订阅已续费 {{renewal_amount}}，有效期至{{new_valid_to}}。",
      buttonText: "管理订阅",
    },
  }),
  template({
    id: "SUB_UPGRADE_SUCCESS",
    category: "subscription",
    channels: ["in_app"],
    locked: true,
    enabled: true,
    triggerText: "An upgrade payment succeeds and the new access is applied, including US$0 upgrades. Sent immediately.",
    recipientText: "The subscriber",
    sendsText: "Once per upgrade order",
    buttonLink: LINK.subscription,
    en: {
      title: "Upgrade successful",
      message: "Your plan changed from {{old_scope_name}} to {{new_scope_name}}. You paid {{amount_paid}} and have access until {{new_valid_to}}. {{ai_points}} AI points have been added to your account.",
      buttonText: "Manage subscription",
    },
    zh: {
      title: "升级成功",
      message: "你的方案已从{{old_scope_name}}升级为{{new_scope_name}}。你支付了 {{amount_paid}}，可使用至{{new_valid_to}}。账户已增加 {{ai_points}} 个 AI 点数。",
      buttonText: "管理订阅",
    },
  }),
  template({
    id: "SUB_AUTORENEW_CANCELLED",
    category: "subscription",
    channels: ["in_app"],
    locked: true,
    enabled: true,
    triggerText: "The learner turns off auto-renewal in My Subscription. Sent immediately. Turning it back on sends nothing.",
    recipientText: "The subscriber",
    sendsText: "Once per cancel action",
    buttonLink: LINK.subscription,
    en: {
      title: "Subscription updated",
      message: "Your {{plan_name}} subscription will end on {{valid_to}} and won't renew automatically.",
      buttonText: "Manage subscription",
    },
    zh: {
      title: "订阅已更新",
      message: "你的{{plan_name}}订阅将于{{valid_to}}结束，不再自动续费。",
      buttonText: "管理订阅",
    },
  }),
  template({
    id: "SUB_EXPIRED",
    category: "subscription",
    channels: ["in_app"],
    locked: true,
    enabled: true,
    triggerText: "The period ends with auto-renewal off, or the grace period ends unpaid. Sent at expiry.",
    recipientText: "The subscriber",
    sendsText: "Once per subscription",
    buttonLink: LINK.subscription,
    en: {
      title: "Subscription expired",
      message: "Your {{plan_name}} subscription ended on {{expired_date}}. Renew to start learning again.",
      buttonText: "Manage subscription",
    },
    zh: {
      title: "订阅已到期",
      message: "你的{{plan_name}}订阅已于{{expired_date}}到期。续订后可继续学习。",
      buttonText: "管理订阅",
    },
  }),
  template({
    id: "HELPDESK_TICKET_REPLIED",
    category: "support",
    channels: ["in_app"],
    locked: false,
    enabled: true,
    triggerText: "A support agent posts a reply the learner can see. Internal notes don't count. Sent immediately.",
    recipientText: "The learner who raised the ticket",
    sendsText: "Once per reply; if an unread one for the same ticket exists, it is updated instead",
    buttonLink: LINK.ticket,
    en: {
      title: "New reply to your request",
      message: "Our support team has replied to your request \"{{ticket_subject}}\".",
      buttonText: "View reply",
    },
    zh: {
      title: "你的咨询有新回复",
      message: "客服已回复你的咨询“{{ticket_subject}}”。",
      buttonText: "查看回复",
    },
  }),
  template({
    id: "COURSE_NEW_LAUNCH",
    category: "course",
    channels: ["in_app"],
    locked: false,
    enabled: true,
    triggerText: "A course is published for the first time. Republishing doesn't count. Sent immediately.",
    recipientText: "Learners with an active subscription",
    sendsText: "Once per course",
    buttonLink: LINK.course,
    en: {
      title: "New course: {{course_title}}",
      message: "A new {{category_name}} course is now available. It's included in your subscription, so you can start whenever you're ready.",
      buttonText: "View course",
    },
    zh: {
      title: "新课程：{{course_title}}",
      message: "新的{{category_name}}课程已上线，已包含在你的订阅中，随时可以开始学习。",
      buttonText: "查看课程",
    },
  }),
  template({
    id: "LIVE_SESSION_BOOKED",
    category: "study_group",
    channels: ["in_app"],
    locked: false,
    enabled: true,
    triggerText: "A learner books a Live Session. Sent immediately.",
    recipientText: "That learner",
    sendsText: "Once per learner per session; booking again after cancelling sends it again",
    buttonLink: LINK.session,
    en: {
      title: "Booked: {{session_title}}",
      message: "You've booked {{session_title}} in {{group_name}}. It starts on {{session_date}} at {{session_time}}.",
      buttonText: "View session",
    },
    zh: {
      title: "已预约：{{session_title}}",
      message: "你已预约{{group_name}}的{{session_title}}，开始时间为{{session_date}} {{session_time}}。",
      buttonText: "查看直播课",
    },
  }),
  template({
    id: "LIVE_SESSION_REMINDER",
    category: "study_group",
    channels: ["in_app", "email"],
    locked: false,
    enabled: true,
    triggerText: "10 minutes before the start time. Moves if rescheduled; dropped if cancelled; not sent to learners who book within the last 10 minutes.",
    recipientText: "Booked learners",
    sendsText: "Once per learner per session",
    buttonLink: LINK.session,
    en: {
      title: "Starting in 10 minutes: {{session_title}}",
      message: "{{session_title}} in {{group_name}} starts at {{session_time}} on {{session_date}}. Join now to get settled in.",
      buttonText: "Join now",
      subject: "Starting in 10 minutes: {{session_title}}",
      emailBody: "Hi {{user_name}},\n\n{{session_title}} in {{group_name}} starts at {{session_time}} on {{session_date}}. Join from My Learning.\n\nThe Learning Guide Team",
      emailButtonText: "Join now",
    },
    zh: {
      title: "10 分钟后开始：{{session_title}}",
      message: "{{group_name}}的{{session_title}}将于{{session_date}} {{session_time}}开始。立即加入，做好准备。",
      buttonText: "立即加入",
      subject: "10 分钟后开始：{{session_title}}",
      emailBody: "你好 {{user_name}}：\n\n{{group_name}}的{{session_title}}将于{{session_date}} {{session_time}}开始。请从“我的学习”加入。\n\nLearning Guide 团队",
      emailButtonText: "立即加入",
    },
  }),
  template({
    id: "LIVE_SESSION_CANCELLED",
    category: "study_group",
    channels: ["in_app"],
    locked: false,
    enabled: true,
    triggerText: "The host cancels before the start time. Sent immediately.",
    recipientText: "Booked learners, not the host",
    sendsText: "Once per session",
    buttonLink: LINK.session,
    en: {
      title: "Live Session cancelled: {{session_title}}",
      message: "{{session_title}} in {{group_name}} on {{session_date}} at {{session_time}} has been cancelled.",
      buttonText: "View session",
    },
    zh: {
      title: "直播课已取消：{{session_title}}",
      message: "{{group_name}}的{{session_title}}（{{session_date}} {{session_time}}）已取消。",
      buttonText: "查看直播课",
    },
  }),
  template({
    id: "LIVE_SESSION_RESCHEDULED",
    category: "study_group",
    channels: ["in_app"],
    locked: false,
    enabled: false,
    triggerText: "The host changes the start time. Sent immediately.",
    recipientText: "Booked learners, not the host",
    sendsText: "Once per time change",
    buttonLink: LINK.session,
    en: {
      title: "Live Session rescheduled: {{session_title}}",
      message: "{{session_title}} in {{group_name}} has moved to {{session_date}} at {{session_time}}.",
      buttonText: "View session",
    },
    zh: {
      title: "直播课时间已更改：{{session_title}}",
      message: "{{group_name}}的{{session_title}}已改至{{session_date}} {{session_time}}。",
      buttonText: "查看直播课",
    },
  }),
];

export const TEMPLATE_IDS = NOTIFICATION_TEMPLATES.map((item) => item.id);

export const TEMPLATE_CATEGORY_ORDER: Array<NotificationTemplate["category"]> = ["subscription", "support", "course", "study_group"];

/**
 * Variable dictionary (PRD §13.2). Each template may only use these variables.
 * Link variables are system-set (operator never sees the ids behind them).
 */
const VARIABLES: Record<string, string[]> = {
  SUB_SUCCESS: ["plan_name", "scope_name", "valid_to", "ai_points"],
  SUB_RENEWAL_REMINDER: ["plan_name", "scope_name", "renewal_date", "renewal_amount", "user_name"],
  SUB_RENEWAL_FAILED: ["user_name", "plan_name", "scope_name", "renewal_amount", "grace_end_date"],
  SUB_RENEWAL_SUCCESS: ["plan_name", "new_valid_to", "renewal_amount", "ai_points"],
  SUB_UPGRADE_SUCCESS: ["old_scope_name", "new_scope_name", "amount_paid", "new_valid_to", "renewal_amount", "ai_points"],
  SUB_AUTORENEW_CANCELLED: ["plan_name", "valid_to"],
  SUB_EXPIRED: ["plan_name", "expired_date"],
  HELPDESK_TICKET_REPLIED: ["ticket_subject", "ticket_link"],
  COURSE_NEW_LAUNCH: ["course_title", "category_name", "course_link"],
  LIVE_SESSION_BOOKED: ["session_title", "group_name", "session_date", "session_time", "session_link"],
  LIVE_SESSION_REMINDER: ["session_title", "group_name", "session_date", "session_time", "session_link", "user_name"],
  LIVE_SESSION_CANCELLED: ["session_title", "group_name", "session_date", "session_time", "session_link"],
  LIVE_SESSION_RESCHEDULED: ["session_title", "group_name", "session_date", "session_time", "session_link"],
};

/** System link variables, allowed only in a template's button link. */
export const SYSTEM_LINK_VARIABLES = ["app_url", "ticket_link", "course_link", "session_link"] as const;

/** Variables whose values get HKT/amount/points presentation at render time. */
export const DATE_VARIABLES = new Set(["valid_to", "new_valid_to", "renewal_date", "grace_end_date", "expired_date", "session_date"]);
export const AMOUNT_VARIABLES = new Set(["renewal_amount", "amount_paid"]);
export const TIME_VARIABLES = new Set(["session_time"]);

export function templateVariables(templateId: string): string[] {
  const variables = VARIABLES[templateId];
  if (!variables) throw new Error(`Unknown notification template: ${templateId}`);
  return variables;
}

export function notificationTemplate(templateId: string): NotificationTemplate {
  const template = NOTIFICATION_TEMPLATES.find((item) => item.id === templateId);
  if (!template) throw new Error(`Unknown notification template: ${templateId}`);
  return template;
}

export function isNotificationTemplateId(value: unknown): value is string {
  return typeof value === "string" && TEMPLATE_IDS.includes(value);
}

/**
 * Sample values for preview and "Send test to me" (PRD NTF-BO-018/019 and the
 * §13.2 examples). Amounts are minor units; dates are ISO instants so the HKT
 * formatter produces the PRD wording.
 */
const SAMPLE_PARAMS: Record<string, Record<string, unknown>> = {
  SUB_SUCCESS: { plan_name: "Everything · 12 months", scope_name: "Everything", valid_to: "2026-11-16T10:00:00.000Z", ai_points: 10000 },
  SUB_RENEWAL_REMINDER: { plan_name: "Everything · 12 months", scope_name: "Everything", renewal_date: "2026-11-16T10:00:00.000Z", renewal_amount: 14900, user_name: "Margaret" },
  SUB_RENEWAL_FAILED: { user_name: "Margaret", plan_name: "Everything · 12 months", scope_name: "Everything", renewal_amount: 14900, grace_end_date: "2026-11-19T10:00:00.000Z" },
  SUB_RENEWAL_SUCCESS: { plan_name: "Everything · 12 months", new_valid_to: "2027-11-16T10:00:00.000Z", renewal_amount: 14900, ai_points: 10000 },
  SUB_UPGRADE_SUCCESS: { old_scope_name: "History", new_scope_name: "Everything", amount_paid: 6000, new_valid_to: "2027-11-16T10:00:00.000Z", renewal_amount: 14900, ai_points: 10000 },
  SUB_AUTORENEW_CANCELLED: { plan_name: "Everything · 12 months", valid_to: "2026-11-16T10:00:00.000Z" },
  SUB_EXPIRED: { plan_name: "Everything · 12 months", expired_date: "2026-11-19T10:00:00.000Z" },
  HELPDESK_TICKET_REPLIED: { ticket_subject: "Can't play the video in Lesson 3", ticket_link: "/my-learning/support/1" },
  COURSE_NEW_LAUNCH: { course_title: "The Renaissance in Florence", category_name: "Art & Humanities", course_link: "/courses/renaissance" },
  LIVE_SESSION_BOOKED: { session_title: "Reading Plato's Republic", group_name: "Philosophy Circle", session_date: "2026-11-12T10:00:00.000Z", session_time: "2026-11-12T11:00:00.000Z", session_link: "/portal/study-groups/sessions/1" },
  LIVE_SESSION_REMINDER: { session_title: "Reading Plato's Republic", group_name: "Philosophy Circle", session_date: "2026-11-12T10:00:00.000Z", session_time: "2026-11-12T11:00:00.000Z", session_link: "/portal/study-groups/sessions/1", user_name: "Margaret" },
  LIVE_SESSION_CANCELLED: { session_title: "Reading Plato's Republic", group_name: "Philosophy Circle", session_date: "2026-11-12T10:00:00.000Z", session_time: "2026-11-12T11:00:00.000Z", session_link: "/portal/study-groups/sessions/1" },
  LIVE_SESSION_RESCHEDULED: { session_title: "Reading Plato's Republic", group_name: "Philosophy Circle", session_date: "2026-11-12T10:00:00.000Z", session_time: "2026-11-12T11:00:00.000Z", session_link: "/portal/study-groups/sessions/1" },
};

export function sampleTemplateParams(templateId: string): Record<string, unknown> {
  const sample = SAMPLE_PARAMS[templateId];
  if (!sample) throw new Error(`Unknown notification template: ${templateId}`);
  return { ...sample, app_url: "https://learningguide.test" };
}

/** A fresh clone for seeding, so a caller cannot mutate the catalogue. */
export function templateSeedRows(): NotificationTemplate[] {
  return NOTIFICATION_TEMPLATES.map((item) => structuredClone(item));
}
