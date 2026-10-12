import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";

test("course mode dialog starts unselected, saves only on Continue, retries and handles guest login", async () => {
  const bundle = await build({
    stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {CourseLearningModeDialog} from './components/portal/CourseLearningModeDialog'; const root=createRoot(document.getElementById('root')); window.mount=props=>root.render(React.createElement(CourseLearningModeDialog,{key:props.courseId,...props}));`, resolveDir: process.cwd(), loader: "tsx" },
    bundle: true, write: false, outfile: "dialog.js", platform: "browser", external: ["/portal/*"], jsx: "automatic", loader: { ".css": "local-css", ".svg": "file" },
    define: { "process.env.NODE_ENV": '"production"' }, plugins: [{ name: "next", setup(builder) {
      builder.onResolve({ filter: /^next\/(image|navigation)$/ }, args => ({ path: args.path, namespace: "mock" }));
      builder.onLoad({ filter: /.*/, namespace: "mock" }, args => ({ resolveDir: process.cwd(), contents: args.path === "next/image" ? `import React from 'react'; export default function Image(props){return React.createElement('img',props)}` : `export function usePathname(){return location.pathname} export function useRouter(){return {push(url){window.destination=url},refresh(){window.refreshed=true}}}` }));
    } }],
  });
  const script = bundle.outputFiles.find(file => file.path.endsWith(".js"))!.text;
  const css = bundle.outputFiles.find(file => file.path.endsWith(".css"))!.text;
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || "msedge" });
  await mkdir("test-results/course-learning-mode", { recursive: true });
  try {
    for (const locale of ["en-GB", "zh-CN"]) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1024 } });
      const requests: unknown[] = []; let fail = true;
      await page.route("http://mode.test/**", async route => {
        const url = new URL(route.request().url());
        if (url.pathname.startsWith("/portal/learning-mode/")) return route.fulfill({ contentType: "image/svg+xml", body: await readFile(path.join("public", url.pathname)) });
        if (url.pathname.startsWith("/api/courses/")) { requests.push(route.request().postDataJSON()); return route.fulfill({ status: fail ? 500 : 200, contentType: "application/json", body: fail ? '{"ok":false}' : '{"ok":true}' }); }
        return route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' });
      });
      await page.goto(`http://mode.test/${locale}/portal/courses/a`);
      await page.addStyleTag({ content: await readFile("app/styles.css", "utf8") });
      await page.addStyleTag({ content: css });
      // Load the same local Inter font used by the application for visual review.
      const font = (await readFile("node_modules/@fontsource/inter/files/inter-latin-400-normal.woff2")).toString("base64");
      const bold = (await readFile("node_modules/@fontsource/inter/files/inter-latin-700-normal.woff2")).toString("base64");
      await page.addStyleTag({ content: `@font-face{font-family:Inter;src:url(data:font/woff2;base64,${font}) format('woff2');font-weight:400}@font-face{font-family:Inter;src:url(data:font/woff2;base64,${bold}) format('woff2');font-weight:700}` });
      await page.addScriptTag({ content: script });
      const mount = (courseId: string, signedIn = true) => page.evaluate(props => (window as unknown as {mount: (props: unknown) => void}).mount(props), { locale, courseId, signedIn });
      await mount("a");
      const dialog = page.getByRole("dialog"); await dialog.waitFor();
      assert.equal(await dialog.getByRole("radio").count(), 2);
      assert.equal(await dialog.locator("input:checked").count(), 0);
      assert.equal(await dialog.getByRole("button", { name: locale === "zh-CN" ? "继续" : "Continue", exact: true }).isDisabled(), true);
      assert.equal(requests.length, 0);
      const box = (await dialog.boundingBox())!;
      assert.equal(box.width, 720); assert.equal(box.height, 463);
      await page.screenshot({ path: `test-results/course-learning-mode/${locale}-unselected.png` });
      await dialog.getByText(locale === "zh-CN" ? "视频模式" : "Video Mode", { exact: true }).click();
      await page.screenshot({ path: `test-results/course-learning-mode/${locale}-video.png` });
      const proceed = () => dialog.getByRole("button", { name: locale === "zh-CN" ? "以视频模式继续" : "Continue with Video", exact: true });
      await proceed().click(); await dialog.getByRole("alert").waitFor();
      assert.equal(await dialog.isVisible(), true);
      fail = false; await proceed().click(); await dialog.waitFor({ state: "detached" });
      assert.deepEqual(requests, [{ mode: "video" }, { mode: "video" }]);
      await mount("b"); await dialog.waitFor();
      assert.equal(await dialog.locator("input:checked").count(), 0);
      await dialog.getByRole("button", { name: locale === "zh-CN" ? "关闭" : "Close" }).click();
      assert.equal(requests.length, 2);
      await mount("guest", false); await dialog.waitFor();
      await dialog.getByText(locale === "zh-CN" ? "文本模式" : "Text Mode", { exact: true }).click();
      await dialog.getByRole("button", { name: locale === "zh-CN" ? "以文本模式继续" : "Continue with Text", exact: true }).click();
      const destination = await page.evaluate(() => (window as unknown as {destination: string}).destination);
      assert.ok(destination.startsWith(`/${locale}/portal/sign-in?returnTo=`));
      assert.equal(new URL(destination, "http://mode.test").searchParams.get("returnTo"), `/${locale}/portal/courses/a?learningMode=text`);
      assert.equal(requests.length, 2);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: `test-results/course-learning-mode/${locale}-mobile.png` });
      assert.ok((await dialog.boundingBox())!.width <= 358);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      for (const viewport of [{ width:320, height:568 }, { width:390, height:844 }, { width:667, height:375 }, { width:844, height:390 }, { width:768, height:1024 }, { width:1280, height:480 }]) {
        await page.setViewportSize(viewport);
        const bounds = (await dialog.boundingBox())!;
        assert.ok(bounds.x >= 15 && bounds.y >= 15, JSON.stringify({ viewport, bounds }));
        assert.ok(bounds.x + bounds.width <= viewport.width - 15 && bounds.y + bounds.height <= viewport.height - 15, JSON.stringify({ viewport, bounds }));
        assert.equal(await dialog.evaluate(node => node.scrollWidth > node.clientWidth), false);
        const continueButton = dialog.getByRole("button", { name: locale === "zh-CN" ? "以文本模式继续" : "Continue with Text", exact:true });
        await continueButton.scrollIntoViewIfNeeded();
        const buttonBounds = (await continueButton.boundingBox())!;
        assert.ok(buttonBounds.y >= bounds.y && buttonBounds.y + buttonBounds.height <= bounds.y + bounds.height);
        await dialog.evaluate(node => { node.scrollTop = 0; });
        await dialog.getByRole("button", { name:locale === "zh-CN" ? "关闭" : "Close" }).isVisible().then(visible => assert.ok(visible));
        await page.screenshot({ path:`test-results/course-learning-mode/${locale}-${viewport.width}x${viewport.height}.png` });
      }
      await page.keyboard.press("Escape"); await dialog.waitFor({ state: "detached" });
      await page.evaluate(props => (window as unknown as {mount: (props: unknown) => void}).mount(props), { locale, courseId: "return-from-login", signedIn: true, pendingMode: "text" });
      await dialog.waitFor();
      assert.equal(await dialog.locator('input[value="text"]').isChecked(), true);
      assert.equal(requests.length, 2, "login return retains selection but does not save before confirmation");
      await dialog.getByRole("button", { name: locale === "zh-CN" ? "以文本模式继续" : "Continue with Text", exact: true }).click();
      await dialog.waitFor({ state: "detached" });
      assert.deepEqual(requests[2], { mode: "text" });
      await page.close();
    }
  } finally { await browser.close(); }
});
