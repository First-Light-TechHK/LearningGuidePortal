import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { build } from "esbuild";
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/** TutorChat 气泡（assistant/welcome/user）现在走 MarkdownAnswer，应支持 LaTeX + markdown。 */

const copy = { tutor: "AI Tutor", lecture: "Lecture", socratic: "Socratic", send: "Send", askTutor: "Ask the tutor", you: "You", newChat: "New chat", closeTutor: "Close AI Tutor", askTutorPlaceholder: "Ask about this lesson..." } as const;
type MountProps = { locale: "en-GB" | "zh-CN"; courseId: string; lessonId: string; copy: typeof copy };

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

function startServer() {
  const postBodies: Array<{ message?: string }> = [];
  const server = createServer((request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    if (url.pathname === "/api/ai-tutor" && request.method === "GET") {
      // 欢迎语含 inline LaTeX
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({
        conversation: { id: "conversation-md", messages: [] },
        welcome: "Hi! Try typing $E = mc^2$ below.",
      }));
      return;
    }
    if (url.pathname === "/api/ai-tutor" && request.method === "POST") {
      let body = "";
      request.on("data", (c) => { body += c; });
      request.on("end", () => {
        postBodies.push(JSON.parse(body));
        // 助手回复：block LaTeX（多行 $$）+ 列表 + 行内公式
        const answer = "Here is the formula:\n\n$$\nE = mc^2\n$$\n\nKey points:\n1. Energy\n2. Mass\n3. Speed of light $c$\n";
        response.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "X-Conversation-Id": "conversation-md" });
        response.end(answer);
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
  return new Promise<{ origin: string; postBodies: typeof postBodies; close: () => Promise<void> }>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
        postBodies,
        close: () => { server.closeAllConnections(); return new Promise<void>((done) => server.close(() => done())); },
      });
    });
  });
}

function mount(page: import("playwright").Page) {
  return (lessonId: string) => page.evaluate((props: MountProps) => {
    (window as unknown as { mount: (value: MountProps) => void }).mount(props);
  }, { locale: "en-GB", courseId: "course", lessonId, copy } as MountProps);
}

test("welcome, assistant and user bubbles render LaTeX and markdown", async () => {
  const harness = await startServer();
  const bundle = await tutorBundle();
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(harness.origin);
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await mount(page)("lesson-md");

    // welcome 含 inline LaTeX $E = mc^2$
    await page.waitForFunction(() => document.querySelector(".tutor-message.assistant .katex"), undefined, { timeout: 3000 });
    assert.ok(await page.locator(".tutor-message.assistant .katex").count() >= 1, "welcome bubble should render inline LaTeX via KaTeX");

    // 用户输入一段 markdown（含行内公式）
    await page.locator(".tutor-composer textarea").fill("What is $a^2 + b^2 = c^2$?");
    await page.locator(".tutor-composer button").click();

    // 等助手回复渲染出来
    await page.waitForFunction(() => document.querySelector(".tutor-message.assistant .katex-display") !== null, undefined, { timeout: 3000 });

    // assistant 气泡应有 block LaTeX
    assert.ok(await page.locator(".tutor-message.assistant .katex-display").count() >= 1, "assistant bubble should render block LaTeX");
    // assistant 气泡应有列表
    assert.ok(await page.locator(".tutor-message.assistant ol").count() >= 1, "assistant bubble should render ordered list");

    // user 气泡也应渲染 markdown（行内公式）
    const userKatex = await page.locator(".tutor-message.user .katex").count();
    assert.ok(userKatex >= 1, `user bubble should render inline markdown/LaTeX too, got ${userKatex}`);
  } finally {
    await browser.close();
    await harness.close();
  }
});
