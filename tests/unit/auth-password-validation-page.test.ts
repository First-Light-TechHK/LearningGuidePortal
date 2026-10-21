import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright";
import { mkdir, readFile } from "node:fs/promises";
import { getMessages } from "../../lib/i18n/messages";

test("login and registration password validation follows the page locale across browser languages", async () => {
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import {AuthForm} from './components/portal/AuthForm';import {getMessages} from './lib/i18n/messages';const root=createRoot(document.getElementById('root'));window.mount=(locale,mode)=>flushSync(()=>root.render(<main className="portal-page portal-auth-page"><div className="portal-auth-stage"><div className="portal-auth-card"><AuthForm key={locale+mode} locale={locale} mode={mode} signupDesign={mode==='sign-up'} showTitle={false} initialEmail="learner@example.test" copy={getMessages(locale).auth} returnTo={'/'+locale+'/account/my-learning'}/></div></div></main>));` },
    bundle: true, write: false, platform: "browser", jsx: "automatic",
    plugins: [{ name: "providers", setup(b) {
      b.onResolve({ filter: /AuthProviders$/ }, () => ({ path: "providers", namespace: "stub" }));
      b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: "export const AuthProviders=()=>null", loader: "tsx" }));
    } }],
  });
  const browser = await chromium.launch();
  await mkdir("test-results/auth-password-validation", { recursive: true });
  try {
    for (const locale of ["en-GB", "zh-CN"] as const) {
      for (const browserLocale of ["en-GB", "zh-CN"] as const) {
        const page = await browser.newPage({ locale: browserLocale, viewport: { width: 1440, height: 1000 } });
        const copy = getMessages(locale).auth, requests: unknown[] = [];
        await page.route("http://password.test/**", route => {
          if (new URL(route.request().url()).pathname.startsWith('/api/auth/')) {
            requests.push(route.request().postDataJSON());
            return route.fulfill({ status: 400, json: { ok: false, code: route.request().url().endsWith('/login') ? 'AUTHENTICATION_FAILED' : 'REGISTRATION_FAILED' } });
          }
          return route.fulfill({ body: '<div id="root"></div>', contentType: 'text/html' });
        });
        await page.goto('http://password.test/');
        for (const file of ['app/styles.css', 'app/portal-design.css']) await page.addStyleTag({ content: await readFile(file, 'utf8') });
        await page.addScriptTag({ content: bundle.outputFiles[0].text });
        for (const mode of ['sign-in', 'sign-up'] as const) {
          await page.evaluate(({locale, mode}) => (window as any).mount(locale, mode), { locale, mode });
          if (mode === 'sign-up') {
            await page.locator('input[autocomplete="name"]').fill('Learner');
            await page.locator('[name="termsAccepted"]').check();
          }
          const password = page.locator('input[autocomplete="current-password"],input[autocomplete="new-password"]'), submit = page.locator('.auth-submit');
          const before = requests.length;
          await submit.click();
          assert.equal(await password.evaluate(e => (e as HTMLInputElement).validity.valueMissing), true);
          assert.equal(await password.evaluate(e => (e as HTMLInputElement).validationMessage), copy.passwordRequired);
          assert.equal(requests.length, before);
          await page.screenshot({ path: `test-results/auth-password-validation/${locale}-${browserLocale}-${mode}-required.png`, fullPage: true });
          await page.locator('.auth-password-toggle').click();
          assert.equal(await password.getAttribute('type'), 'text');
          await password.fill('short');
          assert.equal(await password.evaluate(e => (e as HTMLInputElement).validity.customError), false);
          await password.press('Enter');
          assert.equal(await password.evaluate(e => (e as HTMLInputElement).validationMessage), copy.passwordTooShort);
          assert.equal(requests.length, before);
          await password.fill('12345678');
          assert.equal(await password.evaluate(e => (e as HTMLInputElement).validationMessage), '');
          await password.fill('');
          await page.locator('form').evaluate(e => (e as HTMLFormElement).requestSubmit());
          assert.equal(await password.evaluate(e => (e as HTMLInputElement).validationMessage), copy.passwordRequired);
          await password.fill('ValidPassword123!');
          assert.equal(await password.evaluate(e => (e as HTMLInputElement).validationMessage), '');
          await page.locator('.auth-password-toggle').click();
          assert.equal(await password.getAttribute('type'), 'password');
          assert.equal(await password.getAttribute('maxlength'), mode === 'sign-in' ? '30' : '72');
          const response = page.waitForResponse(r => r.url().includes('/api/auth/'));
          await submit.click(); await response; await page.getByRole('alert').waitFor();
          assert.equal(requests.length, before + 1);
          assert.equal(await password.inputValue(), 'ValidPassword123!');
          assert.equal(await page.getByRole('alert').textContent(), mode === 'sign-in' ? copy.authenticationFailed : copy.registrationFailed);
        }
        await page.close();
      }
    }
  } finally { await browser.close(); }
});
