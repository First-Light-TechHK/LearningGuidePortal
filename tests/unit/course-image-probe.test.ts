// @ts-nocheck -- the release entry point is intentionally executable plain ESM.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { checkImage } from '../../scripts/release/course-browser.mjs';

test('image acceptance waits for intrinsic dimensions but rejects hidden and corrupt images', { timeout: 15_000 }, async t => {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="teal"/></svg>';
  await page.route('https://fixture.test/**', async route => {
    await new Promise(resolve => setTimeout(resolve, 500));
    await route.fulfill({ contentType: 'image/svg+xml', body: route.request().url().endsWith('/broken.svg') ? 'invalid' : svg });
  });
  await page.setContent('<dialog open><header>Source exhibit</header><div style="width:500px"><img style="display:block;width:100%;max-height:65vh;object-fit:contain"></div></dialog>');
  const image = page.locator('img');
  await image.evaluate(element => { element.src = 'https://fixture.test/slow.svg'; });
  assert.equal(await image.isVisible(), false, 'the undecoded exhibit initially has zero intrinsic height');
  assert.equal(await checkImage(image, Date.now() + 3_000), 'https://fixture.test/slow.svg');
  await image.evaluate(element => { element.style.visibility = 'hidden'; });
  await assert.rejects(checkImage(image, Date.now() + 3_000), error => error.code === 'image_not_visible');
  await image.evaluate(element => { element.style.visibility = 'visible'; element.src = 'https://fixture.test/broken.svg'; });
  await assert.rejects(checkImage(image, Date.now() + 3_000), error => error.code === 'image_decode_failed');
});
