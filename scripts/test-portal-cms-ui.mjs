// Frontend-only regression: synthetic deferred API responses, never a live translation provider.
// Runs the real component/CSS in an intercepted browser origin; no app server is started.
import assert from 'node:assert/strict';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artefacts = await mkdtemp(path.join(tmpdir(), 'portal-cms-ui-'));
const result = await build({
  absWorkingDir: root, bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
  tsconfig: path.join(root, 'tsconfig.json'), define: { 'process.env.NODE_ENV': '"development"' },
  stdin: { resolveDir: root, loader: 'tsx', contents: `
    import {useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {PortalContentEditor} from './components/portal/PortalContentEditor';
    import {defaultPortalContent} from './lib/portalContent';
    const initial=structuredClone(defaultPortalContent); delete initial.translation;
    function Fixture(){const [locale,setLocale]=useState('en-GB'),[visible,setVisible]=useState(true);
      window.cmsLocale=setLocale;window.cmsVisible=setVisible;
      return <main className="portal-section">{visible&&<PortalContentEditor initial={initial} locale={locale}/>}</main>;
    }
    createRoot(document.getElementById('root')).render(<Fixture/>);
  ` },
});
const css = await readFile(path.join(root, 'app/styles.css'), 'utf8') + await readFile(path.join(root, 'app/portal-design.css'), 'utf8');
const en = JSON.parse(await readFile(path.join(root, 'messages/en-GB.json'), 'utf8')).portalEditor;
const zh = JSON.parse(await readFile(path.join(root, 'messages/zh-CN.json'), 'utf8')).portalEditor;
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');
const longName = 'a'.repeat(76) + '.png';
const library = [{ id: 'existing', fileName: longName, url: '/api/portal-media/existing', kind: 'uploaded' }];
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [], gates = [], requests = [];
let hold = '', failLibrary = false, failUpload = false;
page.on('pageerror', error => errors.push(error.message));
async function eventually(check, message) {
  for (let i = 0; i < 100; i++) { if (await check()) return; await page.waitForTimeout(30); }
  throw new Error(message);
}
await page.route('**/*', async route => {
  const url = new URL(route.request().url());
  if (url.hostname !== 'cms-fixture.test') return route.abort();
  if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><body><div id="root"></div><script src="/fixture.js"></script></body></html>' });
  if (url.pathname === '/fixture.js') return route.fulfill({ contentType: 'text/javascript', body: result.outputFiles[0].text });
  if (url.pathname === '/fixture.css') return route.fulfill({ contentType: 'text/css', body: css });
  if (!url.pathname.startsWith('/api/backoffice/portal')) return route.fulfill({ contentType: 'image/png', body: png });
  const method = route.request().method();
  const kind = url.pathname.endsWith('/translate') ? 'translate' : url.pathname.endsWith('/media') ? method === 'GET' ? 'library' : 'upload' : 'save';
  const request = { kind, body: kind === 'save' || kind === 'translate' ? route.request().postDataJSON() : null };
  requests.push(request);
  const failure = kind === 'library' ? failLibrary : kind === 'upload' ? failUpload : false;
  if (kind === hold) await new Promise(resolve => gates.push({ kind, release: resolve }));
  if (failure) return route.fulfill({ status: 503, json: { error: `Synthetic ${kind} failure` } }).catch(() => undefined);
  let response;
  if (kind === 'library') response = { library };
  else if (kind === 'upload') response = { asset: { url: '/api/portal-media/uploaded' }, library: [...library, { id: 'uploaded', fileName: 'uploaded.png', url: '/api/portal-media/uploaded', kind: 'uploaded' }] };
  else if (kind === 'save') response = { content: request.body };
  else { const content = structuredClone(request.body.content); const target = request.body.source === 'en-GB' ? 'zh-CN' : 'en-GB'; content.banners[target][0].title = 'Synthetic translated heading'; response = { content, skipped: false }; }
  return route.fulfill({ json: response }).catch(() => undefined);
});
const form = page.locator('.portal-content-editor');
const dialog = page.getByRole('dialog');
const heading = () => form.getByLabel(en.title, { exact: true }).first();
async function openPicker(index = 0) { await form.getByRole('button', { name: en.chooseImage, exact: true }).nth(index).click(); await dialog.waitFor(); }
async function release(kind) { const gate = gates.find(item => item.kind === kind); assert.ok(gate, `Missing ${kind} gate`); gates.splice(gates.indexOf(gate), 1); hold = ''; gate.release(); }
async function assertLocked() {
  assert.equal(await heading().isDisabled(), true);
  assert.equal(await form.locator('.portal-i18n-toolbar select').isDisabled(), true);
  assert.equal(await form.getByRole('button', { name: en.chooseImage, exact: true }).first().isDisabled(), true);
}

try {
  await page.goto('http://cms-fixture.test'); await heading().waitFor();
  await heading().fill('English revision before save');
  hold = 'save'; await form.getByRole('button', { name: en.save, exact: true }).click();
  await eventually(() => gates.some(g => g.kind === 'save'), 'Save was not deferred'); await assertLocked();
  assert.equal(requests.filter(r => r.kind === 'save').length, 1);
  await release('save'); await eventually(() => heading().isEnabled(), 'Save lock did not clear');
  assert.equal(await heading().inputValue(), 'English revision before save');
  await heading().fill('English revision before translation');
  hold = 'translate'; await form.getByRole('button', { name: en.translateOnce, exact: true }).click();
  await eventually(() => gates.some(g => g.kind === 'translate'), 'Translation was not deferred'); await assertLocked();
  await release('translate'); await eventually(() => heading().isEnabled(), 'Translation lock did not clear');
  assert.equal(await heading().inputValue(), 'English revision before translation');
  assert.equal(await form.getByLabel(en.title, { exact: true }).nth(1).inputValue(), 'Synthetic translated heading');
  console.log('PASS synthetic deferred save/translation locks and bilingual result');

  failLibrary = true; await openPicker();
  await dialog.getByRole('alert').waitFor(); assert.match(await dialog.getByRole('alert').textContent(), /library failure/);
  failLibrary = false; await dialog.getByRole('button', { name: 'Retry', exact: true }).click();
  await dialog.getByRole('button', { name: longName, exact: true }).waitFor();
  assert.equal(await heading().isDisabled(), true);
  await dialog.getByRole('button', { name: longName, exact: true }).focus(); await page.keyboard.press('Tab');
  assert.equal(await dialog.evaluate(el => el.matches(':modal')), true);
  // Chromium can visit browser chrome after the last dialog control, but not the inert form.
  assert.equal(await page.evaluate(() => document.activeElement === document.body || !!document.activeElement?.closest('dialog')), true, 'Tab reached the obscured form');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => !!document.activeElement?.closest('dialog')), true, 'Focus did not return to the dialog');
  await page.keyboard.press('Escape'); assert.equal(await dialog.count(), 0);
  assert.equal(await page.evaluate(() => document.activeElement?.textContent), en.chooseImage);
  console.log('PASS library retry and native modal keyboard/focus');

  await openPicker(); failUpload = true;
  await dialog.locator('input[type=file]').setInputFiles({ name: 'broken.png', mimeType: 'image/png', buffer: png });
  await dialog.getByRole('alert').waitFor(); assert.match(await dialog.getByRole('alert').textContent(), /upload failure/);
  assert.equal(await dialog.getByRole('button', { name: en.uploadImage, exact: true }).isEnabled(), true);
  await page.screenshot({ path: path.join(artefacts, 'desktop-upload-error.png'), fullPage: true });
  failUpload = false; hold = 'upload';
  await dialog.locator('input[type=file]').setInputFiles({ name: 'deferred.png', mimeType: 'image/png', buffer: png });
  await eventually(() => gates.some(g => g.kind === 'upload'), 'Upload was not deferred');
  assert.equal(await dialog.getByRole('button', { name: longName, exact: true }).isDisabled(), true);
  assert.equal(await dialog.locator('input[type=file]').isDisabled(), true);
  await page.keyboard.press('Escape'); await openPicker(1);
  await dialog.getByRole('button', { name: longName, exact: true }).waitFor();
  await release('upload'); await page.waitForTimeout(150);
  assert.equal(await dialog.count(), 1, 'Late upload closed a later picker');
  await dialog.getByRole('button', { name: longName, exact: true }).click();
  const imageFields = form.locator('.portal-image-picker-row input');
  assert.equal(await imageFields.nth(0).inputValue(), '/portal/auth-library.jpg');
  assert.equal(await imageFields.nth(1).inputValue(), '/api/portal-media/existing');
  console.log('PASS visible upload failure, upload lock and discarded late upload');

  await openPicker(); await dialog.locator('input[type=file]').setInputFiles({ name: 'success.png', mimeType: 'image/png', buffer: png });
  await eventually(async () => await dialog.count() === 0, 'Successful upload did not close picker');
  assert.equal(await imageFields.first().inputValue(), '/api/portal-media/uploaded');
  await form.locator('.portal-i18n-toolbar select').selectOption('zh-CN');
  assert.equal(await imageFields.first().inputValue(), '/api/portal-media/uploaded', 'Uploaded image not shared across languages');

  await page.setViewportSize({ width: 390, height: 844 }); await openPicker();
  await dialog.getByRole('button', { name: longName, exact: true }).waitFor();
  const dimensions = await dialog.evaluate(el => ({ width: el.clientWidth, scroll: el.scrollWidth, body: document.documentElement.scrollWidth, viewport: innerWidth }));
  assert.ok(dimensions.scroll <= dimensions.width + 1, JSON.stringify(dimensions));
  assert.ok(dimensions.body <= dimensions.viewport, JSON.stringify(dimensions));
  await page.screenshot({ path: path.join(artefacts, 'mobile-library.png'), fullPage: true });
  await page.keyboard.press('Escape'); await page.evaluate(() => window.cmsLocale('zh-CN'));
  await form.getByRole('button', { name: zh.chooseImage, exact: true }).first().click(); await dialog.waitFor();
  await dialog.getByRole('button', { name: zh.uploadImage, exact: true }).waitFor();
  await page.screenshot({ path: path.join(artefacts, 'mobile-library-zh.png'), fullPage: true });
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.cmsLocale('en-GB'));
  hold = 'translate'; await form.getByRole('button', { name: en.translateOnce, exact: true }).click();
  await eventually(() => gates.some(g => g.kind === 'translate'), 'Unmount translation was not deferred');
  await page.evaluate(() => window.cmsVisible(false)); await form.waitFor({ state: 'detached' });
  await release('translate'); await page.evaluate(() => window.cmsVisible(true));
  await heading().waitFor(); assert.notEqual(await heading().inputValue(), 'Synthetic translated heading');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, mode: 'synthetic-deferred-frontend-only', liveProviderCalls: 0, appServersTouched: 0, requests: requests.map(r => r.kind), dimensions, artefacts, errors }, null, 2));
} finally {
  gates.forEach(gate => gate.release()); await browser.close();
}
