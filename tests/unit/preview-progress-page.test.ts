import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright";
import { getMessages } from "../../lib/i18n/messages";

test("video progress never renders feedback with default display props in either locale or Study endpoint", async () => {
  const bundle = await build({
    stdin: {
      resolveDir: process.cwd(), loader: "tsx",
      contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import {PreviewProgress} from './components/portal/PreviewProgress';const root=createRoot(document.getElementById('root'));window.mount=p=>flushSync(()=>root.render(<PreviewProgress {...p}/>));`,
    },
    bundle: true, write: false, platform: "browser", jsx: "automatic",
    plugins: [{ name: "router", setup(builder) {
      builder.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "router", namespace: "router" }));
      builder.onLoad({ filter: /.*/, namespace: "router" }, () => ({ contents: "export const useRouter=()=>({refresh(){}})" }));
    } }],
  });
  const browser = await chromium.launch();
  try {
    for (const locale of ["en-GB", "zh-CN"] as const) for (const endpoint of ["/api/study/preview", "/api/study/events"]) {
      const page = await browser.newPage();
      const requests: Array<{ contentId: string; event: string; learningMode: string }> = [];
      let failure: "http" | "network" | null = null;
      await page.route("http://progress-feedback.test/**", async route => {
        if (new URL(route.request().url()).pathname === endpoint) {
          requests.push(route.request().postDataJSON());
          if (failure === "network") return route.abort();
          return route.fulfill({ status: failure ? 503 : 200, json: { record: {} } });
        }
        return route.fulfill({ contentType: "text/html", body: "<!doctype html><div id='root'></div>" });
      });
      await page.goto("http://progress-feedback.test/");
      await page.addScriptTag({ content: "window.__name=value=>value" });
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      const copy = { ...getMessages(locale).learning, saveError: getMessages(locale).overviewDesign.previewSaveError };
      const mount = async (contentId: string, learningMode = "video") => {
        const finished = failure === "network"
          ? page.waitForEvent("requestfailed", request => request.url().endsWith(endpoint))
          : page.waitForResponse(response => response.url().endsWith(endpoint));
        await page.evaluate(props => (window as unknown as { mount: (p: unknown) => void }).mount(props), {
          courseId: "course", lessonId: "lesson", contentId, learningMode,
          seconds: 60, initialCompleted: false, copy, endpoint,
          // Intentionally omit showError/canComplete: video must always be silent.
        });
        await finished;
        await page.waitForLoadState("networkidle");
      };
      for (const error of [null, "http", "network"] as const) {
        failure = error;
        await mount(`video-${error || "success"}`);
        assert.equal(await page.locator(".preview-progress,[role=alert],[role=status]").count(), 0);
        assert.equal(await page.getByText(copy.saveError, { exact: true }).count(), 0);
      }
      assert.equal(requests.length, 3, "successful and failed saves still run in the background");
      assert.ok(requests.every(request => request.learningMode === "video" && request.event === "open"));
      failure = "http";
      await mount("text", "text");
      await page.getByRole("alert").waitFor();
      assert.equal(await page.getByRole("alert").textContent(), copy.saveError, "text retains its existing save feedback");
      await mount("video-after-text");
      assert.equal(await page.locator(".preview-progress,[role=alert],[role=status]").count(), 0, "switching from a failed text save cannot leak its notice into video");
      await page.close();
    }
  } finally { await browser.close(); }
});
