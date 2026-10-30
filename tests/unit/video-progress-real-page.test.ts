import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { mkdir, readFile } from "node:fs/promises";
import { chromium, expect } from "playwright/test";

type VideoTestWindow = Window & { mountVideo(src: string): void; removeVideo(): void };

test("real short video seeks accurately at endpoints and fractions, cancels drafts and follows playback without timeupdate", { timeout: 120_000 }, async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';
    import {ControlledVideo} from './components/portal/ControlledVideo';
    const root=createRoot(document.getElementById('root'));
    window.mountVideo=src=>root.render(<div className="la"><ControlledVideo className="la-lesson-video" src={src} locale={document.documentElement.lang} muted/></div>);
    window.removeVideo=()=>root.render(null);
  ` }, bundle: true, write: false, platform: "browser", jsx: "automatic" });
  const videoBytes = await readFile("public/portal/text-exhibits/flowers.webm");
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
  const output = "test-results/video-progress"; await mkdir(output, { recursive: true });
  try {
    for (const locale of ["en-GB", "zh-CN"]) for (const touch of [false, true]) {
      const errors: string[] = [];
      const context = await browser.newContext({ viewport: { width: touch ? 390 : 1100, height: 900 }, hasTouch: touch });
      const page = await context.newPage(); page.setDefaultTimeout(8000);
      page.on("pageerror", error => errors.push(error.message));
      await page.route("http://seek.test/**", route => {
        if (!new URL(route.request().url()).pathname.endsWith(".webm")) return route.fulfill({ contentType:"text/html",body:`<html lang="${locale}"><div id="root"></div></html>` });
        const range = route.request().headers().range?.match(/^bytes=(\d+)-(\d*)$/);
        const start = Number(range?.[1] || 0), end = range?.[2] ? Math.min(Number(range[2]),videoBytes.length-1) : videoBytes.length-1;
        return route.fulfill({status:range?206:200,contentType:"video/webm",body:videoBytes.subarray(start,end+1),headers:{"Accept-Ranges":"bytes",...(range?{"Content-Range":`bytes ${start}-${end}/${videoBytes.length}`}:{})}});
      });
      await page.goto("http://seek.test/");
      for (const file of ["app/styles.css", "app/portal-design.css", "components/portal/lesson-authoring.css"]) await page.addStyleTag({ content: await readFile(file, "utf8") });
      await page.addScriptTag({ content: "window.__name=value=>value" });
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      await page.evaluate(() => (window as unknown as VideoTestWindow).mountVideo("/flowers.webm"));
      const seek = page.locator("input.la-video-seek"), video = page.locator("video");
      await expect(seek).toBeEnabled();
      const surface = page.locator('.la-video-surface');
      await surface.click();
      await expect(video).toHaveJSProperty('paused',false);
      await expect(page.locator('[data-video-action="play"]')).toBeVisible();
      await surface.click();
      await expect(video).toHaveJSProperty('paused',true);
      await expect(page.locator('[data-video-action="pause"]')).toBeVisible();
      await page.screenshot({path:`${output}/${locale}-${touch?'touch':'desktop'}-pause-feedback.png`,fullPage:true});
      await expect(page.locator('.la-video-action-feedback')).toHaveCount(0);
      await page.locator('.la-video-volume button').click();
      const volumeSlider=page.locator('.la-video-volume-range');
      await expect(volumeSlider).toBeVisible();
      assert.equal(await volumeSlider.evaluate(el=>getComputedStyle(el).writingMode),'vertical-lr');
      assert.equal(await volumeSlider.evaluate(el=>getComputedStyle(el).width),'24px');
      assert.ok(await volumeSlider.evaluate(el=>el.getBoundingClientRect().height)>=64);
      await volumeSlider.fill('40');await expect(video).toHaveJSProperty('volume',.4);
      await volumeSlider.fill('0');await expect(video).toHaveJSProperty('muted',true);
      await volumeSlider.fill('60');await expect(video).toHaveJSProperty('muted',false);
      await volumeSlider.press('Escape');await expect(volumeSlider).toBeHidden();
      await expect(video).toHaveJSProperty('paused',true);
      await expect(page.locator('.la-video-action-feedback')).toHaveCount(0);
      await surface.focus();await page.keyboard.press('Space');
      await expect(video).toHaveJSProperty('paused',false);
      await expect(page.locator('[data-video-action="play"]')).toBeVisible();
      await page.keyboard.press('Enter');await expect(video).toHaveJSProperty('paused',true);
      await expect(page.locator('[data-video-action="pause"]')).toBeVisible();
      await page.emulateMedia({reducedMotion:'reduce'});
      assert.equal(await page.locator('.la-video-action-feedback').evaluate(el=>getComputedStyle(el).animationName),'la-video-action-fade');
      await expect(page.locator('.la-video-action-feedback')).toHaveCount(0);
      await page.emulateMedia({reducedMotion:'no-preference'});
      await page.locator('.la-video-controls > button').last().click();
      await expect.poll(()=>page.evaluate(()=>Boolean(document.fullscreenElement)||Boolean(document.querySelector('.la-video-expanded')))).toBe(true);
      await surface.click();await expect(video).toHaveJSProperty('paused',false);
      await expect(page.locator('[data-video-action="play"]')).toBeVisible();
      await surface.click();await expect(video).toHaveJSProperty('paused',true);
      await page.locator('.la-video-controls > button').last().click();
      await expect.poll(()=>page.evaluate(()=>Boolean(document.fullscreenElement)||Boolean(document.querySelector('.la-video-expanded')))).toBe(false);

      await seek.focus();await page.keyboard.press('Home');
      await expect.poll(()=>video.evaluate(el=>(el as HTMLVideoElement).currentTime)).toBe(0);
      const total = await video.evaluate(el => (el as HTMLVideoElement).duration); assert.ok(total > 4 && total < 6);
      assert.equal(await seek.inputValue(), "0");
      assert.deepEqual(await seek.evaluate(el => { const css = getComputedStyle(el); return [css.paddingLeft, css.paddingRight, css.borderLeftWidth, css.backgroundColor]; }), ["0px", "0px", "0px", "rgba(0, 0, 0, 0)"]);
      const session = await context.newCDPSession(page);
      const playButton = page.locator('.la-video-controls > button').first();
      await playButton.hover();
      assert.equal(await playButton.evaluate(el=>getComputedStyle(el).backgroundColor),'rgba(255, 255, 255, 0.1)');
      assert.equal(await playButton.evaluate(el=>getComputedStyle(el).color),'rgb(255, 255, 255)');
      const clickFraction = async (fraction: number) => {
        await seek.scrollIntoViewIfNeeded();
        const box = (await seek.boundingBox())!;
        const x = box.x + 8 + (box.width - 16) * fraction, y = box.y + box.height / 2;
        if (touch) { await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] }); await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); }
        else await page.mouse.click(x, y);
        await expect.poll(async () => Math.abs(await video.evaluate(el => (el as HTMLVideoElement).currentTime) - total * fraction), { message: `${locale}/${touch}/${fraction}` }).toBeLessThan(.06).catch(async error => {
          throw new Error(`${String(error)}; input=${await seek.inputValue()}; media=${JSON.stringify(await video.evaluate(element=>{const el=element as HTMLVideoElement;return {time:el.currentTime,seeking:el.seeking,ready:el.readyState,seekable:el.seekable.length,paused:el.paused}}))}`);
        });
        await expect.poll(async () => Math.abs(Number(await seek.inputValue()) - await video.evaluate(el => (el as HTMLVideoElement).currentTime))).toBeLessThan(.04);
        assert.equal(await video.evaluate(el => (el as HTMLVideoElement).paused), true, "seeking does not autoplay a paused video");
      };
      for (const fraction of [0, .25, .5, .75, 1]) await clickFraction(fraction);
      await seek.focus(); await page.keyboard.press("Home"); await expect.poll(() => video.evaluate(el => (el as HTMLVideoElement).currentTime)).toBe(0);
      await page.keyboard.press("ArrowRight"); await expect.poll(async () => Math.abs(await video.evaluate(el => (el as HTMLVideoElement).currentTime) - total / 10)).toBeLessThan(.02);
      // A cancelled pointer gesture discards its draft rather than moving the video.
      const before = await video.evaluate(el => (el as HTMLVideoElement).currentTime);
      const box = (await seek.boundingBox())!, y = box.y + box.height / 2;
      const start = box.x + 8 + (box.width - 16) * .1, end = box.x + 8 + (box.width - 16) * .7;
      if (touch) {
        await session.send("Input.dispatchTouchEvent", { type:"touchStart",touchPoints:[{x:start,y}] });
        await session.send("Input.dispatchTouchEvent", { type:"touchMove",touchPoints:[{x:end,y}] });
      } else { await page.mouse.move(start,y); await page.mouse.down(); await page.mouse.move(end,y,{steps:5}); }
      await seek.evaluate(el => el.dispatchEvent(new PointerEvent("pointercancel", {bubbles:true})));
      if (touch) await session.send("Input.dispatchTouchEvent", {type:"touchEnd",touchPoints:[]}); else await page.mouse.up();
      assert.equal(await video.evaluate(el => (el as HTMLVideoElement).currentTime), before);
      await expect.poll(async () => Math.abs(Number(await seek.inputValue()) - before)).toBeLessThan(.02);
      // Exercise the RAF path with actual decoded media, independently of timeupdate delivery.
      await seek.focus(); await page.keyboard.press("Home");
      await video.evaluate(async el => {
        el.addEventListener("timeupdate", event => event.stopImmediatePropagation(), { capture: true });
        await (el as HTMLVideoElement).play();
      });
      await expect.poll(() => video.evaluate(el => (el as HTMLVideoElement).currentTime)).toBeGreaterThan(.6);
      await expect.poll(async () => Math.abs(Number(await seek.inputValue()) - await video.evaluate(el => (el as HTMLVideoElement).currentTime))).toBeLessThan(.1);
      await video.evaluate(el => (el as HTMLVideoElement).pause());
      await seek.focus(); await expect(page.locator(".la-video-seek-preview")).toBeVisible();
      assert.match(await page.locator(".la-video-seek-preview").textContent() || "", /^\d+:\d{2}\.\d$/);
      await page.screenshot({ path: `${output}/${locale}-${touch ? "touch" : "desktop"}.png`, fullPage: true });
      await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth);
      await page.evaluate(() => (window as unknown as VideoTestWindow).mountVideo("/other.webm"));
      await expect.poll(() => seek.inputValue()).toBe("0");
      await expect(video).toHaveJSProperty("paused", true);
      await page.evaluate(() => (window as unknown as VideoTestWindow).removeVideo());
      await expect(video).toHaveCount(0); assert.deepEqual(errors, []);
      await context.close();
    }
  } finally { await browser.close(); }
});
