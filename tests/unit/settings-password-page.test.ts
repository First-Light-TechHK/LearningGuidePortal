import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright";
import { getMessages } from "../../lib/i18n/messages";

/** Personal settings edits profile fields and offers no password change. */
test("personal settings edits profile fields and offers no password change", async () => {
  const bundle = await build({ stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {SettingsForm} from './components/portal/SettingsForm';import {getMessages} from './lib/i18n/messages';createRoot(document.getElementById('root')).render(<SettingsForm countries={['China']} uiLocale="en-GB" initialLocale="en-GB" initialCountry="China" initialNickname="Learner" initialEmail="learner@example.test" hasAvatar={false} copy={getMessages('en-GB').settingsPage}/>);`, resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, platform: "browser", jsx: "automatic", plugins: [{ name: "cropper", setup(b) { b.onResolve({ filter: /AvatarCropper$/ }, () => ({ path: "cropper", namespace: "stub" })); b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: "export const AvatarCropper=()=>null" })); } }] });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const requests: Array<Record<string, unknown>> = [];
    await page.route("http://settings.test/**", (route) => route.fulfill({ body: '<div id="root"></div>', contentType: "text/html" }));
    await page.route("**/api/me/profile", (route) => {
      requests.push(route.request().postDataJSON() as Record<string, unknown>);
      return route.fulfill({ status: 200, json: { ok: true } });
    });
    await page.goto("http://settings.test/");
    await page.addScriptTag({ content: bundle.outputFiles[0].text });

    const name = page.locator('input[autocomplete="name"]');
    await name.waitFor();

    assert.equal(await page.locator("input[type='password']").count(), 0);
    assert.equal(await page.locator(".settings-password").count(), 0);
    assert.equal(await page.getByRole("heading", { name: getMessages("en-GB").settingsPage.newPassword as string, exact: true }).count(), 0);

    await name.fill("test001");
    await page.locator(".settings-save-row button").click();
    await page.getByRole("status").waitFor();
    assert.equal(requests.at(-1)?.nickname, "test001");
    assert.equal("currentPassword" in (requests.at(-1) ?? {}), false);
    assert.equal("newPassword" in (requests.at(-1) ?? {}), false);
  } finally {
    await browser.close();
  }
});
