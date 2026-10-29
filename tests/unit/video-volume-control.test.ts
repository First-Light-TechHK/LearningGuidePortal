import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';

// The learner asked for volume adjustment on the shared lesson player. The
// slider must drive the media element, stay in step with the existing mute
// action, and leave the seek bar as the only time control.
test('shared video toolbar adjusts volume and keeps seek and mute in step', async () => {
  const bundle = await build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {ControlledVideo} from './components/portal/ControlledVideo'; window.mount = locale => createRoot(document.getElementById('root')).render(React.createElement(ControlledVideo, {locale}));`, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, tsconfig: 'tsconfig.json' });
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
  const near = (actual: number, expected: number) => Math.abs(actual - expected) < 0.02;
  const mediaVolume = (page: import('playwright').Page) => page.locator('video').evaluate(video => (video as HTMLVideoElement).volume);
  const mediaMuted = (page: import('playwright').Page) => page.locator('video').evaluate(video => (video as HTMLVideoElement).muted);
  // Chrome dispatches volumechange on a later task, so the toolbar re-renders
  // one tick after the media element changes. Wait for that rather than racing it.
  const volumeShows = (page: import('playwright').Page, percent: string) => page.waitForFunction(
    value => document.querySelector('.la-video-volume-range')?.getAttribute('aria-valuetext') === value, percent);
  const volumeValue = (page: import('playwright').Page, value: string) => page.waitForFunction(
    expected => (document.querySelector('.la-video-volume-range') as HTMLInputElement | null)?.value === expected, value);
  try {
    for (const locale of ['en-GB', 'zh-CN']) {
      const copy = locale === 'zh-CN'
        ? { volume: '音量', mute: '静音', unmute: '取消静音', seek: '播放进度' }
        : { volume: 'Volume', mute: 'Mute', unmute: 'Unmute', seek: 'Seek' };
      const page = await browser.newPage();
      await page.setContent('<div id="root"></div>');
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      await page.evaluate(locale => (window as unknown as { mount: (locale: string) => void }).mount(locale), locale);

      const volume = page.getByRole('slider', { name: copy.volume, exact: true });
      await volume.waitFor();
      // Exactly one volume slider; the seek bar keeps its own identity so the
      // two ranges cannot be confused by a keyboard or automation.
      assert.equal(await page.locator('.la-video-volume-range').count(), 1);
      assert.equal(await page.locator('.la-video-controls input[type="range"]').count(), 2);
      assert.equal(await volume.inputValue(), '1');
      assert.equal(await mediaVolume(page), 1);
      assert.equal(await mediaMuted(page), false);

      await volume.fill('0.4');
      assert(near(await mediaVolume(page), 0.4), 'slider drives the media volume');
      assert.equal(await mediaMuted(page), false, 'raising volume leaves the video audible');
      await volumeShows(page, '40%');
      assert.equal(await volume.getAttribute('aria-valuetext'), '40%');

      await volume.fill('0');
      assert.equal(await mediaMuted(page), true, 'zero volume mutes the video');
      await volumeShows(page, '0%');
      assert.equal(await volume.getAttribute('aria-valuetext'), '0%');

      // Mute restores an audible level instead of leaving the learner at zero.
      await page.getByRole('button', { name: copy.unmute, exact: true }).click();
      assert.equal(await mediaMuted(page), false);
      assert(near(await mediaVolume(page), 0.6), 'unmuting from zero restores an audible level');
      await volumeShows(page, '60%');
      assert.equal(await volume.getAttribute('aria-valuetext'), '60%');

      await page.getByRole('button', { name: copy.mute, exact: true }).click();
      assert.equal(await mediaMuted(page), true, 'the mute action still mutes');
      await volumeValue(page, '0');
      assert.equal(await volume.inputValue(), '0', 'the slider reflects the muted state');
      await page.getByRole('button', { name: copy.unmute, exact: true }).click();
      assert.equal(await mediaMuted(page), false);
      await volumeValue(page, '0.6');

      // Keyboard adjustment works without a pointer.
      await volume.focus();
      const before = await mediaVolume(page);
      await volume.press('ArrowRight');
      assert(near(await mediaVolume(page), before + 0.05), 'arrow keys change the volume level');

      // Seeking must not disturb the chosen volume, and the two ranges stay
      // separate controls rather than one shared slider.
      const seek = page.getByRole('slider', { name: copy.seek, exact: true });
      await seek.waitFor();
      assert.equal(await seek.inputValue(), '0', 'the seek bar starts at the beginning');
      await seek.focus();
      await seek.press('End');
      await volume.fill('0.3');
      await volumeShows(page, '30%');
      assert(near(await mediaVolume(page), 0.3), 'the volume slider still works after seeking');
      assert.equal(await mediaMuted(page), false);
      assert.equal(await seek.inputValue(), '0', 'changing the volume does not move the seek bar');

      assert.equal(await page.getByRole('status').count(), 0, 'volume changes stay silent in the UI');
      assert.equal(await page.getByRole('alert').count(), 0);
      await page.close();
    }
  } finally { await browser.close(); }
});
