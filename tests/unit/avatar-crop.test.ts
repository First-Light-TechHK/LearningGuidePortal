import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { readFileSync } from 'node:fs';

test('avatar crop position stays within portrait and landscape images', async () => {
  const { avatarCrop } = await import(new URL('../../lib/avatarCrop.ts', import.meta.url).href);
  assert.deepEqual(avatarCrop(1200, 600, 1, 100, 50), { x: 600, y: 0, size: 600 });
  assert.deepEqual(avatarCrop(600, 1200, 2, 50, 100), { x: 150, y: 900, size: 300 });
});

test('settings uploads only the chosen crop; cancel and failed uploads preserve the avatar', async () => {
  const bundle = await build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {SettingsForm} from './components/portal/SettingsForm'; import {getMessages} from './lib/i18n/messages'; window.mount=locale=>createRoot(document.getElementById('root')).render(React.createElement(SettingsForm,{countries:['China'],uiLocale:locale,initialNickname:'Test',initialEmail:'test@example.test',initialLocale:locale,initialCountry:'China',hasAvatar:false,copy:getMessages(locale).learning}));`, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' } });
  const blue = await sharp({ create: { width: 600, height: 600, channels: 3, background: '#0000ff' } }).png().toBuffer();
  const source = await sharp({ create: { width: 1200, height: 600, channels: 3, background: '#ff0000' } }).composite([{ input: blue, left: 600, top: 0 }]).png().toBuffer();
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
  try {
    for (const locale of ['en-GB', 'zh-CN']) {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      let uploaded: Buffer | undefined, attempts = 0;
      await page.route('http://avatar.test/', route => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }));
      await page.route('**/api/my-learning/avatar', async route => {
        if (route.request().method() === 'POST') {
          attempts++;
          const request = route.request();
          const form = await new Request(request.url(), { method: 'POST', headers: request.headers(), body: new Uint8Array(request.postDataBuffer()!).buffer }).formData();
          uploaded = Buffer.from(await (form.get('file') as File).arrayBuffer());
          await route.fulfill({ status: attempts === 1 ? 503 : 200, contentType: 'application/json', body: attempts === 1 ? '{"ok":false}' : '{"ok":true}' });
        } else await route.fulfill({ contentType: 'image/png', body: source });
      });
      await page.goto('http://avatar.test/');
      await page.addStyleTag({ content: readFileSync('app/portal-design.css', 'utf8') });
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      await page.evaluate(locale => (window as unknown as {mount: (locale: string) => void}).mount(locale), locale);
      const input = page.locator('input[type=file]');
      const choose = () => input.setInputFiles({ name: 'source.png', mimeType: 'image/png', buffer: source });
      await choose();
      const dialog = page.getByRole('dialog');
      await dialog.waitFor();
      assert.ok(await dialog.evaluate(element => element.getBoundingClientRect().width <= innerWidth), 'crop dialog fits mobile viewport');
      await dialog.getByRole('button', { name: locale === 'zh-CN' ? '取消' : 'Cancel', exact: true }).click();
      assert.equal(attempts, 0);
      await choose();
      const horizontal = dialog.getByRole('slider', { name: locale === 'zh-CN' ? '水平位置' : 'Horizontal position' });
      await horizontal.focus(); await horizontal.press('End');
      const save = dialog.getByRole('button', { name: locale === 'zh-CN' ? '保存头像' : 'Save avatar', exact: true });
      await save.click();
      await dialog.getByRole('alert').waitFor();
      assert.equal(await page.locator('.avatar-preview img').count(), 0);
      await save.click();
      await dialog.waitFor({ state: 'detached' });
      assert.equal(attempts, 2);
      const metadata = await sharp(uploaded!).metadata();
      assert.equal(metadata.width, 600); assert.equal(metadata.height, 600); assert.equal(metadata.format, 'jpeg');
      const stats = await sharp(uploaded!).stats();
      assert.ok(stats.channels[2].mean > 240 && stats.channels[0].mean < 10, 'saved image must contain the selected blue half');
      await page.close();
    }
  } finally { await browser.close(); }
});
