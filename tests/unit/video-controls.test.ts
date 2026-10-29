import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { mkdir, readFile } from 'node:fs/promises';

test('shared video toolbar keeps controls usable without playback or picture-in-picture notices', async () => {
  const bundle = await build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {ControlledVideo} from './components/portal/ControlledVideo'; window.mount = locale => createRoot(document.getElementById('root')).render(React.createElement(ControlledVideo, {locale}));`, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, tsconfig: 'tsconfig.json' });
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
  try {
    for (const locale of ['en-GB', 'zh-CN']) {
      const page = await browser.newPage();
      await page.setContent('<div id="root"></div>');
      await page.evaluate(() => {
        Object.defineProperty(document, 'pictureInPictureEnabled', { value: true, configurable: true });
        HTMLVideoElement.prototype.requestPictureInPicture = async function () {
          Object.defineProperty(document, 'pictureInPictureElement', { value: this, configurable: true });
          this.dispatchEvent(new Event('enterpictureinpicture'));
          return {} as PictureInPictureWindow;
        };
        document.exitPictureInPicture = async () => {
          const video = document.pictureInPictureElement;
          Object.defineProperty(document, 'pictureInPictureElement', { value: null, configurable: true });
          video?.dispatchEvent(new Event('leavepictureinpicture'));
        };
      });
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      await page.evaluate(locale => (window as unknown as {mount: (locale: string) => void}).mount(locale), locale);
      const speed = page.getByRole('combobox', { name: locale === 'zh-CN' ? '播放速度' : 'Playback speed' });
      await speed.selectOption('1.5');
      assert.equal(await page.locator('video').evaluate(video => (video as HTMLVideoElement).playbackRate), 1.5);
      await page.locator('video').evaluate(video => { Object.defineProperty(video, 'duration', { value: 120 }); video.dispatchEvent(new Event('loadedmetadata')); });
      const play = page.getByRole('button', { name: locale === 'zh-CN' ? '播放' : 'Play', exact: true });
      await page.locator('video').evaluate(video => { (video as HTMLVideoElement).play = async () => { throw new DOMException('Interrupted by pause', 'AbortError'); }; });
      await play.click();
      assert.equal(await page.getByRole('status').count(), 0, 'interrupted playback has no operation notice');
      await page.addScriptTag({ content: `(video => {
        let paused = true;
        Object.defineProperty(video, 'paused', { configurable: true, get: () => paused });
        video.play = async () => { paused = false; video.dispatchEvent(new Event('play')); };
        video.pause = () => { paused = true; video.dispatchEvent(new Event('pause')); };
      })(document.querySelector('video'));` });
      await play.click();
      await page.getByRole('button', { name: locale === 'zh-CN' ? '暂停' : 'Pause', exact: true }).click();
      await play.waitFor();
      assert.equal(await page.getByRole('status').count(), 0, 'play and pause remain usable without notices');
      const enter = locale === 'zh-CN' ? '进入画中画' : 'Enter picture-in-picture';
      const exit = locale === 'zh-CN' ? '退出画中画' : 'Exit picture-in-picture';
      await page.getByRole('button', { name: enter, exact: true }).click();
      await page.getByRole('button', { name: exit, exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: exit, exact: true }).getAttribute('aria-pressed'), 'true');
      assert.equal(await page.getByRole('status').count(), 0, 'active picture-in-picture has no notice');
      await page.getByRole('button', { name: exit, exact: true }).click();
      await page.getByRole('button', { name: enter, exact: true }).waitFor();
      assert.equal(await page.getByRole('status').count(), 0);
      await page.locator('video').evaluate(video => { (video as HTMLVideoElement).requestPictureInPicture = async () => { throw new Error('denied'); }; });
      await page.getByRole('button', { name: enter, exact: true }).click();
      assert.equal(await page.getByRole('status').count(), 0, 'picture-in-picture rejection has no notice');
      assert.equal(await page.getByRole('alert').count(), 0);
      await play.click();
      await page.getByRole('button', { name: locale === 'zh-CN' ? '暂停' : 'Pause', exact: true }).waitFor();
      await page.close();
    }
  } finally { await browser.close(); }
});

test('volume button opens a 0–100 slider with zero mute, keyboard/touch control and media state synchronisation', async () => {
  const bundle = await build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {ControlledVideo} from './components/portal/ControlledVideo'; window.mount = locale => createRoot(document.getElementById('root')).render(<div className="la"><ControlledVideo locale={locale} muted onVolumeChange={() => {window.volumeEvents = (window.volumeEvents || 0) + 1;}} style={{width:'100%',aspectRatio:'16/9'}}/></div>);`, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, platform: 'browser', jsx: 'automatic' });
  const browser = await chromium.launch();
  await mkdir('test-results/video-volume', { recursive: true });
  try {
    for (const locale of ['en-GB', 'zh-CN']) for (const touch of [false, true]) {
      const context = await browser.newContext({ viewport: { width: touch ? 390 : 1100, height: 800 }, hasTouch: touch });
      const page = await context.newPage();
      await page.setContent('<div id="root"></div>');
      await page.addScriptTag({ content: 'window.__name=value=>value' });
      await page.addStyleTag({ content: await readFile('components/portal/lesson-authoring.css', 'utf8') });
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      await page.evaluate(locale => (window as any).mount(locale), locale);
      const name = locale === 'zh-CN' ? '音量' : 'Volume';
      const button = page.getByRole('button', { name, exact: true });
      const slider = page.getByRole('slider', { name, exact: true });
      await button.click();
      assert.equal(await button.getAttribute('aria-expanded'), 'true');
      assert.equal(await slider.inputValue(), '0', 'initial muted media is represented as zero');
      assert.equal(await button.locator('.lucide-volume-x').count(), 1);
      await slider.focus();
      await page.keyboard.press('Home');
      await page.keyboard.press('ArrowRight');
      assert.equal(await slider.inputValue(), '1');
      assert.deepEqual(await page.locator('video').evaluate(video => ({ volume: (video as HTMLVideoElement).volume, muted: (video as HTMLVideoElement).muted })), { volume: .01, muted: false });
      await page.keyboard.press('End');
      assert.equal(await slider.inputValue(), '100');
      assert.equal(await page.locator('video').evaluate(video => (video as HTMLVideoElement).volume), 1);
      await page.keyboard.press('Home');
      assert.equal(await slider.inputValue(), '0');
      assert.equal(await page.locator('video').evaluate(video => (video as HTMLVideoElement).muted), true);
      const box = (await slider.boundingBox())!;
      const x = box.x + box.width * .6, y = box.y + box.height / 2;
      if (touch) await page.touchscreen.tap(x, y);
      else { await page.mouse.move(box.x + 8, y); await page.mouse.down(); await page.mouse.move(x, y, { steps: 5 }); await page.mouse.up(); }
      const selected = Number(await slider.inputValue());
      assert.ok(selected > 30 && selected < 90, 'pointer/touch input selects intermediate volume');
      assert.deepEqual(await page.locator('video').evaluate(video => ({ volume: (video as HTMLVideoElement).volume, muted: (video as HTMLVideoElement).muted })), { volume: selected / 100, muted: false });
      await page.locator('video').evaluate(video => { (video as HTMLVideoElement).volume = .37; });
      await page.waitForFunction(() => document.querySelector('.la-video-volume input')?.getAttribute('value') === '37');
      await page.locator('video').evaluate(video => { (video as HTMLVideoElement).muted = true; });
      await page.waitForFunction(() => document.querySelector('.la-video-volume input')?.getAttribute('value') === '0');
      await page.locator('video').evaluate(video => { (video as HTMLVideoElement).muted = false; });
      await page.waitForFunction(() => document.querySelector('.la-video-volume input')?.getAttribute('value') === '37');
      assert.ok(await page.evaluate(() => (window as any).volumeEvents > 0), 'parent volume callback still receives media events');
      const panel = (await page.locator('.la-video-volume-panel').boundingBox())!;
      assert.ok(panel.x >= 0 && panel.x + panel.width <= (touch ? 390 : 1100), 'panel stays inside the viewport');
      assert.ok(box.width > 80 && box.x + box.width < panel.x + panel.width, 'slider and value fit without wrapping');
      await page.screenshot({ path: `test-results/video-volume/${locale}-${touch ? 'mobile' : 'desktop'}.png` });
      await slider.focus();
      await page.keyboard.press('Escape');
      assert.equal(await slider.count(), 0);
      assert.equal(await button.evaluate(element => element === document.activeElement), true);
      await button.click();
      assert.equal(await slider.inputValue(), '37', 'closing and reopening preserves volume');
      await page.locator('video').click();
      assert.equal(await slider.count(), 0, 'outside click dismisses');
      await button.click();
      await slider.focus();
      await page.keyboard.press('Tab');
      assert.equal(await slider.count(), 0, 'tabbing out dismisses');
      await page.locator('.la-controlled-video').evaluate(element => { (element as any).requestFullscreen = undefined; });
      await page.getByRole('button', { name: locale === 'zh-CN' ? '切换全屏' : 'Toggle fullscreen', exact: true }).click();
      await button.click();
      assert.equal(await slider.inputValue(), '37');
      await slider.focus();
      await page.keyboard.press('End');
      assert.equal(await page.locator('video').evaluate(video => (video as HTMLVideoElement).volume), 1, 'fullscreen volume remains usable');
      await context.close();
    }
  } finally { await browser.close(); }
});
