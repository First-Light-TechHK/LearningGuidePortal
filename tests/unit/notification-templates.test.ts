import assert from "node:assert/strict";
import { test } from "node:test";
import { NOTIFICATION_TEMPLATES, TEMPLATE_IDS, templateVariables } from "../../services/notifications/templates";

const subscriptionIds = [
  "SUB_SUCCESS",
  "SUB_RENEWAL_REMINDER",
  "SUB_RENEWAL_FAILED",
  "SUB_RENEWAL_SUCCESS",
  "SUB_UPGRADE_SUCCESS",
  "SUB_AUTORENEW_CANCELLED",
  "SUB_EXPIRED",
];

test("notification catalogue is fixed at the 13 P0 templates, grouped 7/1/1/4", () => {
  assert.equal(NOTIFICATION_TEMPLATES.length, 13);
  assert.equal(new Set(TEMPLATE_IDS).size, 13);
  const counts = NOTIFICATION_TEMPLATES.reduce<Record<string, number>>((total, item) => {
    total[item.category] = (total[item.category] || 0) + 1;
    return total;
  }, {});
  assert.deepEqual(counts, { subscription: 7, support: 1, course: 1, study_group: 4 });
});

test("subscription templates are locked on; only the three P0 emails carry email", () => {
  for (const id of subscriptionIds) {
    const template = NOTIFICATION_TEMPLATES.find((item) => item.id === id);
    assert.ok(template, id);
    assert.equal(template.locked, true, id);
    assert.equal(template.enabled, true, id);
    assert.equal(template.channels.includes("in_app"), true, id);
  }
  const emailTemplates = NOTIFICATION_TEMPLATES.filter((item) => item.channels.includes("email")).map((item) => item.id);
  assert.deepEqual(emailTemplates.sort(), ["LIVE_SESSION_REMINDER", "SUB_RENEWAL_FAILED", "SUB_RENEWAL_REMINDER"].sort());
  for (const template of NOTIFICATION_TEMPLATES) {
    assert.ok(template.en.title?.trim(), `${template.id} has an English title`);
    assert.ok(template.en.message?.trim(), `${template.id} has an English message`);
    assert.ok(template.triggerText.trim(), `${template.id} has trigger text`);
    assert.ok(template.recipientText.trim(), `${template.id} has recipient text`);
    assert.ok(template.sendsText.trim(), `${template.id} has sends text`);
  }
});

test("each template exposes only the variables the PRD allows it to use", () => {
  const failed = templateVariables("SUB_RENEWAL_FAILED");
  assert.equal(failed.includes("renewal_amount"), true);
  assert.equal(failed.includes("amount_due"), false);
  assert.equal(failed.includes("grace_end_date"), true);
  const reminder = templateVariables("SUB_RENEWAL_REMINDER");
  assert.deepEqual([...reminder].sort(), ["plan_name", "renewal_amount", "renewal_date", "scope_name", "user_name"]);
  assert.throws(() => templateVariables("NOT_A_TEMPLATE"));
});
