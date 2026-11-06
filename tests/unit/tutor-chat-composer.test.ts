import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { build } from "esbuild";
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/** textarea 自动增高 + 超过 10 行滚动 + 发送后重置。 */

const copy = { tutor: "AI Tutor", lecture: "Lecture", socratic: "Socratic", send: "Send", askTutor: "Ask the tutor", you: "You", newChat: "New chat", closeTutor: "Close AI Tutor", askTutorPlaceholder: "Ask about this lesson..." } as const;
type MountProps = { locale: "en-GB" | "zh-CN"; courseId: string; lessonId: string; copy: typeof copy };

const MAX_TEXTAREA_HEIGHT = 196; // 与 TutorChat.tsx 常量 + styles.css max-height 同步

// 把项目 styles.css 注入到测试页面，保证真实 CSS 环境
const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..", "..");
const STYLES_CSS = readFileSync(join(PROJECT_ROOT, "app", "styles.css"), "utf-8");

function tutorBundle() {
  return build({
    stdin: {
      contents: `
        import React from 'react';
        import { createRoot } from 'react-dom/client';
        import { flushSync } from 'react-dom';
        import { TutorChat } from './components/portal/TutorChat';
        const root = createRoot(document.getElementById('root'));
        window.mount = (props) => { flushSync(() => { root.render(React.createElement(TutorChat, props)); }); };
      `,
      resolveDir: PROJECT_ROOT,
      loader: "tsx",
    },
    bundle: true, write: false, platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
  });
}

function startMinimalServer() {
  /** 只用 GET 返回欢迎，POST 立即返回一个静态 answer（无 streaming）。 */
  const server = createServer((request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    if (url.pathname === "/api/ai-tutor" && request.method === "GET") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ conversation: { id: "conversation-min", messages: [] }, welcome: "Ask away." }));
      return;
    }
    if (url.pathname === "/api/ai-tutor" && request.method === "POST") {
      request.resume();
      request.on("end", () => {
        response.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "X-Conversation-Id": "conversation-min" });
        response.end("Got it.");
      });
      return;
    }
    if (url.pathname === "/api/ai-tutor" && request.method === "DELETE") {
      request.resume();
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ ok: true }));
      return;
    }
    response.writeHead(200, { "Content-Type": "text/html" });
    response.end(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${STYLES_CSS}</style></head><body><div id="root"></div></body></html>`);
  });
  return new Promise<{ origin: string; close: () => Promise<void> }>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
        close: () => { server.closeAllConnections(); return new Promise<void>((done) => server.close(() => done())); },
      });
    });
  });
}

function mountTutorChat(page: import("playwright").Page) {
  return (lessonId: string) => page.evaluate((props: MountProps) => {
    (window as unknown as { mount: (value: MountProps) => void }).mount(props);
  }, { locale: "en-GB", courseId: "course", lessonId, copy } as MountProps);
}

test("textarea auto-grows with content up to the 10-line cap, then scrolls", async () => {
  const harness = await startMinimalServer();
  const bundle = await tutorBundle();
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(harness.origin);
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await mountTutorChat(page)("lesson-one");
    await page.waitForFunction(() => document.querySelector(".tutor-messages")?.textContent?.includes("Ask away."));

    const ta = page.locator(".tutor-composer textarea");
    // 初始：无内容，高度应该就是 min-height（≈ 54px，CSS min-height:54px + line-height:18px ≈ 2 行）
    const initialHeight = await ta.evaluate((el) => (el as HTMLTextAreaElement).getBoundingClientRect().height);
    assert.ok(initialHeight >= 50 && initialHeight < 80, `initial textarea height should be ≈ 54px, got ${initialHeight}`);

    // 输入 5 行文本 → 高度应增长但未封顶
    const fiveLines = "line1\nline2\nline3\nline4\nline5";
    await ta.fill(fiveLines);
    const fiveLineHeight = await ta.evaluate((el) => (el as HTMLTextAreaElement).getBoundingClientRect().height);
    assert.ok(fiveLineHeight > initialHeight, `textarea should grow when 5 lines entered, got ${fiveLineHeight} <= ${initialHeight}`);
    assert.ok(fiveLineHeight < MAX_TEXTAREA_HEIGHT, `5-line textarea should be below cap ${MAX_TEXTAREA_HEIGHT}, got ${fiveLineHeight}`);

    // 输入 15 行 → 高度封顶，出现滚动条
    const fifteenLines = Array.from({ length: 15 }, (_, i) => `line${i + 1}`).join("\n");
    await ta.fill(fifteenLines);
    const cappedHeight = await ta.evaluate((el) => {
      const ta = el as HTMLTextAreaElement;
      return { height: ta.getBoundingClientRect().height, scrollHeight: ta.scrollHeight };
    });
    assert.ok(cappedHeight.height >= MAX_TEXTAREA_HEIGHT - 2 && cappedHeight.height <= MAX_TEXTAREA_HEIGHT + 2,
      `textarea height should be capped at ${MAX_TEXTAREA_HEIGHT}, got ${cappedHeight.height}`);
    assert.ok(cappedHeight.scrollHeight > MAX_TEXTAREA_HEIGHT,
      `textarea scrollHeight should exceed cap (scrollbar active), got ${cappedHeight.scrollHeight}`);
  } finally {
    await browser.close();
    await harness.close();
  }
});

test("textarea height resets after sending a message", async () => {
  const harness = await startMinimalServer();
  const bundle = await tutorBundle();
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(harness.origin);
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await mountTutorChat(page)("lesson-one");
    await page.waitForFunction(() => document.querySelector(".tutor-messages")?.textContent?.includes("Ask away."));

    const ta = page.locator(".tutor-composer textarea");
    const button = page.locator(".tutor-composer button");

    // 输入 15 行 → 封顶
    const fifteenLines = Array.from({ length: 15 }, (_, i) => `line${i + 1}`).join("\n");
    await ta.fill(fifteenLines);
    const beforeSend = await ta.evaluate((el) => (el as HTMLTextAreaElement).getBoundingClientRect().height);
    assert.ok(beforeSend >= MAX_TEXTAREA_HEIGHT - 2, `pre-send textarea should be capped, got ${beforeSend}`);

    // 发送后 input 变空 → 高度应回到 auto/min
    await button.click();
    // 等 assistant bubble 出现（post 立即返回 "Got it."）
    await page.waitForFunction(() => document.querySelector(".tutor-messages")?.textContent?.includes("Got it."));
    const afterSend = await ta.evaluate((el) => (el as HTMLTextAreaElement).getBoundingClientRect().height);
    assert.ok(afterSend >= 50 && afterSend < 80, `post-send textarea should reset to ≈ 54px, got ${afterSend}`);
  } finally {
    await browser.close();
    await harness.close();
  }
});
