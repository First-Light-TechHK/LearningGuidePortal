import { expect, test } from "playwright/test";
import { getMessages } from "../../lib/i18n/messages";
import { expectOneLanguage } from "./locale-purity";
import { createGroup, enterSession, newMember, scheduleSession, SMTP_SINK_MESSAGES, type Member } from "./study-group-helpers";

// BUG-0285 and its class: a Study Group page shows one language, the page's.
// The browser's own language is deliberately the opposite one, so anything that
// falls back to it (a date, a default label) shows up as foreign text.

test.skip(Boolean(process.env.CI), "local-only Study Group E2E; CI does not run e2e");

const origin = (baseURL: string | undefined) => baseURL || "http://127.0.0.1:3013";
const unique = (label: string) => `${label}${Date.now().toString(36)}`;
const COURSE_TITLES = ["Epicureanism", "Modelling Life"];

async function member(browser: Parameters<typeof newMember>[0], baseURL: string | undefined, side: string, name: string, browserLocale?: string): Promise<Member> {
  return newMember(browser, origin(baseURL), side, name, { browserLocale });
}

// Titles other runs left in the discover list are other people's content, not UI copy.
async function listedTitles(who: Member) {
  const titles: string[] = [];
  for (const path of ["/api/study-groups", "/api/study-groups?view=mine", "/api/study-groups?view=my"]) {
    const answer = await (await who.context.request.get(path)).json().catch(() => null) as { data?: Array<{ title?: string; about?: string }> } | null;
    if (Array.isArray(answer?.data)) for (const row of answer.data) titles.push(row.title ?? "", row.about ?? "");
  }
  return titles.filter(Boolean);
}

// The mail's Subject header, decoded (RFC 2047).
function subject(raw: string) {
  const header = raw.match(/^Subject: ((?:.*)(?:\r?\n[ \t].*)*)/m)?.[1] ?? "";
  return header.replace(/\r?\n[ \t]/g, "").replace(/=\?UTF-8\?([BQ])\?([^?]*)\?=\s*/gi, (_, encoding: string, text: string) => encoding.toUpperCase() === "B"
    ? Buffer.from(text, "base64").toString("utf8")
    : Buffer.from(text.replace(/_/g, " ").replace(/=([0-9A-F]{2})/gi, (__, hex: string) => String.fromCharCode(parseInt(hex, 16))), "latin1").toString("utf8"));
}

async function mailTo(email: string) {
  const messages = await (await fetch(SMTP_SINK_MESSAGES)).json() as Array<{ to: string[]; raw: string }>;
  return messages.filter((message) => message.to.includes(email.toLowerCase())).map((message) => message.raw);
}

for (const [locale, browserLocale, names] of [
  ["zh-CN", "en-US", { group: "读书会", session: "第一次讨论", host: "主持人", guest: "同学" }],
  ["en-GB", "zh-CN", { group: "Reading Circle", session: "First Talk", host: "Study Host", guest: "Study Guest" }],
] as const) {
  test(`I18N-1 ${locale}: every Study Group page a member and an outsider see is one language`, async ({ browser, baseURL }) => {
    test.setTimeout(240_000);
    const host = await member(browser, baseURL, `i18n-${locale}-a`, names.host, browserLocale);
    const outsider = await member(browser, baseURL, `i18n-${locale}-b`, names.guest, browserLocale);
    const data = [...COURSE_TITLES, names.host, names.guest, host.email, outsider.email];
    const group = unique(names.group);
    const session = unique(names.session);
    try {
      const groupId = await createGroup(host, group, group);
      const sessionId = await scheduleSession(host, groupId, { title: session, startsInMs: 5 * 60_000, aiTutorEnabled: true, focus: session });
      data.push(group, session);

      const page = await host.context.newPage();
      const copy = getMessages(locale).studyGroupsPage;
      data.push(...await listedTitles(host));
      await page.goto(`/${locale}/portal/study-groups`);
      await expect(page.locator("main")).toBeVisible();
      await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe(locale);
      await expectOneLanguage(page, locale, data);

      await page.getByRole("button", { name: copy.create }).first().click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await expectOneLanguage(page, locale, data);
      await page.keyboard.press("Escape");

      await page.goto(`/${locale}/portal/study-groups?group=${groupId}`);
      await expect(page.getByText(session).first()).toBeVisible();
      await expectOneLanguage(page, locale, data);

      await page.getByRole("button", { name: copy.schedule }).first().click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await expectOneLanguage(page, locale, data);
      await page.keyboard.press("Escape");

      // The page BUG-0285 reported: a learner with Course access who is not a member.
      const outsiderPage = await outsider.context.newPage();
      await outsiderPage.goto(`/${locale}/portal/study-groups/sessions/${sessionId}`);
      await expect(outsiderPage.getByRole("heading", { name: session }).or(outsiderPage.getByText(session).first()).first()).toBeVisible();
      await expectOneLanguage(outsiderPage, locale, data);

      // The live room: the Host starts, in the page's language.
      expect((await enterSession(host, sessionId)).status()).toBe(200);
      await page.goto(`/${locale}/portal/study-groups/sessions/${sessionId}`);
      await page.getByRole("button", { name: copy.start }).click();
      await page.waitForURL(new RegExp(`/${locale}/portal/study-groups/sessions/${sessionId}`), { timeout: 30_000 });
      await expect(page.getByRole("button", { name: copy.room.leave })).toBeVisible({ timeout: 30_000 });
      await expectOneLanguage(page, locale, data);
    } finally {
      await host.context.close();
      await outsider.context.close();
    }
  });
}

for (const [locale, browserLocale] of [["zh-CN", "en-US"], ["en-GB", "zh-CN"]] as const) {
  test(`I18N-5 ${locale}: the AI Tutor panel is one language, mode buttons included`, async ({ browser, baseURL }) => {
    test.setTimeout(180_000);
    const learner = await member(browser, baseURL, `i18n-tutor-${locale}`, locale === "zh-CN" ? "小花" : "Hana", browserLocale);
    try {
      const page = await learner.context.newPage();
      const copy = getMessages(locale).learning;
      await page.goto(`/${locale}/account/learn/epicureanism`, { timeout: 120_000 });
      await page.getByRole("button", { name: /AI Tutor|AI 导师/ }).first().click();
      const panel = page.getByRole("button", { name: copy.socratic });
      await expect(panel).toBeVisible();
      await expect(page.getByRole("button", { name: copy.lecture })).toBeVisible();
      await expectOneLanguage(page, locale, [...COURSE_TITLES, "小花", "Hana"], ".tutor-panel");
      // A translated label must not change the layout: on a phone the mode buttons stay
      // on one line, the same height in both languages.
      await page.setViewportSize({ width: 360, height: 740 });
      const heights = await page.locator(".tutor-panel .mode-switch button").evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect().height));
      expect(heights).toEqual([25, 25]);
    } finally {
      await learner.context.close();
    }
  });
}

test("I18N-2: the reminder strip follows the page, not the language the reminder was written in", async ({ browser, baseURL }) => {
  test.setTimeout(180_000);
  const host = await member(browser, baseURL, "i18n-rem", "Study Host");
  const data = [...COURSE_TITLES, "Study Host", host.email];
  try {
    const group = unique("Circle");
    const session = unique("Talk");
    data.push(group, session, ...await listedTitles(host));
    const groupId = await createGroup(host, group);
    await scheduleSession(host, groupId, { title: session, startsInMs: 5 * 60_000, aiTutorEnabled: false });
    const page = await host.context.newPage();

    await page.goto("/en-GB/portal/study-groups");
    await expect(page.getByText(new RegExp(`${session} in the Study Group`))).toBeVisible({ timeout: 30_000 });

    await page.goto("/zh-CN/portal/study-groups");
    await expect(page.getByText(new RegExp(`${session} 将在 \\d+ 分钟后开始`))).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(new RegExp(`${session} in the Study Group`))).toHaveCount(0);
    await expectOneLanguage(page, "zh-CN", data);
  } finally {
    await host.context.close();
  }
});

test("I18N-3: the header's language switch is the user's choice: their reminder mail comes in that language", async ({ browser, baseURL }) => {
  test.setTimeout(180_000);
  const host = await member(browser, baseURL, "i18n-switch", "Study Host");
  try {
    const page = await host.context.newPage();
    await page.goto("/en-GB/portal/study-groups");
    const saved = page.waitForResponse((response) => response.url().endsWith("/api/me/locale"));
    await page.getByRole("link", { name: "切换到简体中文" }).click();
    expect((await saved).status()).toBe(200);
    await expect(page).toHaveURL(/\/zh-CN\/portal\/study-groups/);
    await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe("zh-CN");

    const profile = await (await host.context.request.get("/api/me/profile")).json() as { user: { locale: string } };
    expect(profile.user.locale).toBe("zh-CN");

    const groupId = await createGroup(host, unique("Circle"));
    await scheduleSession(host, groupId, { title: unique("Talk"), startsInMs: 5 * 60_000, aiTutorEnabled: false });
    await page.goto("/zh-CN/portal/study-groups");
    await expect.poll(async () => (await mailTo(host.email)).some((raw) => subject(raw).includes("直播课提醒")), { timeout: 30_000 }).toBe(true);
  } finally {
    await host.context.close();
  }
});

test("I18N-4: signed out, the switch still works and changes nothing on the server", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL: origin(baseURL) });
  try {
    const page = await context.newPage();
    await page.goto("/en-GB/portal/study-groups");
    const answered = page.waitForResponse((response) => response.url().endsWith("/api/me/locale"));
    await page.getByRole("link", { name: "切换到简体中文" }).click();
    expect((await answered).status()).toBe(401);
    await expect(page).toHaveURL(/\/zh-CN\/portal\/study-groups/);
    const refused = await context.request.post("/api/me/locale", { data: { locale: "fr-FR" } });
    expect(refused.status()).toBe(401);
  } finally {
    await context.close();
  }
});
