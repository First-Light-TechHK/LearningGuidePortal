import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { getMessages } from "../../lib/i18n/messages";

test("registration requires explicit terms/privacy consent for submit and social entries in both locales", async () => {
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import {AuthForm} from './components/portal/AuthForm';import {getMessages} from './lib/i18n/messages';const root=createRoot(document.getElementById('root'));window.mount=(locale,signupDesign=true,mode='sign-up')=>flushSync(()=>root.render(<main className="portal-page portal-auth-page portal-auth-signup-page"><div className="portal-auth-stage"><div className="portal-auth-card"><AuthForm showTitle={false} key={locale+signupDesign+mode} locale={locale} mode={mode} signupDesign={signupDesign} copy={getMessages(locale).auth} googleEnabled wechatEnabled returnTo={'/'+locale+'/account/my-learning'}/></div></div></main>));` },
    bundle: true, write: false, platform: "browser", jsx: "automatic",
    plugins: [{ name: "next-image", setup(b) {
      b.onResolve({ filter: /^next\/image$/ }, () => ({ path: "image", namespace: "stub" }));
      b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ loader: "tsx", contents: "import React from 'react';export default function Image(props){return <img {...props}/>}", resolveDir: process.cwd() }));
    } }],
  });
  const browser = await chromium.launch();
  await mkdir("test-results/registration-consent", { recursive: true });
  try {
    for (const locale of ["en-GB", "zh-CN"] as const) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, locale: locale === "en-GB" ? "zh-CN" : "en-GB" });
      const copy = getMessages(locale).auth, requests: any[] = [];
      let code = "REGISTRATION_CONSENT_REQUIRED", release: (() => void) | undefined, entered: (() => void) | undefined, hold = false;
      await page.route("http://registration.test/**", async route => {
        const pathname = new URL(route.request().url()).pathname;
        if (pathname === "/api/auth/register") {
          requests.push(route.request().postDataJSON());
          if (hold) await new Promise<void>(resolve => { release = resolve; entered?.(); });
          return route.fulfill({ status: code === "OK" ? 200 : 400, json: code === "OK" ? { ok: true, data: { verificationRequired: true } } : { ok: false, code } });
        }
        if (pathname.startsWith("/portal/")) return route.fulfill({ body: await readFile(path.join("public", pathname)), contentType: "image/svg+xml" });
        return route.fulfill({ body: '<div id="root"></div>', contentType: "text/html" });
      });
      await page.goto(`http://registration.test/${locale}/portal/sign-up`);
      for (const file of ["app/styles.css", "app/portal-design.css"]) await page.addStyleTag({ content: await readFile(file, "utf8") });
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      await page.evaluate(locale => (window as any).mount(locale, true, 'sign-in'), locale);
      assert.equal(await page.locator('[name="termsAccepted"]').count(), 0);
      assert.equal(await page.locator('.auth-provider-links a[href^="/api/auth/"]').count(), 2, 'sign-in keeps normal provider links');
      await page.evaluate(locale => (window as any).mount(locale, false), locale);
      for (const provider of await page.locator('.auth-provider-links button').all()) {
        await provider.click();
        assert.equal(await page.getByRole('alert').textContent(), copy.registrationConsentRequired);
        assert.equal(await page.locator('[name="termsAccepted"]').evaluate(e => e === document.activeElement), true);
      }
      assert.equal(requests.length, 0, 'icon registration also explains consent without submitting');
      await page.evaluate(locale => (window as any).mount(locale), locale);
      await page.locator('.auth-submit').click();
      assert.equal(await page.getByRole('alert').textContent(),copy.registrationConsentRequired,"an empty form still explains missing consent on click");
      assert.equal(requests.length,0);
      await page.locator('input[autocomplete="name"]').fill("test001");
      await page.locator('input[type="email"]').fill("consent@example.test");
      await page.locator('input[autocomplete="new-password"]').fill("ConsentPassword123!");
      const checkbox = page.locator('[name="termsAccepted"]'), submit = page.locator('.auth-submit'), providers = page.locator('.auth-provider-links .auth-provider-icon');
      assert.equal(await checkbox.isChecked(), false); assert.equal(await checkbox.getAttribute('required'), "");
      assert.equal(await submit.isEnabled(), true);
      await submit.hover();assert.equal(await submit.evaluate(e=>getComputedStyle(e).cursor),'pointer');
      await submit.click();
      assert.equal(await page.getByRole('alert').textContent(), copy.registrationConsentRequired);
      assert.equal(await checkbox.evaluate(e=>e===document.activeElement),true);
      assert.equal(await checkbox.getAttribute('aria-describedby'),await page.getByRole('alert').getAttribute('id'));
      assert.equal(requests.length,0);
      assert.equal(await providers.count(), 2);
      for (const [index, provider] of (await providers.all()).entries()) {
        assert.equal(await provider.isEnabled(), true);
        assert.equal(await provider.getAttribute('href'), null);
        assert.equal(await provider.getAttribute('aria-disabled'), null);
        assert.equal(await provider.evaluate(e => e.tagName), 'BUTTON');
        assert.deepEqual(await provider.evaluate(e => ({ opacity: getComputedStyle(e).opacity, cursor: getComputedStyle(e).cursor })), { opacity: '1', cursor: 'pointer' });
        await provider.hover();
        await page.waitForFunction(element => Boolean(element?.getAttribute('aria-describedby')), await provider.elementHandle());
        const tooltipId = await provider.getAttribute('aria-describedby'); assert.ok(tooltipId);
        const tooltip = page.locator(`[role="tooltip"][id="${tooltipId}"]`);
        await tooltip.waitFor();
        assert.equal(await tooltip.textContent(), copy.registrationConsentRequired);
        if (index === 0) await page.screenshot({ path: `test-results/registration-consent/${locale}-social-tooltip.png`, fullPage: true, animations: 'disabled' });
        assert.equal(requests.length, 0, 'hover only explains consent');
        await provider.click();
        assert.equal(await page.getByRole('alert').textContent(), copy.registrationConsentRequired);
        assert.equal(await checkbox.evaluate(e => e === document.activeElement), true);
        assert.equal(requests.length, 0);
        await page.mouse.move(0, 0); await tooltip.waitFor({ state: 'hidden' });
        await provider.focus(); await tooltip.waitFor();
        await provider.press('Enter');
        assert.equal(await checkbox.evaluate(e => e === document.activeElement), true);
        assert.equal(requests.length, 0, 'keyboard activation also cannot register without consent');
        await provider.focus(); await provider.press('Space');
        assert.equal(await checkbox.evaluate(e => e === document.activeElement), true);
      }
      assert.equal(new URL(page.url()).pathname, `/${locale}/portal/sign-up`);
      await page.locator('input[autocomplete="new-password"]').press('Enter');
      await page.locator('form').evaluate(form => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
      assert.equal(await page.getByRole('alert').textContent(), copy.registrationConsentRequired);
      assert.equal(requests.length, 0);
      await page.locator('form').evaluate(form => (form as HTMLFormElement).requestSubmit());
      assert.equal(await checkbox.evaluate(e => (e as HTMLInputElement).validationMessage), copy.registrationConsentRequired);
      assert.equal(requests.length, 0);
      await checkbox.check(); assert.equal(await submit.isEnabled(), true);
      assert.equal(await checkbox.evaluate(e => (e as HTMLInputElement).validationMessage), "");
      assert.equal(await page.getByRole('alert').count(), 0);
      assert.equal(await checkbox.getAttribute('aria-invalid'),null);assert.equal(await checkbox.getAttribute('aria-describedby'),null);
      for (const provider of await providers.all()) assert.ok((await provider.getAttribute('href'))?.includes('/api/auth/'));
      assert.equal(await page.getByRole('tooltip').count(), 0);
      await checkbox.uncheck(); assert.equal(await submit.isEnabled(), true);
      await submit.click();assert.equal(await page.getByRole('alert').textContent(),copy.registrationConsentRequired);assert.equal(requests.length,0);
      await page.screenshot({ path: `test-results/registration-consent/${locale}-unchecked.png`, fullPage: true });
      await checkbox.check();
      for (const width of [390, 320]) {
        await page.setViewportSize({ width, height: 1000 });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        assert.equal(await checkbox.isVisible(), true); assert.equal(await submit.isEnabled(), true);
        await page.screenshot({ path: `test-results/registration-consent/${locale}-checked-${width}.png`, fullPage: true });
      }
      await page.setViewportSize({ width: 1440, height: 1100 });
      await submit.click(); await page.getByRole('alert').waitFor();
      assert.equal(await page.getByRole('alert').textContent(), copy.registrationConsentRequired);
      assert.equal(requests.length, 1); assert.equal(requests[0].termsAccepted, true);
      assert.equal(requests[0].nickname,"test001");
      assert.equal(await checkbox.isChecked(), true); assert.equal(await submit.isEnabled(), true);
      hold = true; code = "OK";
      const requestEntered = new Promise<void>(resolve => { entered = resolve; });
      await page.locator('form').evaluate(form => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
      await requestEntered;
      assert.equal(requests.length, 2); assert.equal(await submit.isDisabled(), true);
      for (const provider of await providers.all()) {
        assert.equal(await provider.getAttribute('aria-disabled'), 'true');
        assert.equal(await provider.getAttribute('href'), null);
      }
      release?.(); await page.waitForURL(`**/${locale}/portal/check-email?email=consent%40example.test&returnTo=${encodeURIComponent(`/${locale}/account/my-learning`)}`);
      await page.close();
    }
  } finally { await browser.close(); }
});
