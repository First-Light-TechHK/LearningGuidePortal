import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright";
import type { Route } from "playwright";

async function buildSync() {
  return build({
    stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import {CourseDetailSync} from './components/portal/CourseDetailSync';const root=createRoot(document.getElementById('root'));window.mount=p=>flushSync(()=>root.render(p?<CourseDetailSync {...p}/>:null));window.refreshCount=0;` },
    bundle: true, write: false, platform: "browser", jsx: "automatic",
    plugins: [{ name: "router", setup(builder) {
      builder.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "router", namespace: "router" }));
      builder.onLoad({ filter: /.*/, namespace: "router" }, () => ({ contents: "const router={refresh(){window.refreshCount++}};export const useRouter=()=>router" }));
    } }],
  });
}

test("course restoration refreshes changed Study/access once and keeps the current page on failed or aborted reads", async () => {
  const bundle = await buildSync();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const initial = { pageState: "available", cta: "continue_learning", actionLessonId: "one", progress: 14, openedLearningPointCount: 1, bookmarkRevision: 0, preferredMode: null as null | "video" | "text", syllabus: [] as Array<{lessonId:string;continuable?:boolean;completed?:boolean}> };
    let current = { ...initial }, failure: "http" | "network" | "malformed" | null = null;
    let release: (() => Promise<void>) | undefined, delay = false;
    await page.route("http://detail-sync.test/**", async route => {
      if (new URL(route.request().url()).pathname.startsWith("/api/portal/courses/")) {
        const answer = () => route.fulfill({ status: failure === "http" ? 503 : 200, json: failure === "malformed" ? { ok: true, page: {} } : { ok: true, page: current } });
        if (delay) { release = answer;return; }
        if (failure === "network") return route.abort();
        return answer();
      }
      return route.fulfill({ contentType: "text/html", body: "<!doctype html><div id='root'></div>" });
    });
    await page.goto("http://detail-sync.test");
    await page.addScriptTag({ content: "window.__name=value=>value" });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const mount = async (snapshot = initial) => {
      const finished = page.waitForResponse(response => response.url().includes("/api/portal/courses/"));
      await page.evaluate(props => (window as unknown as { mount: (p: unknown) => void }).mount(props), { slug: "modeling-life", snapshot: {...snapshot,continuableLessonIds:snapshot.syllabus.filter(lesson=>lesson.continuable).map(lesson=>lesson.lessonId),completedLessonIds:snapshot.syllabus.filter(lesson=>lesson.completed).map(lesson=>lesson.lessonId)} });
      await finished;await page.waitForLoadState("networkidle");
    };
    const check = async (back = false, expectsRequest = true) => {
      if (!expectsRequest) {
        await page.evaluate(() => dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
        await page.waitForTimeout(1400);
        return;
      }
      const finished = failure === "network"
        ? page.waitForEvent("requestfailed", request => request.url().includes("/api/portal/courses/"))
        : page.waitForResponse(response => response.url().includes("/api/portal/courses/"));
      if (back) {
        await page.evaluate(() => history.pushState({}, '', '/lesson'));
        await page.goBack();
      } else await page.evaluate(() => dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
      await finished;await page.waitForLoadState("networkidle");
    };
    const refreshes = () => page.evaluate(() => (window as unknown as { refreshCount: number }).refreshCount);
    // router.refresh() runs after the response body is parsed, so refreshCount can
    // move *after* networkidle resolves. Reading it on the next line therefore raced
    // the refresh and failed only on the slower CI runner (0 !== 1). Waiting for the
    // expected count and then asserting equality keeps both guarantees -- it must
    // refresh, and must not refresh twice -- without assuming the runner's timing.
    const waitRefreshes = async (expected: number, message?: string) => {
      await page.waitForFunction(n => (window as unknown as { refreshCount: number }).refreshCount >= n, expected, { timeout: 5_000 });
      assert.equal(await refreshes(), expected, message);
    };
    await mount();await page.waitForLoadState("networkidle");assert.equal(await refreshes(), 0);
    current = { ...initial, actionLessonId: "two", progress: 86, openedLearningPointCount: 6 };
    await check(true);await waitRefreshes(1, "the browser Back button reconciles a retained Course page without pageshow/focus");
    await check(false, false);await waitRefreshes(1, "a stale snapshot requests only one server refresh");
    await mount(current);await page.waitForLoadState("networkidle");await check();await waitRefreshes(1, "the updated snapshot does not loop");
    current={...current,syllabus:[{lessonId:'two',continuable:true}]};
    await check();await waitRefreshes(2,'a new checkpoint refreshes Continue even when the Lesson and open count stay the same');
    await mount(current);await check();await waitRefreshes(2,'the updated Continue snapshot does not loop');
    current={...current,syllabus:[{lessonId:'two',completed:true}]};
    await check();await waitRefreshes(3,'completion refreshes Continue into Review with unchanged cursor and open count');
    await mount(current);await check();await waitRefreshes(3,'the Review snapshot does not loop');
    for (const error of ["http", "network", "malformed"] as const) {
      failure = error;await check();await waitRefreshes(3, "transient/invalid responses retain the current render");
    }
    failure = null;delay = true;
    const pending = page.waitForRequest(request => request.url().includes("/api/portal/courses/"));
    await page.evaluate(() => dispatchEvent(new Event("focus")));await pending;
    await page.evaluate(() => (window as unknown as { mount: (p: null) => void }).mount(null));
    assert.ok(release);current = { ...initial, cta: "continue_preview" };await release!();await page.waitForLoadState("networkidle");
    await waitRefreshes(3, "a response after unmount cannot refresh another page");
    delay = false;await mount(initial);await page.waitForLoadState("networkidle");
    await waitRefreshes(4, "changed access is refreshed through the same server-owned snapshot");
    await mount(current);
    current = {...current, bookmarkRevision:1};
    await check(true);await waitRefreshes(5, "an advanced bookmark refreshes even when Lesson, Continue and completion flags are unchanged");
    await mount(current);
    // The first read sees the old revision while the departing Lesson's save is in flight.
    await check(true);
    current = {...current, bookmarkRevision:2};
    await waitRefreshes(6, "bounded restoration rechecks pick up a late pagehide bookmark save");
    await mount(current);await check(true);await waitRefreshes(6, "the accepted revision does not refresh repeatedly");
    current = { ...current, preferredMode: "video" };
    await check();await waitRefreshes(7, "changing only the Course preference refreshes the curriculum");
    assert.equal(await page.locator("#root").innerHTML(), "", "reconciliation adds no UI or progress notices");
  } finally { await browser.close(); }
});

test("course sync lets slow reads finish, coalesces restoration demand and cancels only on leaving", async () => {
  const bundle = await buildSync();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const requests: Route[] = [], failures: string[] = [];
    let autoAnswer = false;
    const initial = { pageState: "available", cta: "continue_learning", actionLessonId: "one", progress: 0, openedLearningPointCount: 0, bookmarkRevision: 0, syllabus: [] };
    const api = (url: string) => url.includes("/api/portal/courses/");
    page.on("requestfailed", request => { if (api(request.url())) failures.push(request.failure()?.errorText || "failed"); });
    await page.route("http://detail-slow.test/**", route => {
      if (api(route.request().url())) {
        requests.push(route);
        if (autoAnswer) return route.fulfill({ json: { ok: true, page: { ...initial, bookmarkRevision: 2 } } });
        return;
      }
      return route.fulfill({ contentType: "text/html", body: "<div id='root'></div>" });
    });
    await page.goto("http://detail-slow.test/course");
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const mount = (revision: number) => page.evaluate(snapshot => (window as any).mount({ slug: "modeling-life", snapshot }), { ...initial, bookmarkRevision: revision });
    const waitRequests = async (count: number) => {
      const deadline = Date.now() + 5000;
      while (requests.length < count && Date.now() < deadline) await page.waitForTimeout(20);
      assert.equal(requests.length, count);
    };
    const answer = async (index: number, revision = 0, status = 200) => {
      const finished = page.waitForEvent("requestfinished", request => request === requests[index].request());
      await requests[index].fulfill({ status, json: { ok: true, page: { ...initial, bookmarkRevision: revision } } });
      await finished;
    };
    await mount(0);await waitRequests(1);
    await page.waitForTimeout(1700);
    assert.equal(requests.length, 1, "initial entry performs one check even when it takes over 1.6 seconds");
    assert.deepEqual(failures, [], "timers must not abort the slow initial request");
    await answer(0);
    await page.evaluate(() => {
      dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
      dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    });
    await waitRequests(2);
    await page.waitForTimeout(1700);
    assert.equal(requests.length, 2, "overlapping events and both retry deadlines leave the active read alone");
    assert.deepEqual(failures, []);
    await answer(1);await waitRequests(3);
    // The delayed bookmark has arrived since the preceding request's old snapshot.
    await answer(2, 1);
    await page.waitForFunction(() => (window as any).refreshCount === 1);
    await page.evaluate(() => { dispatchEvent(new Event("focus"));dispatchEvent(new PopStateEvent("popstate")); });
    await page.waitForTimeout(1400);
    assert.equal(requests.length, 3, "one trailing read consumes all queued demand and refresh stops further checks");
    assert.deepEqual(failures, []);

    await mount(1);await waitRequests(4);
    const cancelled = page.waitForEvent("requestfailed", request => request === requests[3].request());
    await page.evaluate(() => { history.pushState({}, "", "/other-course");dispatchEvent(new PopStateEvent("popstate")); });
    await cancelled;
    await requests[3].fulfill({ json: { ok: true, page: { ...initial, bookmarkRevision: 2 } } }).catch(() => {});
    await page.waitForTimeout(1400);
    assert.equal(requests.length, 4, "leaving clears pending work and retries");
    assert.equal(await page.evaluate(() => (window as any).refreshCount), 1, "late responses cannot refresh another page");
    assert.equal(failures.length, 1, "only navigation cancels a request");

    // An unsuccessful initial read does not start an unbounded retry loop.
    await page.evaluate(() => { history.replaceState({}, "", "/course");(window as any).mount(null); });
    await mount(2);await waitRequests(5);await answer(4, 2, 503);
    await page.waitForTimeout(1400);
    assert.equal(requests.length, 5);
    assert.equal(await page.evaluate(() => (window as any).refreshCount), 1);

    autoAnswer = true;
    await page.evaluate(() => dispatchEvent(new Event("focus")));
    await page.waitForTimeout(20);
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await page.waitForTimeout(20);
    await page.evaluate(() => dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
    await waitRequests(6);await page.waitForTimeout(1400);
    assert.equal(requests.length, 8, "fast responses still share one bounded restoration cycle across nearby events");
    assert.equal(await page.evaluate(() => (window as any).refreshCount), 1);
  } finally { await browser.close(); }
});
