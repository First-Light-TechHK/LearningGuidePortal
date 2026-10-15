import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { notificationDateLabel } from "../../components/portal/NotificationList";

// F-4 (dev audit 2026-10-14): the notification row rendered
// new Date(item.createdAt).toLocaleString() with no locale argument, so the
// timestamp followed the browser locale - the same defect hunt L6 fixed in the
// Live Session room chat. The component has no render point yet (the
// notification centre page is a placeholder), so the fix ships as plumbing: the
// application locale arrives as an explicit prop, matching how every other
// portal component receives its Locale.

test("notification timestamps render in the application locale with 24-hour time", () => {
  const at = "2026-10-14T14:05:00Z";
  const expected = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(at));
  const en = notificationDateLabel("en-GB", at);
  assert.equal(en, expected);
  assert.match(en, /2026/);
  assert.match(en, /\d{2}:\d{2}/);
  assert.doesNotMatch(en, /[ap]\.?m\.?/i);
  const zh = notificationDateLabel("zh-CN", at);
  assert.match(zh, /2026/);
  assert.match(zh, /\d{2}:\d{2}/);
  assert.doesNotMatch(zh, /上午|下午/);
  // An unparseable stamp echoes back unchanged instead of throwing (the chatLabel contract).
  assert.equal(notificationDateLabel("en-GB", "not-a-date"), "not-a-date");
});

test("the row timestamp takes the locale prop instead of the browser default", () => {
  const source = readFileSync(new URL("../../components/portal/NotificationList.tsx", import.meta.url), "utf8");
  assert.match(source, /locale: Locale/);
  assert.match(source, /notificationDateLabel\(locale, item\.createdAt\)/);
  assert.equal(source.includes("toLocaleString("), false);
});
