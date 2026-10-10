import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';

test('preview viewers without entitlement save an open event, refresh history and cannot complete', async () => {
  const bundle = await build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {PreviewProgress} from './components/portal/PreviewProgress'; createRoot(document.getElementById('root')).render(React.createElement(PreviewProgress, {courseId:'course', lessonId:'public', seconds:60, initialCompleted:false, canComplete:false, copy:{completeLesson:'Complete',completed:'Completed',saveError:'Save failed'}}));`, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, plugins: [{ name: 'router', setup(builder) { builder.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: 'router', namespace: 'mock' })); builder.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: 'export function useRouter(){return {refresh(){window.refreshed=true}}}' })); } }] });
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
  try {
    const page = await browser.newPage();
    const requests: unknown[] = [];
    await page.route('**/api/study/preview', async route => { requests.push(route.request().postDataJSON()); await route.fulfill({ status: 200, contentType: 'application/json', body: '{"record":{"courseId":"course"}}' }); });
    await page.route('http://preview.test/', route => route.fulfill({ body: '<div id="root"></div>', contentType: 'text/html' }));
    await page.goto('http://preview.test/');
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.waitForFunction(() => (window as unknown as {refreshed: boolean}).refreshed);
    assert.deepEqual(requests, [{ courseId: 'course', lessonId: 'public', event: 'open' }]);
    assert.equal(await page.getByRole('button', { name: 'Complete', exact: true }).count(), 0);
    await page.close();
  } finally { await browser.close(); }
});
