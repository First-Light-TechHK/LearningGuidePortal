import { expect, test, type Locator, type Page } from "playwright/test";
import { getMessages } from "../../lib/i18n/messages";
import { createGroup, fillScheduleDialog, newMember, scheduleSession, type Member } from "./study-group-helpers";

// BUG-0299: "clicking AI Tutor does nothing". The course's AI Tutor was offline,
// so the switch was rightly disabled, but the only reason sat behind a hover on
// a small icon. A disabled switch says why in its own row, in the schedule form
// and the edit form alike, and the words beside a working switch toggle it too.

test.skip(Boolean(process.env.CI), "local-only Study Group E2E; CI does not run e2e");

const LOCALES = ["en-GB", "zh-CN"] as const;
const origin = (baseURL: string | undefined) => baseURL || "http://127.0.0.1:3013";
const unique = (label: string) => `${label}${Date.now().toString(36)}`;
const copyOf = (locale: (typeof LOCALES)[number]) => getMessages(locale).studyGroupsPage;

const setKsOffline = (host: Member) => host.context.request.post("http://127.0.0.1:8788/__control/ks-online", { data: { online: false } });
const rowOf = (control: Locator) => control.locator("xpath=ancestor::label[1]");

// Here, and not in a finally: after a test timeout the member's context is gone,
// and a mock left offline would fail every test that runs after this one.
test.afterEach(async ({ request }) => {
  await request.post("http://127.0.0.1:8788/__control/ks-online", { data: { online: true } });
});

// WCAG contrast of the text's colour against the white dialog.
async function contrastOnWhite(text: Locator) {
  const color = await text.evaluate((element) => getComputedStyle(element).color);
  const [r, g, b] = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 1.05 / (0.2126 * r + 0.7152 * g + 0.0722 * b + 0.05);
}

// The reason is on screen with the pointer away from the row, the control stays
// off however it is clicked, and the row stays inside the dialog.
async function expectExplained(page: Page, control: Locator, locale: (typeof LOCALES)[number]) {
  const copy = copyOf(locale);
  const row = rowOf(control);
  await page.mouse.move(0, 0);
  const reason = row.getByText(copy.aiTutorOfflineHint, { exact: true });
  await expect(reason).toBeVisible();
  await expect(row.getByText(copy.enableAiTutor, { exact: true })).toHaveCount(0);
  expect(await contrastOnWhite(reason), "the reason is readable").toBeGreaterThanOrEqual(4.5);
  await expect(control).toBeDisabled();
  // Real mouse clicks: Playwright's own click waits for a disabled control to be
  // enabled, and treats the words of its label the same way.
  for (const target of [control, reason]) {
    const box = (await target.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  }
  await expect(control).toBeDisabled();
  const off = (await control.getAttribute("role")) === "switch" ? expect(control).toHaveAttribute("aria-checked", "false") : expect(control).not.toBeChecked();
  await off;
  await expectInsideForm(page, row, control);
}

async function expectInsideForm(page: Page, row: Locator, control: Locator) {
  // The <dialog> element covers the whole window: the form is the visible panel.
  const form = (await page.getByRole("dialog").locator("form").boundingBox())!;
  const rowBox = (await row.boundingBox())!;
  const controlBox = (await control.boundingBox())!;
  expect(rowBox.x, "the row starts inside the form").toBeGreaterThanOrEqual(form.x);
  expect(rowBox.x + rowBox.width, "the row ends inside the form").toBeLessThanOrEqual(form.x + form.width);
  expect(controlBox.width, "a long reason does not squeeze the switch").toBeGreaterThanOrEqual(32);
  expect(controlBox.x + controlBox.width, "the switch stays in its row").toBeLessThanOrEqual(rowBox.x + rowBox.width + 0.5);
  const labelLines = await row.locator("span").first().evaluate((label) => {
    const range = document.createRange();
    range.selectNodeContents(label);
    return new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size;
  });
  expect(labelLines, "a long reason does not break the AI Tutor label in two").toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), "no sideways scroll").toBe(true);
}

test("BUG-0299: a disabled AI Tutor switch says why in its row, in both forms and both languages", async ({ browser, baseURL }) => {
  test.setTimeout(240_000);
  const host = await newMember(browser, origin(baseURL), "tutor-switch", "Study Host");
  try {
    const groupId = await createGroup(host, unique("E2E tutor switch"));
    await scheduleSession(host, groupId, { title: "Editable", startsInMs: 3 * 60 * 60_000, aiTutorEnabled: false });
    expect((await setKsOffline(host)).status()).toBe(200);
    const page = await host.context.newPage();
    for (const locale of LOCALES) {
      const copy = copyOf(locale);
      await page.goto(`/${locale}/portal/study-groups?group=${groupId}`);

      await page.getByRole("button", { name: copy.schedule }).first().click();
      await expectExplained(page, page.getByRole("dialog").getByRole("switch"), locale);
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);

      await page.getByRole("button", { name: copy.editSession }).first().click();
      await expectExplained(page, page.getByRole("dialog").locator('[name="aiTutor"]'), locale);
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);
    }
  } finally {
    await host.context.close();
  }
});

test("BUG-0299: the words beside a working switch toggle it, and the session is saved that way", async ({ browser, baseURL }) => {
  test.setTimeout(180_000);
  const host = await newMember(browser, origin(baseURL), "tutor-words", "Study Host");
  try {
    const groupId = await createGroup(host, unique("E2E tutor words"));
    const page = await host.context.newPage();
    const copy = copyOf("en-GB");
    await page.goto(`/en-GB/portal/study-groups?group=${groupId}`);
    await page.getByRole("button", { name: copy.schedule }).first().click();
    const dialog = page.getByRole("dialog");
    const toggle = dialog.getByRole("switch");
    const words = rowOf(toggle).getByText(copy.enableAiTutor, { exact: true });
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await words.click();
    await expect(toggle, "the words turn it off").toHaveAttribute("aria-checked", "false");
    await toggle.click();
    await expect(toggle, "the switch turns it back on, once").toHaveAttribute("aria-checked", "true");
    await words.click();
    await expect(toggle).toHaveAttribute("aria-checked", "false");

    const title = unique("Words");
    await fillScheduleDialog(dialog, { title, startsAt: new Date(Date.now() + 3 * 60 * 60_000), duration: "30 mins", max: "4" });
    const saved = page.waitForResponse((response) => response.url().endsWith(`/api/study-groups/${groupId}/sessions`) && response.request().method() === "POST");
    await dialog.getByRole("button", { name: copy.scheduleAction }).click();
    const session = (await (await saved).json()).data as { title: string; aiTutorEnabled: boolean };
    expect(session.title).toBe(title);
    expect(session.aiTutorEnabled, "off in the form, off in the session").toBe(false);
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await page.getByRole("button", { name: copy.editSession }).first().click();
    const box = page.getByRole("dialog").locator('[name="aiTutor"]');
    await expect(box).not.toBeChecked();
    await rowOf(box).getByText(copy.enableAiTutor, { exact: true }).click();
    await expect(box, "the edit form's words toggle it as well").toBeChecked();
  } finally {
    await host.context.close();
  }
});

test("BUG-0299: on a phone the offline row wraps inside the dialog and the switch keeps its size", async ({ browser, baseURL }) => {
  test.setTimeout(180_000);
  const host = await newMember(browser, origin(baseURL), "tutor-phone", "Study Host");
  try {
    const groupId = await createGroup(host, unique("E2E tutor phone"));
    await scheduleSession(host, groupId, { title: "Editable", startsInMs: 3 * 60 * 60_000, aiTutorEnabled: false });
    expect((await setKsOffline(host)).status()).toBe(200);
    const page = await host.context.newPage();
    await page.setViewportSize({ width: 360, height: 780 });
    for (const locale of LOCALES) {
      const copy = copyOf(locale);
      await page.goto(`/${locale}/portal/study-groups?group=${groupId}`);
      await page.getByRole("button", { name: copy.schedule }).first().click();
      const control = page.getByRole("dialog").getByRole("switch");
      await control.scrollIntoViewIfNeeded();
      await expect(rowOf(control).getByText(copy.aiTutorOfflineHint, { exact: true })).toBeVisible();
      await expectInsideForm(page, rowOf(control), control);
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);

      await page.getByRole("button", { name: copy.editSession }).first().click();
      const box = page.getByRole("dialog").locator('[name="aiTutor"]');
      await box.scrollIntoViewIfNeeded();
      await expect(rowOf(box).getByText(copy.aiTutorOfflineHint, { exact: true })).toBeVisible();
      await expectInsideForm(page, rowOf(box), box);
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);
    }
  } finally {
    await host.context.close();
  }
});
