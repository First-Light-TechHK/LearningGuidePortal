import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { chromium } from 'playwright';

// Production-built UI with disposable local data; never uses a real account/store.
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = 3027;
const probe = createServer();
await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(port, '127.0.0.1', resolve); });
await new Promise(resolve => probe.close(resolve));
const temporary = await mkdtemp(path.join(tmpdir(), 'lg-home-visual-'));
const output = path.join(repo, 'test-results', 'portal-home');
await mkdir(output, { recursive: true });
const env = { ...process.env, STORAGE_BACKEND: 'local', APP_ENV: 'DEV', PAYMENT_MODE: 'demo', SESSION_SECRET: 'home-visual-test-only-not-a-real-secret', LOCAL_SOCIAL_LOGIN: '0' };
const server = spawn(process.execPath, [path.join(repo, 'node_modules/next/dist/bin/next'), 'start', repo, '-p', String(port), '--hostname', '127.0.0.1'], { cwd: temporary, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
server.stdout.on('data', data => { log += data; });
server.stderr.on('data', data => { log += data; });
let browser;
try {
  const origin = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try { if ((await fetch(`${origin}/api/health`)).ok) { ready = true; break; } } catch {}
    if (server.exitCode !== null) throw new Error(`Preview exited: ${log}`);
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert(ready, `Preview did not start: ${log}`);
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${origin}/en-GB/portal`, { waitUntil: 'networkidle' });
  const cookieChoice = page.getByRole('button', { name: 'Use essential cookies only', exact: true });
  if (await cookieChoice.isVisible()) await cookieChoice.click();
  await page.evaluate(() => document.fonts.ready);
  assert.equal(await page.locator('h1').innerText(), 'Learn with curiosity.\nGrow with confidence.');
  assert.equal(Math.round((await page.locator('.portal-banner').boundingBox()).height), 400);
  assert.equal(await page.locator('.portal-banner-content a').evaluate(node => getComputedStyle(node).color), 'rgb(23, 63, 185)', 'Hero CTA text must remain visible on white');
  const popularCourses = page.locator('.home-course-card');
  assert(await popularCourses.count() > 0, 'Seeded published courses must render');
  assert((await popularCourses.count()) <= 6, 'Popular courses must show at most six cards');
  for (let index = 0; index < 3; index++) {
    await page.getByRole('button', { name: `Banner ${index + 1}`, exact: true }).click();
    assert.match(await page.locator('.portal-banner-image').getAttribute('style'), new RegExp(`banner${index + 1}\\.png`));
    if (index === 0) assert.equal(await page.locator('.portal-banner-content a').getAttribute('href'), '/en-GB/portal/courses');
    if (index === 1) assert.equal(await page.locator('.portal-banner-content a').getAttribute('href'), '/en-GB/portal#why-heading');
    if (index === 2) assert.equal(await page.locator('.portal-banner-content a').getAttribute('href'), '/en-GB/portal/study-groups');
  }
  await page.getByRole('button', { name: 'Banner 1', exact: true }).click();
  assert.equal(await page.locator('body').evaluate(node => node.scrollWidth <= innerWidth), true);
  for (const img of await page.locator('img').all()) await img.scrollIntoViewIfNeeded();
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => scrollTo(0, 0));
  const failedImages = await page.locator('img').evaluateAll(images => images.filter(img => !img.complete || !img.naturalWidth).map(img => ({ remote: new URL(img.src).origin !== location.origin, path: new URL(img.src).pathname })));
  assert.deepEqual(failedImages.filter(image => !image.remote), [], 'All local design assets must load');
  if (failedImages.length) console.log(`NOTE: ${failedImages.length} remote course cover(s) unavailable; static assets passed. Remote URLs are not logged.`);
  await page.screenshot({ path: path.join(output, 'desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.locator('body').evaluate(node => node.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: path.join(output, 'mobile.png'), fullPage: true });
  await page.goto(`${origin}/zh-CN/portal`, { waitUntil: 'networkidle' });
  assert.equal(await page.locator('h1').innerText(), '怀着好奇学习，\n带着自信成长。');
  assert.equal(await page.locator('body').evaluate(node => node.scrollWidth <= innerWidth), true);
  assert.deepEqual(errors, []);
  console.log('PASS homepage: dynamic courses, 3 banners, Courses links, desktop/mobile overflow, images, bilingual copy, no browser errors.');
  console.log(`Screenshots: ${output}`);
} finally {
  await browser?.close();
  if (server.exitCode === null) {
    const exited = new Promise(resolve => server.once('exit', resolve));
    server.kill();
    await exited;
  }
  if (path.dirname(temporary) === tmpdir() && path.basename(temporary).startsWith('lg-home-visual-')) await rm(temporary, { recursive: true, force: true });
}
