import assert from "node:assert/strict";
import { test } from "node:test";
import { localiseLink, MissingNotificationDataError, renderTemplate, validateTemplateCopy, type TemplateCopy } from "../../services/notifications/render";
import { formatAmount, formatHktDate, formatHktDateTimeHkt, formatRelativeTime } from "../../services/notifications/format";
import { notificationTemplate, NOTIFICATION_TEMPLATES } from "../../services/notifications/templates";

test("HKT date, time and amount follow the PRD presentation rules", () => {
  assert.equal(formatHktDate("2026-11-16T10:00:00.000Z", "en"), "16 Nov 2026");
  assert.equal(formatHktDate("2026-11-16T10:00:00.000Z", "zh"), "2026年11月16日");
  assert.equal(formatHktDateTimeHkt("2026-11-12T11:00:00.000Z", "en"), "7:00 PM (HKT)");
  assert.equal(formatHktDateTimeHkt("2026-11-12T11:00:00.000Z", "zh"), "19:00 (HKT)");
  assert.equal(formatAmount(14900, "en"), "US$149.00");
  assert.equal(formatAmount(14900, "zh"), "US$149.00");
  assert.equal(formatAmount(123456, "en"), "US$1,234.56");
  assert.equal(formatAmount("US$99.00", "en"), "US$99.00");
});

test("relative times: hours ago, Yesterday, then a date", () => {
  const now = "2026-11-03T12:00:00.000Z";
  assert.equal(formatRelativeTime("2026-11-03T10:00:00.000Z", now, "en"), "2 hours ago");
  assert.equal(formatRelativeTime("2026-11-02T10:50:00.000Z", now, "en"), "Yesterday, 6:50 PM");
  assert.equal(formatRelativeTime("2026-10-30T04:00:00.000Z", now, "en"), "30 Oct 2026");
  assert.equal(formatRelativeTime("2026-11-03T11:59:30.000Z", now, "en"), "Just now");
});

test("renders English, formats variables, and falls back to English when Chinese is empty", () => {
  const reminder = { ...notificationTemplate("SUB_RENEWAL_REMINDER"), zh: {} };
  const rendered = renderTemplate(reminder, {
    locale: "zh-CN",
    channel: "in_app",
    params: { plan_name: "Everything · 12 months", renewal_date: "2026-11-16T10:00:00.000Z", renewal_amount: 14900 },
  });
  assert.equal(rendered.language, "en");
  assert.match(rendered.title, /renews soon/);
  assert.match(rendered.body, /Everything · 12 months/);
  assert.match(rendered.body, /16 Nov 2026/);
  assert.match(rendered.body, /US\$149\.00/);
  assert.equal(rendered.link, "/zh-CN/my-learning/subscription");
});

test("REV-06: every button link carries the recipient's locale", () => {
  const expired = notificationTemplate("SUB_EXPIRED");
  const params = { plan_name: "Everything · 12 months", expired_date: "2026-11-19T10:00:00.000Z" };
  assert.equal(renderTemplate(expired, { locale: "en-GB", channel: "in_app", params }).link, "/en-GB/my-learning/subscription");
  assert.equal(renderTemplate(expired, { locale: "zh-CN", channel: "in_app", params }).link, "/zh-CN/my-learning/subscription");
  const email = renderTemplate(expired, { locale: "zh-CN", channel: "email", params: { ...params, app_url: "https://app.example.test" } });
  assert.equal(email.link, "https://app.example.test/zh-CN/my-learning/subscription");

  const ticket = notificationTemplate("HELPDESK_TICKET_REPLIED");
  const reply = renderTemplate(ticket, { locale: "zh-CN", channel: "in_app", params: { ticket_subject: "Help", ticket_link: "/en-GB/account/my-learning/support/T1" } });
  assert.equal(reply.link, "/zh-CN/account/my-learning/support/T1");
  const other = renderTemplate(ticket, { locale: "zh-CN", channel: "in_app", params: { ticket_subject: "Help", ticket_link: "https://example.org/x" } });
  assert.equal(other.link, "https://example.org/x");
});

test("localiseLink handles paths, queries, the app origin and lookalikes", () => {
  assert.equal(localiseLink(null, "zh-CN"), null);
  assert.equal(localiseLink("", "zh-CN"), null);
  assert.equal(localiseLink("/portal/courses?x=1#top", "ZH"), "/zh-CN/portal/courses?x=1#top");
  assert.equal(localiseLink("/zh-CN/portal", "en-GB"), "/en-GB/portal");
  assert.equal(localiseLink("/", "en-GB"), "/en-GB");
  assert.equal(localiseLink("https://app.test/portal", "zh-CN", "https://app.test/"), "https://app.test/zh-CN/portal");
  assert.equal(localiseLink("https://app.test.evil.example/portal", "zh-CN", "https://app.test"), "https://app.test.evil.example/portal");
  assert.equal(localiseLink("//evil.example/x", "zh-CN"), "//evil.example/x");
});

test("uses the Chinese copy when every required Chinese field is filled", () => {
  const template = {
    ...notificationTemplate("SUB_RENEWAL_REMINDER"),
    zh: { title: "你的订阅即将续费", message: "你的 {{plan_name}} 订阅将于 {{renewal_date}} 续费 {{renewal_amount}}。", buttonText: "管理订阅" },
  };
  const rendered = renderTemplate(template, {
    locale: "zh-CN",
    channel: "in_app",
    params: { plan_name: "Everything · 12 months", renewal_date: "2026-11-16T10:00:00.000Z", renewal_amount: 14900 },
  });
  assert.equal(rendered.language, "zh");
  assert.match(rendered.body, /2026年11月16日/);
  assert.match(rendered.body, /US\$149\.00/);
});

test("missing variable data blocks the send and names the field", () => {
  const template = notificationTemplate("SUB_RENEWAL_FAILED");
  assert.throws(() => renderTemplate(template, {
    locale: "en-GB",
    channel: "in_app",
    params: { plan_name: "Everything · 12 months", grace_end_date: "2026-11-19T10:00:00.000Z" },
  }), (error: unknown) => {
    assert.equal(error instanceof MissingNotificationDataError, true);
    assert.deepEqual((error as MissingNotificationDataError).variables, ["renewal_amount"]);
    return true;
  });
});

test("operator copy validation blocks unknown variables and suggests the right one", () => {
  const copy: TemplateCopy = { title: "Renewal", message: "Pay {{amount_due}} by {{grace_end_date}}.", buttonText: "Update" };
  const errors = validateTemplateCopy("SUB_RENEWAL_FAILED", "in_app", copy);
  assert.equal(errors.some((error) => error.code === "unknown_variable" && error.variable === "amount_due" && error.suggestion === "renewal_amount"), true);
  const tooLong = validateTemplateCopy("SUB_RENEWAL_FAILED", "in_app", { ...copy, title: "x".repeat(61), message: "Pay {{renewal_amount}}." }, { requireChinese: false });
  assert.equal(tooLong.some((error) => error.code === "too_long" && error.field === "title"), true);
});

test("all shipped defaults can render with a realistic parameter set", () => {
  const params = {
    user_name: "Margaret", plan_name: "Everything · 12 months", scope_name: "European History",
    old_scope_name: "History", new_scope_name: "Everything", valid_to: "2026-11-16T10:00:00.000Z",
    new_valid_to: "2027-11-16T10:00:00.000Z", renewal_date: "2026-11-16T10:00:00.000Z",
    renewal_amount: 14900, amount_paid: 6000, grace_end_date: "2026-11-19T10:00:00.000Z",
    expired_date: "2026-11-19T10:00:00.000Z", ai_points: 10000, ticket_subject: "Can't play the video",
    course_title: "The Renaissance in Florence", category_name: "Art & Humanities",
    session_title: "Reading Plato's Republic", group_name: "Philosophy Circle",
    session_date: "2026-11-12T10:00:00.000Z", session_time: "2026-11-12T11:00:00.000Z",
    ticket_link: "/my-learning/support/1", course_link: "/courses/1", session_link: "/portal/study-groups/sessions/1",
  };
  for (const template of NOTIFICATION_TEMPLATES) {
    for (const channel of template.channels) {
      for (const locale of ["en-GB", "zh-CN"] as const) {
        const rendered = renderTemplate(template, { locale, channel, params });
        assert.ok(rendered.title, `${template.id}/${channel}/${locale} title`);
        assert.ok(rendered.body, `${template.id}/${channel}/${locale} body`);
      }
    }
  }
});
