import assert from "node:assert/strict";
import { test, before } from "node:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { build } from "esbuild";
import { getMessages } from "../../lib/i18n/messages";
import type { LearnerNotificationItem } from "../../services/notifications/types";

// The Notification Center list (F02) rendered on the server, in both locales.
// Replaces the removed notification-list timestamp test: times now come from the API.

let NotificationList: (props: { locale: "en-GB" | "zh-CN"; initial: unknown; copy: unknown }) => unknown;

before(async () => {
  const bundle = await build({
    entryPoints: ["components/portal/NotificationList.tsx"], bundle: true, write: false, platform: "node", format: "cjs", jsx: "automatic",
    external: ["react", "react/jsx-runtime"], loader: { ".css": "local-css" }, outdir: "out",
  });
  const dir = path.resolve("test-results/notification-center-ui"); await mkdir(dir, { recursive: true });
  const file = path.join(dir, "list.cjs");
  await writeFile(file, bundle.outputFiles.find((item) => item.path.endsWith(".js"))!.text);
  NotificationList = createRequire(import.meta.url)(file).NotificationList;
});

function item(overrides: Partial<LearnerNotificationItem> & { id: string }): LearnerNotificationItem {
  return {
    category: "subscription", categoryLabel: "Subscription", templateId: "SUB_SUCCESS", broadcastId: null, title: "Subscription active", body: "Your plan is active.",
    buttonText: null, buttonLink: null, language: "en", read: false, unread: true, isTest: false, readAt: null, createdAt: "2026-11-20T10:00:00.000Z", displayTime: "2 hours ago",
    ...overrides,
  };
}

function render(locale: "en-GB" | "zh-CN", items: LearnerNotificationItem[], extra: { unreadCount?: number; total?: number; nextCursor?: string | null } = {}) {
  const initial = { items, unreadCount: 3, total: items.length, nextCursor: null, ...extra };
  return renderToStaticMarkup(createElement(NotificationList as never, { locale, initial, copy: getMessages(locale).notificationsPage }));
}

for (const locale of ["en-GB", "zh-CN"] as const) {
  const copy = getMessages(locale).notificationsPage;

  test(`rows, buttons and links render in ${locale}`, () => {
    const html = render(locale, [
      item({ id: "n1", buttonText: "View plan", buttonLink: "/en-GB/my-learning/subscription" }),
      item({ id: "n2", read: true, unread: false, readAt: "2026-11-20T11:00:00.000Z", title: "Already read" }),
      item({ id: "n3", title: "[TEST] Preview", read: true, unread: false, isTest: true }),
      item({ id: "n4", title: "No link here", buttonText: "Open" }),
      item({ id: "n5", title: "Unsafe", buttonText: "Open", buttonLink: "javascript:alert(1)" }),
    ]);
    const rows = html.split("<li ").slice(1);
    assert.equal(rows.length, 5);
    assert.match(rows[0], /rowUnread/);
    assert.ok(rows[0].includes(`>${copy.unreadTag}<`), "hidden unread tag");
    assert.ok(rows[0].includes(`>${copy.markRead}<`));
    assert.ok(rows[0].includes('href="/en-GB/my-learning/subscription"'));
    assert.doesNotMatch(rows[1], /rowUnread/);
    assert.ok(rows[1].includes(`>${copy.markUnread}<`));
    assert.ok(!rows[1].includes(`>${copy.unreadTag}<`), "a read row has no dot");
    assert.ok(!rows[2].includes(copy.markRead) && !rows[2].includes(copy.markUnread), "a test row has no mark button");
    assert.ok(!rows[3].includes("<a "), "a row without a link renders no link");
    assert.ok(!html.includes("javascript:"), "an unsafe link is never an href");
    assert.ok(!rows[4].includes("<a "));
  });

  test(`filter, empty states and the footer render in ${locale}`, () => {
    const html = render(locale, [item({ id: "n1" })], { unreadCount: 3, total: 45, nextCursor: "cursor" });
    assert.ok(html.includes(copy.filterUnread.replace("{count}", "3")));
    assert.ok(html.includes(copy.showing.replace("{shown}", "1").replace("{total}", "45")));
    assert.ok(html.includes(copy.loadMore));
    const done = render(locale, [item({ id: "n1" })], { total: 1, nextCursor: null });
    assert.ok(!done.includes(copy.loadMore), "no Load more once everything is shown");
    const empty = render(locale, [], { unreadCount: 0, total: 0 });
    assert.ok(empty.includes(copy.empty));
    assert.ok(!empty.includes(copy.showing.replace("{shown}", "0").replace("{total}", "0")), "no footer at total 0");
    assert.ok(empty.includes(copy.filterUnread.replace("{count}", "0")));
  });
}

test("the Unread empty text is its own message", () => {
  for (const locale of ["en-GB", "zh-CN"] as const) {
    const { empty, emptyUnread } = getMessages(locale).notificationsPage;
    assert.notEqual(empty, emptyUnread);
  }
});

test("the page title and the side menu entry use the same name, as in F02 (R-10)", () => {
  for (const [locale, name] of [["en-GB", "Notifications"], ["zh-CN", "通知"]] as const) {
    const messages = getMessages(locale);
    assert.equal(messages.notificationsPage.title, name);
    assert.equal(messages.account.notifications, name);
  }
});

test("the page loads the first page on the server and imports the list, with no placeholder", async () => {
  const source = await readFile("app/[locale]/account/my-learning/notifications/page.tsx", "utf8");
  assert.ok(!source.includes("placeholder"));
  assert.match(source, /import \{ NotificationList \}/);
  assert.match(source, /listLearnerNotifications\(user\.id, \{ filter: "all", limit: 20/);
});
