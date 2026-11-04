import { randomUUID } from "node:crypto";
import { expect, test, type Browser } from "playwright/test";
import { expectOneLanguage } from "./locale-purity";

// The learner's Helpdesk pages show one language, the page's, whatever the
// browser's own language is. Articles and answers come from the stub Admin.

type Locale = "en-GB" | "zh-CN";
const NICKNAME: Record<Locale, string> = { "en-GB": "Hana Learner", "zh-CN": "小花" };

async function learner(browser: Browser, locale: Locale, browserLocale: string) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1024 }, locale: browserLocale });
  const email = `helpdesk-i18n-${Date.now()}-${randomUUID().slice(0, 8)}@example.test`;
  const registered = await context.request.post("/api/auth/register", { data: { termsAccepted: true, email, password: "Passw0rd!123", nickname: NICKNAME[locale], locale } });
  expect(registered.status()).toBe(200);
  return { context, page: await context.newPage(), email };
}

for (const [locale, browserLocale] of [["zh-CN", "en-US"], ["en-GB", "zh-CN"]] as const) {
  test(`I18N-H ${locale}: Contact Support, My enquiries and the Help Centre are one language`, async ({ browser }) => {
    test.setTimeout(180_000);
    const { context, page, email } = await learner(browser, locale, browserLocale);
    const data = [NICKNAME[locale], email];
    try {
      for (const path of ["account/my-learning/support", "account/my-learning/support/enquiries", "help"]) {
        await page.goto(`/${locale}/${path}`, { timeout: 120_000 });
        await expect(page.locator("main").first()).toBeVisible();
        await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe(locale);
        await expectOneLanguage(page, locale, data);
      }
    } finally {
      await context.close();
    }
  });
}
