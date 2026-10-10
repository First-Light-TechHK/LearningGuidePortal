import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';

test('shared video toolbar changes speed and localises picture-in-picture states', async () => {
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
      const enter = locale === 'zh-CN' ? '进入画中画' : 'Enter picture-in-picture';
      const exit = locale === 'zh-CN' ? '退出画中画' : 'Exit picture-in-picture';
      await page.getByRole('button', { name: enter, exact: true }).click();
      assert.equal(await page.getByRole('status').textContent(), locale === 'zh-CN' ? '正在以画中画模式播放此视频。' : 'This video is playing in picture-in-picture mode.');
      await page.getByRole('button', { name: exit, exact: true }).click();
      await page.getByRole('button', { name: enter, exact: true }).waitFor();
      assert.equal(await page.getByRole('status').count(), 0);
      await page.locator('video').evaluate(video => { (video as HTMLVideoElement).requestPictureInPicture = async () => { throw new Error('denied'); }; });
      await page.getByRole('button', { name: enter, exact: true }).click();
      assert.equal(await page.getByRole('status').textContent(), locale === 'zh-CN' ? '无法切换画中画，请重试。' : 'Could not switch picture-in-picture. Please try again.');
      await page.close();
    }
  } finally { await browser.close(); }
});
