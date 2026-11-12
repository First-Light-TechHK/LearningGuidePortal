import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';

test('language switching waits for the live video checkpoint, including completed replay at zero', async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
    import React,{useRef} from 'react';import {createRoot} from 'react-dom/client';
    import {PortalLanguageLink} from './components/portal/PortalLanguageLink';import {useLessonBookmarks} from './components/portal/useLessonBookmarks';
    function App(){const root=useRef(null);useLessonBookmarks({root,courseId:'course',lessonId:'lesson',mode:'video',enabled:true,ownerId:'owner',contents:[],restorePolicy:'start',initial:{bookmarks:{},versions:{lesson:{video:'v'}}},onRestoreContent:()=>{}});return <><PortalLanguageLink locale={location.pathname.startsWith('/en-GB')?'en-GB':'zh-CN'} label="Language"/><div ref={root}><video className="la-lesson-video" data-bookmark-content-id="v1"/></div></>};createRoot(document.getElementById('root')).render(<App/>);` },
    bundle: true, write: false, platform: 'browser', jsx: 'automatic', plugins: [{ name: 'next', setup(b) {
      b.onResolve({ filter: /^next\// }, a => ({ path: a.path, namespace: 'next' }));
      b.onLoad({ filter: /.*/, namespace: 'next' }, a => ({ loader: 'tsx', resolveDir: process.cwd(), contents: a.path === 'next/navigation'
        ? 'export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams(location.search)'
        : 'import React from "react";export default function Link({prefetch,...p}){return <a {...p}/>;}' }));
    } }] });
  const browser = await chromium.launch();
  try { for (const locale of ['en-GB', 'zh-CN']) for (const position of [0, 12.345]) {
    const page = await browser.newPage(); let saved = false; let checkpoint: any;
    await page.route('http://language.test/**', async route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/study/bookmarks') {
        checkpoint = route.request().postDataJSON();
        await new Promise(resolve => setTimeout(resolve, 150)); saved = true;
        return route.fulfill({ json: { ok: true, data: { ...checkpoint, revision: 1, lpNumber: '1.1', updatedAt: new Date().toISOString() } } });
      }
      if (url.pathname === '/api/me/locale') return route.fulfill({ json: { ok: true } });
      if (url.searchParams.has('resume')) assert.equal(saved, true, 'the new server request follows the successful checkpoint');
      return route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' });
    });
    await page.goto(`http://language.test/${locale}/account/learn/course?lessonId=lesson&viewMode=text&contentId=old`);
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.locator('video').waitFor();
    await page.locator('video').evaluate((video, position) => {
      Object.defineProperty(video, 'currentTime', { configurable: true, value: position });
    }, position);
    await page.locator('.portal-language').click();
    await page.waitForURL('**/*resume=1');
    assert.equal(checkpoint.positionMs, Math.round(position * 1000));
    assert.equal(new URL(page.url()).searchParams.has('viewMode'), false);
    assert.equal(new URL(page.url()).searchParams.get('lessonId'), 'lesson');
    await page.close();
  } } finally { await browser.close(); }
});
