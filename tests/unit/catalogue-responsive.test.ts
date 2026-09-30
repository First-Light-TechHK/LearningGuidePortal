import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

test('catalogue learning-method section fits narrow mobile screens without horizontal scrolling', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent('<main class="portal-page"><section class="portal-section portal-catalog-courses"><div class="portal-course-grid"><article class="portal-course-card">European philosophy</article><article class="portal-course-card">Quintus Horatius Flaccus</article></div></section><section class="courses-design-method"><div><p>THE LEARNING GUIDE METHOD</p><h2>Learn through stories, questions and connections.</h2><p>Every course offers a choice between video and text, designed to keep you actively thinking.</p></div><ol><li>Apply what you learn</li><li>Share your perspective</li><li>See the bigger picture</li></ol></section></main>');
    await page.addStyleTag({ content: readFileSync('app/styles.css', 'utf8') });
    await page.addStyleTag({ content: readFileSync('app/portal-design.css', 'utf8') });
    for (const width of [320, 390, 720]) {
      await page.setViewportSize({ width, height: 844 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `overflow at ${width}px`);
      assert.equal(await page.locator('.courses-design-method li').count(), 3);
      const cards = await page.locator('.portal-course-card').evaluateAll(elements => elements.map(element => ({ width: element.getBoundingClientRect().width, left: element.getBoundingClientRect().left })));
      assert.ok(cards.every(card => card.width >= width - 42), `unreadable card width at ${width}px`);
      assert.equal(cards[0].left, cards[1].left);
    }
  } finally { await browser.close(); }
});
