import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright";

test("cached My Learning refreshes changed course modes once and retains cards on failed reads", async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import {OverviewModeSync} from './components/portal/OverviewModeSync';const root=createRoot(document.getElementById('root'));window.refreshCount=0;window.mount=p=>flushSync(()=>root.render(<OverviewModeSync {...p}/>));` }, bundle: true, write: false, platform: "browser", jsx: "automatic", plugins: [{ name: "router", setup(builder) {
    builder.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "router", namespace: "router" }));
    builder.onLoad({ filter: /.*/, namespace: "router" }, () => ({ contents: "const router={refresh(){window.refreshCount++}};export const useRouter=()=>router" }));
  } }] });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    let current = "text", failure: "http" | "network" | "invalid" | null = null, userId = "owner";
    await page.route("http://mode-sync.test/**", async route => {
      if (new URL(route.request().url()).pathname.startsWith("/api/")) {
        if (failure === "network") return route.abort();
        return route.fulfill({ status: failure === "http" ? 503 : 200, json: { ok: true, user: { id: userId }, overview: { courses: [{ courseId: "course", mode: failure === "invalid" ? "bad" : current, courseStatus: "published" }, { courseId: "withdrawn", mode: "video", courseStatus: "draft" }] } } });
      }
      return route.fulfill({ contentType: "text/html", body: "<!doctype html><div id='root'></div>" });
    });
    await page.goto("http://mode-sync.test");await page.addScriptTag({ content: "window.__name=value=>value" });await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const mount = async (mode: string, id = "owner") => {
      const response = page.waitForResponse(response => response.url().includes("/api/"));
      await page.evaluate(props => (window as unknown as { mount: (p: unknown) => void }).mount(props), { userId: id, courses: [{ courseId: "course", mode }] });
      await response;await page.waitForLoadState("networkidle");
    };
    const check = async () => {
      const response = failure === "network" ? page.waitForEvent("requestfailed") : page.waitForResponse(response => response.url().includes("/api/"));
      await page.evaluate(() => dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
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
    current = "video";await check();await waitForCount(1);
    await check();await waitForCount(1);
    await mount("video");await check();await waitForCount(1);
    for (const error of ["http", "network", "invalid"] as const) { failure = error;await check();await waitForCount(1); }
    failure = null;userId = "other";await check();await waitForCount(2);
    assert.equal(await page.locator("#root").innerHTML(), "");
  } finally { await browser.close(); }
});
