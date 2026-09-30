import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

test('catalogue learning-method section fits narrow mobile screens without horizontal scrolling', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent('<main><section class="courses-design-method"><div><p>THE LEARNING GUIDE METHOD</p><h2>Learn through stories, questions and connections.</h2><p>Every course offers a choice between video and text, designed to keep you actively thinking.</p></div><ol><li>Apply what you learn</li><li>Share your perspective</li><li>See the bigger picture</li></ol></section></main>');
    await page.addStyleTag({ content: readFileSync('app/portal-design.css', 'utf8') });
    for (const width of [320, 390, 720]) {
      await page.setViewportSize({ width, height: 844 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `overflow at ${width}px`);
      assert.equal(await page.locator('.courses-design-method li').count(), 3);
    }
  } finally { await browser.close(); }
});
