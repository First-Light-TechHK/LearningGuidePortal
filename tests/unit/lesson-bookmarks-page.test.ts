import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright";

test("video checkpoints every 30 seconds and on pause; text restores the visible paragraph; preview saves nothing", async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
    import React,{useRef} from 'react'; import {createRoot} from 'react-dom/client'; import {flushSync} from 'react-dom';
    import {useLessonBookmarks} from './components/portal/useLessonBookmarks';
    function Harness(p){const root=useRef(null);const resume=useLessonBookmarks({root,courseId:'course',lessonId:p.lessonId||'lesson',mode:p.mode,enabled:p.enabled!==false,ownerId:'owner',initial:p.initial,contents:[],onRestoreContent:()=>{}});
      window.flushBookmark=resume.flush;
      return <div ref={root}>{p.mode==='video'?<video className="la-lesson-video" data-bookmark-content-id="v1"/>:
      <div data-text-reader data-bookmark-ready="true" style={{overflowY:'visible'}}><section data-text-point-id="t1"><div className="la-prose">{Array.from({length:12},(_,i)=><p key={i} data-paragraph={i} style={{height:160,margin:0}}>Paragraph {i}</p>)}</div></section></div>}
      <output>{JSON.stringify(resume.bookmarks)}</output>{resume.error&&<div role="alert">Save failed</div>}</div>}
    const root=createRoot(document.getElementById('root'));window.mount=p=>flushSync(()=>root.render(<Harness key={p.key} {...p}/>));`,
  }, bundle: true, write: false, platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' } });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
    const requests: any[] = []; let fail = false;
    await page.route("http://bookmark.test/**", route => {
      if (route.request().method() === "POST") {
        const body = route.request().postDataJSON(); requests.push(body);
        return route.fulfill({ status: fail ? 503 : 200, json: { ok: !fail, data: { ...body, revision: body.expectedRevision + 1, lpNumber: "1.1", updatedAt: new Date().toISOString() } } });
      }
      return route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' });
    });
    await page.goto("http://bookmark.test"); await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const initial = { bookmarks: {}, versions: { lesson: { video: "video-version", text: "text-version" } } };
    const mount = (props: any) => page.evaluate(props => (window as any).mount(props), { initial, ...props });
    const video = async (time: number, event: string, paused = false) => page.locator("video").evaluate((element, args) => {
      for (const [key, value] of Object.entries({ currentTime: args.time, duration: 300, readyState: 4, paused: args.paused, seeking: false })) Object.defineProperty(element, key, { configurable: true, value });
      element.dispatchEvent(new Event(args.event));
    }, { time, event, paused });
    await mount({ key: "video", mode: "video" });
    await page.clock.install();
    await video(1, "loadedmetadata", true);
    assert.equal(requests.length, 0);
    await video(12.345, "playing");
    await page.clock.runFor(29_999); assert.equal(requests.length, 0);
    await page.clock.runFor(1); await page.waitForFunction(() => document.querySelector("output")!.textContent!.includes('"revision":1'));
    assert.equal(requests[0].positionMs, 12_345);
    await video(8.123, "pause", true); await page.waitForFunction(() => document.querySelector("output")!.textContent!.includes('"revision":2'));
    assert.equal(requests.at(-1).positionMs, 8_123);
    const before = requests.length; await page.clock.runFor(60_000); assert.equal(requests.length, before);
    fail = true; await video(9.25, "playing"); await video(9.25, "pause", true); await page.getByRole("alert").waitFor();
    const failedId = requests.at(-1).clientEventId;
    fail = false; await page.evaluate(() => (window as any).flushBookmark());
    assert.equal(requests.at(-1).clientEventId, failedId, "failed writes retry idempotently");
    await mount({ key: "text", mode: "text" }); await page.clock.runFor(100);
    await page.locator('[data-paragraph="5"]').evaluate(element => window.scrollTo(0, element.getBoundingClientRect().top + window.scrollY + 20));
    await page.clock.runFor(1000); await page.evaluate(() => (window as any).flushBookmark());
    assert.equal(requests.at(-1).paragraphId, "t1:paragraph:5");
    const text = { ...requests.at(-1), revision: 1, updatedAt: new Date().toISOString(), lpNumber: "1.1" };
    await mount({ key: "away", mode: "video" });
    await page.evaluate(() => window.scrollTo(0, 0));
    await mount({ key: "text-restored", mode: "text", initial: { ...initial, bookmarks: { lesson: { text } } } });
    await page.clock.runFor(100);
    assert.ok(Math.abs(await page.locator('[data-paragraph="5"]').evaluate(element => element.getBoundingClientRect().top) - 12) < 2);
    await page.evaluate(() => (window as any).flushBookmark());
    await mount({ key: "preview", mode: "video", enabled: false });
    const previewCount = requests.length;
    await video(88, "playing"); await page.clock.runFor(30_000); await video(90, "pause", true);
    await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
    assert.equal(requests.length, previewCount);
  } finally { await browser.close(); }
});
