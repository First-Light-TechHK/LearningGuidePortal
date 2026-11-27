import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright";
import type { Route } from "playwright";
import type { CourseModeSnapshot } from "../../contracts/course-learning-mode";

async function buildSync() {
  return build({ stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import {OverviewModeSync} from './components/portal/OverviewModeSync';const root=createRoot(document.getElementById('root'));window.refreshCount=0;window.mount=p=>flushSync(()=>root.render(p?<OverviewModeSync {...p}/>:null));` }, bundle: true, write: false, platform: "browser", jsx: "automatic", plugins: [{ name: "router", setup(builder) {
    builder.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "router", namespace: "router" }));
    builder.onLoad({ filter: /.*/, namespace: "router" }, () => ({ contents: "const router={refresh(){window.refreshCount++}};export const useRouter=()=>router" }));
  } }] });
}

test("cached My Learning refreshes changed course modes once and retains cards on failed reads", async () => {
  const bundle = await buildSync();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    let current = "text", failure: "http" | "network" | "invalid" | null = null, userId = "owner";
    let study: Partial<CourseModeSnapshot> = {};
    let additional: CourseModeSnapshot[] = [];
    await page.route("http://mode-sync.test/**", async route => {
      if (new URL(route.request().url()).pathname.startsWith("/api/")) {
        if (failure === "network") return route.abort();
        return route.fulfill({ status: failure === "http" ? 503 : 200, json: { ok: true, user: { id: userId }, overview: { courses: [{ courseId: "course", mode: failure === "invalid" ? "bad" : current, ...study, courseStatus: "published" }, ...additional.map(course => ({ ...course, courseStatus: "published" })), { courseId: "withdrawn", mode: "video", courseStatus: "draft" }] } } });
      }
      return route.fulfill({ contentType: "text/html", body: "<!doctype html><div id='root'></div>" });
    });
    await page.goto("http://mode-sync.test");await page.addScriptTag({ content: "window.__name=value=>value" });await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const mount = async (mode: string, id = "owner") => {
      const response = page.waitForResponse(response => response.url().includes("/api/"));
      await page.evaluate(props => (window as unknown as { mount: (p: unknown) => void }).mount(props), { userId: id, courses: [{ courseId: "course", mode, ...study }, ...additional] });
      await response;await page.waitForLoadState("networkidle");
    };
    const check = async (back = false, expectsRequest = true) => {
      if (!expectsRequest) {
        await page.evaluate(() => dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
        await page.waitForTimeout(1400);
        return;
      }
      const response = failure === "network" ? page.waitForEvent("requestfailed") : page.waitForResponse(response => response.url().includes("/api/"));
      if (back) {
        await page.evaluate(() => history.pushState({}, '', '/lesson'));
        await page.goBack();
      } else await page.evaluate(() => dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
      await response;await page.waitForLoadState("networkidle");
    };
    const count = () => page.evaluate(() => (window as unknown as { refreshCount: number }).refreshCount);
    // refreshCount only moves forward (0 -> 1 -> 2), and the refresh runs in an effect
    // that React commits after the API response settles. A single read right after
    // `check()` therefore raced that commit and failed only on the slower CI runner.
    // Waiting keeps "it must reach N, and not exceed N" without depending on scheduling.
    const waitForCount = async (expected: number) => {
      await page.waitForFunction(n => (window as unknown as { refreshCount: number }).refreshCount >= n, expected, { timeout: 5_000 });
      assert.equal(await count(), expected);
    };
    await mount("text");assert.equal(await count(), 0);
    current = "video";await check(true);await waitForCount(1);
    await check(false, false);await waitForCount(1);
    await mount("video");await check();await waitForCount(1);
    for (const error of ["http", "network", "invalid"] as const) { failure = error;await check();await waitForCount(1); }
    failure = null;userId = "other";await check();await waitForCount(2);
    await mount("video", "other");
    // Same course and mode: each lesson/point/progress change must invalidate the cached card.
    let expected = 2;
    for (const change of [{ currentLessonId: "lesson-2" }, { currentLessonId: "lesson-3" }, { currentLessonId: "lesson-1" }, { currentContentId: "point-2" }, { progress: 65 }, { updatedAt: "2026-11-02T08:00:00.000Z" }, { bookmarkRevision: 1 }, { completedLessonIds: ["lesson-1"] }, { preferredMode: "video" as const }]) {
      study = { ...study, ...change };
      await check();await waitForCount(++expected);
      await check(false, false);await waitForCount(expected);
      await mount("video", "other");await check();await waitForCount(expected);
    }
    additional = [{ courseId: "second", mode: "text" }, { courseId: "third", mode: "video" }];
    await check();await waitForCount(++expected);await mount("video", "other");
    additional.reverse();await check();await waitForCount(expected);
    await check(true);
    study = {...study, updatedAt: "2026-11-14T08:00:00.000Z"};
    await waitForCount(++expected);
    assert.equal(await page.locator("#root").innerHTML(), "");
  } finally { await browser.close(); }
});

test("Overview coalesces slow reads and restoration events, stops after refresh and discards obsolete sessions", async () => {
  const bundle = await buildSync();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const requests: Route[] = [], failures: string[] = [];
    const initial: CourseModeSnapshot = { courseId: "course", mode: "text", currentLessonId: "lesson-1" };
    const updated = { ...initial, currentLessonId: "lesson-2", updatedAt: "2026-11-17T04:00:00Z" };
    const payload = (course: CourseModeSnapshot = updated, userId = "owner") => ({ ok: true, user: { id: userId }, overview: { courses: [{ ...course, courseStatus: "published" }] } });
    const api = (url: string) => url.includes("/api/my-learning/overview");
    let autoAnswer = false;
    page.on("requestfailed", request => { if (api(request.url())) failures.push(request.failure()?.errorText || "failed"); });
    await page.route("http://overview-slow.test/**", route => {
      if (api(route.request().url())) {
        requests.push(route);
        if (autoAnswer) return route.fulfill({ json: payload() });
        return;
      }
      return route.fulfill({ contentType: "text/html", body: "<div id='root'></div>" });
    });
    await page.goto("http://overview-slow.test/en-GB/account/my-learning");
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const mount = (course = initial, userId = "owner") => page.evaluate(props => (window as any).mount(props), { userId, courses: [course] });
    const waitRequests = async (count: number) => {
      const deadline = Date.now() + 5000;
      while (requests.length < count && Date.now() < deadline) await page.waitForTimeout(20);
      assert.equal(requests.length, count);
    };
    const answer = async (index: number, course: CourseModeSnapshot = updated, status = 200) => {
      const finished = page.waitForEvent("requestfinished", request => request === requests[index].request());
      await requests[index].fulfill({ status, json: status === 401 ? { ok: false } : payload(course) });
      await finished;
    };
    const restore = () => page.evaluate(() => {
      dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
      dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    });
    await mount();await waitRequests(1);await page.waitForTimeout(1700);
    assert.equal(requests.length, 1, "initial entry performs only one read even beyond 1.6 seconds");
    assert.deepEqual(failures, []);
    await answer(0, initial);
    await restore();await waitRequests(2);await page.waitForTimeout(1700);
    assert.equal(requests.length, 2, "both retry deadlines and overlapping events preserve the active read");
    assert.deepEqual(failures, []);
    await answer(1, initial);await waitRequests(3);
    await answer(2);
    await page.waitForFunction(() => (window as any).refreshCount === 1);
    await restore();await page.waitForTimeout(1400);
    assert.equal(requests.length, 3, "one trailing read sees the late checkpoint and refresh ends queued work");
    assert.deepEqual(failures, []);

    await mount(updated);await waitRequests(4);
    const cancelled = page.waitForEvent("requestfailed", request => request === requests[3].request());
    await page.evaluate(() => { history.pushState({}, "", "/lesson");dispatchEvent(new PopStateEvent("popstate")); });
    await cancelled;
    await requests[3].fulfill({ status: 401, json: { ok: false } }).catch(() => {});
    await page.waitForTimeout(1400);
    assert.equal(requests.length, 4);
    assert.equal(await page.evaluate(() => (window as any).refreshCount), 1, "late session expiry cannot refresh another page");
    assert.equal(failures.length, 1);

    await page.evaluate(() => { (window as any).mount(null);history.replaceState({}, "", "/en-GB/account/my-learning"); });
    autoAnswer = true;
    await mount(updated);await waitRequests(5);await page.waitForLoadState("networkidle");
    await page.evaluate(() => dispatchEvent(new Event("focus")));
    await page.waitForTimeout(20);
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await page.waitForTimeout(20);
    await page.evaluate(() => dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
    await waitRequests(6);await page.waitForTimeout(1400);
    assert.equal(requests.length, 8, "nearby events share one bounded cycle even with fast responses");

    autoAnswer = false;
    await restore();await waitRequests(9);await page.waitForTimeout(1400);
    assert.equal(requests.length, 9);
    await answer(8, updated, 401);
    await page.waitForFunction(() => (window as any).refreshCount === 2);
    await restore();await page.waitForTimeout(1400);
    assert.equal(requests.length, 9, "401 refreshes once and drops pending reads");

    await mount(updated, "other");await waitRequests(10);
    const unmounted = page.waitForEvent("requestfailed", request => request === requests[9].request());
    await page.evaluate(() => (window as any).mount(null));await unmounted;
    await requests[9].fulfill({ json: payload(initial) }).catch(() => {});
    await page.waitForTimeout(1400);
    assert.equal(requests.length, 10);
    assert.equal(await page.evaluate(() => (window as any).refreshCount), 2, "an old identity's response cannot refresh after cleanup");
    assert.equal(failures.length, 2, "only leaving or cleanup cancels a request");

    await mount(updated);await waitRequests(11);await answer(10, updated, 503);
    await page.waitForTimeout(1400);
    assert.equal(requests.length, 11, "a failed initial check does not start automatic retries");
    assert.equal(await page.evaluate(() => (window as any).refreshCount), 2);
  } finally { await browser.close(); }
});
