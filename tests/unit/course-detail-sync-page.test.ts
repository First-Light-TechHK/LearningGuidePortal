import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright";

test("course restoration refreshes changed Study/access once and keeps the current page on failed or aborted reads", async () => {
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import {CourseDetailSync} from './components/portal/CourseDetailSync';const root=createRoot(document.getElementById('root'));window.mount=p=>flushSync(()=>root.render(p?<CourseDetailSync {...p}/>:null));window.refreshCount=0;` },
    bundle: true, write: false, platform: "browser", jsx: "automatic",
    plugins: [{ name: "router", setup(builder) {
      builder.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "router", namespace: "router" }));
      builder.onLoad({ filter: /.*/, namespace: "router" }, () => ({ contents: "const router={refresh(){window.refreshCount++}};export const useRouter=()=>router" }));
    } }],
  });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const initial = { pageState: "available", cta: "continue_learning", actionLessonId: "one", progress: 14, openedLearningPointCount: 1 };
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
      await page.evaluate(props => (window as unknown as { mount: (p: unknown) => void }).mount(props), { slug: "modeling-life", snapshot });
      await finished;await page.waitForLoadState("networkidle");
    };
    const check = async () => {
      const finished = failure === "network"
        ? page.waitForEvent("requestfailed", request => request.url().includes("/api/portal/courses/"))
        : page.waitForResponse(response => response.url().includes("/api/portal/courses/"));
      await page.evaluate(() => dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
      await finished;await page.waitForLoadState("networkidle");
    };
    const refreshes = () => page.evaluate(() => (window as unknown as { refreshCount: number }).refreshCount);
    await mount();await page.waitForLoadState("networkidle");assert.equal(await refreshes(), 0);
    current = { ...initial, actionLessonId: "two", progress: 86, openedLearningPointCount: 6 };
    await check();assert.equal(await refreshes(), 1);
    await check();assert.equal(await refreshes(), 1, "a stale snapshot requests only one server refresh");
    await mount(current);await page.waitForLoadState("networkidle");await check();assert.equal(await refreshes(), 1, "the updated snapshot does not loop");
    for (const error of ["http", "network", "malformed"] as const) {
      failure = error;await check();assert.equal(await refreshes(), 1, "transient/invalid responses retain the current render");
    }
    failure = null;delay = true;
    const pending = page.waitForRequest(request => request.url().includes("/api/portal/courses/"));
    await page.evaluate(() => dispatchEvent(new Event("focus")));await pending;
    await page.evaluate(() => (window as unknown as { mount: (p: null) => void }).mount(null));
    assert.ok(release);current = { ...initial, cta: "continue_preview" };await release!();await page.waitForLoadState("networkidle");
    assert.equal(await refreshes(), 1, "a response after unmount cannot refresh another page");
    delay = false;await mount(initial);await page.waitForLoadState("networkidle");
    // router.refresh() runs after the response body is parsed, which can land after networkidle under load.
    await page.waitForFunction(() => (window as unknown as { refreshCount: number }).refreshCount >= 2, undefined, { timeout: 5_000 }).catch(() => undefined);
    assert.equal(await refreshes(), 2, "changed access is refreshed through the same server-owned snapshot");
    assert.equal(await page.locator("#root").innerHTML(), "", "reconciliation adds no UI or progress notices");
  } finally { await browser.close(); }
});
