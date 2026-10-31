import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';

// The learner asked for volume adjustment on the shared lesson player. The
// Slider and external mute changes share the media element as their source of truth.
test('shared video toolbar adjusts 0–100 volume and keeps seek and mute in step', async () => {
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
      await page.addScriptTag({ content: 'window.__name=value=>value' });
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      await page.evaluate(locale => (window as unknown as { mount: (locale: string) => void }).mount(locale), locale);

      await page.getByRole('button', { name: copy.volume, exact: true }).click();
      const volume = page.getByRole('slider', { name: copy.volume, exact: true });
      await volume.waitFor();
      // Exactly one volume slider; the seek bar keeps its own identity so the
      // two ranges cannot be confused by a keyboard or automation.
      assert.equal(await page.locator('.la-video-volume-range').count(), 1);
      assert.equal(await page.locator('.la-video-controls input[type="range"]').count(), 2);
      assert.equal(await volume.inputValue(), '100');
      assert.equal(await mediaVolume(page), 1);
      assert.equal(await mediaMuted(page), false);

      await volume.fill('40');
      assert(near(await mediaVolume(page), 0.4), 'slider drives the media volume');
      assert.equal(await mediaMuted(page), false, 'raising volume leaves the video audible');
      await volumeShows(page, '40%');
      assert.equal(await volume.getAttribute('aria-valuetext'), '40%');

      await volume.fill('0');
      assert.equal(await mediaMuted(page), true, 'zero volume mutes the video');
      await volumeShows(page, '0%');
      assert.equal(await volume.getAttribute('aria-valuetext'), '0%');

      // Raising zero restores audio at the explicitly selected level.
      await volume.fill('60');
      assert.equal(await mediaMuted(page), false);
      assert(near(await mediaVolume(page), 0.6), 'raising zero restores the chosen audible level');
      await volumeShows(page, '60%');
      assert.equal(await volume.getAttribute('aria-valuetext'), '60%');

      await page.locator('video').evaluate(video => { (video as HTMLVideoElement).muted = true; });
      assert.equal(await mediaMuted(page), true, 'the mute action still mutes');
      await volumeValue(page, '0');
      assert.equal(await volume.inputValue(), '0', 'the slider reflects the muted state');
      await page.locator('video').evaluate(video => { (video as HTMLVideoElement).muted = false; });
      assert.equal(await mediaMuted(page), false);
      await volumeValue(page, '60');

      // Keyboard adjustment works without a pointer.
      await volume.focus();
      const before = await mediaVolume(page);
      await volume.press('ArrowUp');
      assert(near(await mediaVolume(page), before + 0.01), 'arrow keys change the volume by one percent');

      // Seeking must not disturb the chosen volume, and the two ranges stay
      // separate controls rather than one shared slider.
      await page.locator('video').evaluate(video => {
        Object.defineProperty(video, 'duration', { value: 120, configurable: true });
        let time = 0;
        Object.defineProperty(video, 'currentTime', { get: () => time, set: value => { time = value; }, configurable: true });
        video.dispatchEvent(new Event('loadedmetadata'));
      });
      const seek = page.getByRole('slider', { name: copy.seek, exact: true });
      await seek.waitFor();
      await page.waitForFunction(() => !(document.querySelector('.la-video-seek') as HTMLInputElement).disabled);
      assert.equal(await seek.inputValue(), '0', 'the seek bar starts at the beginning');
      await seek.focus();
      await seek.press('End');
      // Leaving the volume group dismisses its panel; reopen it after seeking.
      await page.getByRole('button', { name: copy.volume, exact: true }).click();
      await volume.fill('30');
      await volumeShows(page, '30%');
      assert(near(await mediaVolume(page), 0.3), 'the volume slider still works after seeking');
      assert.equal(await mediaMuted(page), false);
      assert.equal(await seek.inputValue(), '120', 'changing the volume does not move the seek bar');
      assert.equal(await page.locator('video').evaluate(video => (video as HTMLVideoElement).currentTime), 120);

      assert.equal(await page.getByRole('status').count(), 0, 'volume changes stay silent in the UI');
      assert.equal(await page.getByRole('alert').count(), 0);
      await page.close();
    }
  } finally { await browser.close(); }
});

test('volume wheel adjusts native audio without scrolling the page or seeking in either locale', async () => {
  const bundle = await build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {ControlledVideo} from './components/portal/ControlledVideo'; window.mount = locale => createRoot(document.getElementById('root')).render(<div className="la"><ControlledVideo locale={locale} onVolumeChange={() => {window.volumeEvents = (window.volumeEvents || 0) + 1;}} style={{width:'100%',aspectRatio:'16/9'}}/></div>);`, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, tsconfig: 'tsconfig.json' });
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
  try {
    for (const locale of ['en-GB', 'zh-CN']) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      await page.setContent('<body style="margin:0;min-height:3000px"><div id="root" style="width:900px;padding:80px 20px"></div></body>');
      await page.addStyleTag({ content: await readFile('components/portal/lesson-authoring.css', 'utf8') });
      await page.addScriptTag({ content: 'window.__name=value=>value; window.wheelEvents=0; window.addEventListener("wheel", event => {window.wheelEvents++; window.wheelPrevented=event.defaultPrevented;});' });
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      await page.evaluate(locale => (window as any).mount(locale), locale);
      const button = page.getByRole('button', { name: locale === 'zh-CN' ? '音量' : 'Volume', exact: true });
      const slider = page.locator('.la-video-volume-range');
      const mediaState = () => page.locator('video').evaluate(video => ({ volume: Math.round((video as HTMLVideoElement).volume * 100), muted: (video as HTMLVideoElement).muted, time: (video as HTMLVideoElement).currentTime, paused: (video as HTMLVideoElement).paused }));
      const wheel = async (target: import('playwright').Locator, delta: number, expected: number) => {
        await target.hover();
        const before = await page.evaluate(() => ({ count: (window as any).wheelEvents, scroll: window.scrollY }));
        await page.mouse.wheel(0, delta);
        await page.waitForFunction(count => (window as any).wheelEvents > count, before.count);
        await page.waitForFunction(value => document.querySelector('.la-video-volume-range')?.getAttribute('aria-valuetext') === `${value}%`, expected);
        assert.deepEqual(await mediaState(), { volume: expected, muted: expected === 0, time: 0, paused: true });
        assert.equal(await page.evaluate(() => (window as any).wheelPrevented), true, 'wheel over volume prevents page scrolling');
        assert.equal(await page.evaluate(() => window.scrollY), before.scroll);
      };

      await wheel(button, -100, 100); // Upper bound.
      await wheel(button, 100, 95);
      await wheel(slider, 100, 90);
      await wheel(slider, -100, 95);
      await slider.fill('2');
      await wheel(slider, 100, 0); // Lower bound also mutes.
      await wheel(slider, 100, 0);
      await wheel(slider, -100, 5); // Raising from zero restores audio.
      await slider.fill('40');
      await page.locator('video').evaluate(video => { (video as HTMLVideoElement).muted = true; });
      await page.waitForFunction(() => document.querySelector('.la-video-volume-range')?.getAttribute('aria-valuetext') === '0%');
      await wheel(button, -100, 5); // External mute starts from displayed zero.
      await slider.evaluate(element => {
        for (let i = 0; i < 3; i++) element.dispatchEvent(new WheelEvent('wheel', { deltaY: -1, deltaMode: 1, bubbles: true, cancelable: true }));
      });
      await page.waitForFunction(() => document.querySelector('.la-video-volume-range')?.getAttribute('aria-valuetext') === '20%');
      assert.equal((await mediaState()).volume, 20, 'rapid events accumulate against native state');
      const ignored = await slider.evaluate(element => [
        { deltaY: -100, ctrlKey: true }, { deltaX: 100 }, { deltaY: 0 },
      ].map(init => {
        const event = new WheelEvent('wheel', { ...init, bubbles: true, cancelable: true });
        element.dispatchEvent(event);
        return event.defaultPrevented;
      }));
      assert.deepEqual(ignored, [false, false, false], 'zoom and nonvertical input keep their native behavior');
      assert.equal((await mediaState()).volume, 20);
      await page.waitForFunction(() => (window as any).volumeEvents > 0);

      await page.locator('.la-controlled-video').evaluate(element => { (element as any).requestFullscreen = undefined; });
      const fullscreen = page.getByRole('button', { name: locale === 'zh-CN' ? '切换全屏' : 'Toggle fullscreen', exact: true });
      await fullscreen.click();
      await page.locator('.la-video-expanded').waitFor();
      await wheel(button, -100, 25);
      await wheel(slider, 100, 20);
      await fullscreen.click();
      await page.locator('.la-video-expanded').waitFor({ state: 'detached' });

      await page.locator('.la-video-surface').hover();
      await page.mouse.wheel(0, 200);
      await page.waitForFunction(() => window.scrollY > 0);
      assert.equal((await mediaState()).volume, 20, 'wheel elsewhere scrolls without changing audio');
      await page.close();
    }
  } finally { await browser.close(); }
});
