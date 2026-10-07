import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

test('pricing grid and annual term fit narrow screens without clipping purchase controls', { timeout: 30_000 }, async () => {
  const base = await readFile(new URL('../../app/styles.css', import.meta.url), 'utf8');
  const design = await readFile(new URL('../../app/portal-design.css', import.meta.url), 'utf8');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    // This layout fixture uses the application's actual cascade. Deployed
    // acceptance separately checks populated plans and payment behaviour.
    await page.setContent(`<main class="portal-page pricing-design-page"><section class="pricing-design-main">
      <div class="pricing-comparison-wrap"><div class="pricing-term-switch pricing-term-switch-global">
        <button>6 Months</button><button class="pricing-term-year"><span class="pricing-term-year-label">1 Year<span class="pricing-better-value">Better Value</span></span></button>
      </div><div class="pricing-comparison">${['Everything', 'Category'].map(title => `<article class="pricing-design-card">
        <header class="pricing-card-heading"><h2>${title}</h2></header><div class="pricing-card-price"><strong>$99</strong><span>USD</span></div>
        <div class="purchase-panel"><div class="purchase-actions"><button class="portal-button portal-button-primary">Subscribe</button></div></div>
      </article>`).join('')}</div></div></section></main>`);
    await page.addStyleTag({ content: base });
    await page.addStyleTag({ content: design });
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const layout = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth > innerWidth + 1,
        controls: [...document.querySelectorAll('.pricing-term-switch button, .purchase-actions button')].map(element => {
          const rect = element.getBoundingClientRect();
          return { left: rect.left, right: rect.right, width: rect.width };
        }),
        yearWhiteSpace: getComputedStyle(document.querySelector('.pricing-term-year-label')!).whiteSpace,
      }));
      assert.equal(layout.overflow, false, `overflow at ${width}px`);
      assert.ok(layout.controls.every(rect => rect.left >= 0 && rect.right <= width && rect.width >= 44), `clipped control at ${width}px`);
      assert.equal(layout.yearWhiteSpace, 'nowrap');
    }
  } finally { await browser.close(); }
});
