import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { build } from "esbuild";
import { chromium } from "playwright";

// L3 (bug-hunt-2026-10-14): while an AI Tutor answer is still streaming, switching the
// mode or the lesson must invalidate the old stream — its late headers and chunks may not
// write into the new conversation — and the mode switches must be disabled while busy.

const copy = { tutor: "AI Tutor", lecture: "Lecture", socratic: "Socratic", send: "Send", askTutor: "Ask the tutor", you: "You", newChat: "New chat", closeTutor: "Close AI Tutor", askTutorPlaceholder: "Ask about this lesson..." } as const;
type MountProps = { locale: "en-GB" | "zh-CN"; courseId: string; lessonId: string; copy: typeof copy };

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
      resolveDir: process.cwd(),
      loader: "tsx",
    },
    bundle: true, write: false, platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
  });
}

function startTutorServer() {
  const postBodies: Array<{ conversationId?: string; message?: string }> = [];
  const deletes: Array<{ lessonId: string | null; mode: string | null }> = [];
  let releaseHeaders: () => void = () => {};
  const headersGate = new Promise<void>((resolve) => { releaseHeaders = resolve; });
  let releaseTail: () => void = () => {};
  const tailGate = new Promise<void>((resolve) => { releaseTail = resolve; });
  let signalFirstStreamDone: () => void = () => {};
  const firstStreamDone = new Promise<void>((resolve) => { signalFirstStreamDone = resolve; });

  const server = createServer((request, response) => {
    response.on("error", () => { /* the client may abort a gated stream; that must not crash the harness */ });
    const url = new URL(request.url || "/", "http://127.0.0.1");
    if (url.pathname === "/api/ai-tutor" && request.method === "GET") {
      const lessonId = url.searchParams.get("lessonId");
      const mode = url.searchParams.get("mode");
      if (lessonId === "lesson-no-welcome") {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ conversation: { id: "conversation-empty", messages: [] }, welcome: "" }));
        return;
      }
      if (lessonId === "lesson-empty") {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ conversation: { id: "conversation-empty", messages: [] }, welcome: "Welcome from KS." }));
        return;
      }
      const conversation = lessonId === "lesson-two"
        ? (mode === "socratic" ? { id: "conversation-two-socratic", messages: [{ role: "assistant", content: "Lesson two socratic history" }] }
          : { id: "conversation-two", messages: [{ role: "assistant", content: "Lesson two history" }] })
        : { id: `conversation-${mode}`, messages: [{ role: "assistant", content: `${mode} history` }] };
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ conversation, welcome: "Welcome from KS." }));
      return;
    }
    if (url.pathname === "/api/ai-tutor" && request.method === "DELETE") {
      deletes.push({ lessonId: url.searchParams.get("lessonId"), mode: url.searchParams.get("mode") });
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ ok: true }));
      return;
    }
    if (url.pathname === "/api/ai-tutor" && request.method === "POST") {
      let body = "";
      request.on("data", (chunk) => { body += chunk; });
      request.on("end", () => { void (async () => {
        postBodies.push(JSON.parse(body));
        if (postBodies.length > 1) {
          response.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "X-Conversation-Id": "conversation-two" });
          response.end("Fresh answer.");
          return;
        }
        // The first answer is deliberately slow: its headers are withheld until the test
        // releases them, and its last chunk until the conversation has already changed.
        try {
          await headersGate;
          response.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "X-Conversation-Id": "conversation-stale" });
          response.write("Stale first half. ");
          await tailGate;
          response.write("Stale second half.");
          response.end();
        } catch {
          // The client aborted or closed the socket; the stale write must stay invisible anyway.
        } finally {
          signalFirstStreamDone();
        }
      })(); });
      return;
    }
    response.writeHead(200, { "Content-Type": "text/html" });
    response.end('<div id="root"></div>');
  });

  return new Promise<{
    origin: string;
    postBodies: Array<{ conversationId?: string; message?: string }>;
    deletes: Array<{ lessonId: string | null; mode: string | null }>;
    releaseHeaders: () => void;
    releaseTail: () => void;
    firstStreamDone: Promise<void>;
    close: () => Promise<void>;
  }>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
        postBodies, deletes, releaseHeaders, releaseTail, firstStreamDone,
        close: () => { server.closeAllConnections(); return new Promise<void>((done) => server.close(() => done())); },
      });
    });
  });
}

async function until(condition: () => boolean, message: string, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    assert.ok(Date.now() < deadline, message);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function mountTutorChat(page: import("playwright").Page) {
  return (lessonId: string) => page.evaluate((props: MountProps) => {
    (window as unknown as { mount: (value: MountProps) => void }).mount(props);
  }, { locale: "en-GB", courseId: "course", lessonId, copy } as MountProps);
}

test("mode switching is disabled while an answer is streaming", async () => {
  const harness = await startTutorServer();
  const bundle = await tutorBundle();
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(harness.origin);
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await mountTutorChat(page)("lesson-one");
    await page.waitForFunction(() => document.querySelector(".tutor-messages")?.textContent?.includes("lecture history"));
    await page.locator(".tutor-composer textarea").fill("What is virtue?");
    await page.locator(".tutor-composer button").click();
    await until(() => harness.postBodies.length === 1, "the streaming request was never sent");
    await page.waitForFunction(
      () => Array.from(document.querySelectorAll(".mode-switch button")).every((button) => (button as HTMLButtonElement).disabled),
      undefined,
      { timeout: 3000 },
    );
  } finally {
    harness.releaseHeaders();
    harness.releaseTail();
    await browser.close();
    await harness.close();
  }
});

test("a stream from the previous lesson never writes into the new conversation", async () => {
  const harness = await startTutorServer();
  const bundle = await tutorBundle();
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto(harness.origin);
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const mount = mountTutorChat(page);

    await mount("lesson-one");
    await page.waitForFunction(() => document.querySelector(".tutor-messages")?.textContent?.includes("lecture history"));
    await page.locator(".tutor-composer textarea").fill("What is virtue?");
    await page.locator(".tutor-composer button").click();
    await until(() => harness.postBodies.length === 1, "the streaming request was never sent");

    // The learner moves to another lesson while the answer is still streaming; TutorChat is
    // re-rendered in place with the new lessonId, exactly as PreviewLessonView does.
    await mount("lesson-two");
    await page.waitForFunction(() => document.querySelector(".tutor-messages")?.textContent?.includes("Lesson two history"));
    harness.releaseHeaders();
    harness.releaseTail();
    await harness.firstStreamDone;

    // The new conversation stays usable; its follow-up must not surface the replaced stream.
    await page.locator(".tutor-composer textarea").fill("Second question");
    await page.waitForFunction(() => !(document.querySelector(".tutor-composer button") as HTMLButtonElement).disabled);
    await page.locator(".tutor-composer button").click();
    await page.waitForFunction(() => document.querySelector(".tutor-messages")?.textContent?.includes("Fresh answer."));
    await until(() => harness.postBodies.length === 2, "the follow-up request was never sent");

    const transcript = await page.locator(".tutor-messages").textContent();
    assert.ok(transcript?.includes("Lesson two history"), `the new lesson history must stay: ${transcript}`);
    assert.equal(transcript?.includes("Stale"), false, `the replaced stream leaked into the new conversation: ${transcript}`);
    assert.equal(harness.postBodies[1].conversationId, "conversation-two", "the follow-up must continue the new lesson's conversation");
    assert.equal(await page.locator(".portal-form-error").count(), 0, "a replaced stream must not surface an error");
    assert.deepEqual(pageErrors, []);

    // 2026-10-27：切换模式不再重新加载对话，只影响后续请求的提示词注入。
    // 点击 Socratic 后，当前会话消息应保持不变（仍显示 Lesson two history + Fresh answer.）。
    await page.locator(".mode-switch button").nth(1).click();
    const transcriptAfterModeSwitch = await page.locator(".tutor-messages").textContent();
    assert.ok(transcriptAfterModeSwitch?.includes("Lesson two history"), "switching mode must not reload the conversation");
    assert.equal(transcriptAfterModeSwitch?.includes("socratic history"), false, "switching mode must not load the socratic conversation");
  } finally {
    harness.releaseHeaders();
    harness.releaseTail();
    await browser.close();
    await harness.close();
  }
});

test("welcome comes from KS, timestamps sit in the bubble corner, and New chat clears both UI and stored conversation", async () => {
  const harness = await startTutorServer();
  const bundle = await tutorBundle();
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(harness.origin);
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const mount = mountTutorChat(page);

    await mount("lesson-empty");
    await page.waitForFunction(() => document.querySelector(".tutor-messages")?.textContent?.includes("Welcome from KS."));
    assert.equal(await page.locator(".tutor-message.assistant").count(), 1, "the KS welcome is rendered as an assistant bubble");
    assert.equal(await page.locator(".tutor-message-time").count(), 1, "the welcome bubble carries a timestamp");

    harness.releaseHeaders();
    harness.releaseTail();
    await page.locator(".tutor-composer textarea").fill("What should I notice first?");
    await page.locator(".tutor-composer button").click();
    await until(() => harness.postBodies.length === 1, "the streaming request was never sent");
    await page.waitForFunction(() => document.querySelector(".tutor-messages")?.textContent?.includes("Stale first half."));
    assert.equal(harness.postBodies[0].conversationId, "conversation-empty", "the first answer continues the loaded conversation");
    const timeCount = await page.locator(".tutor-message-time").count();
    assert.equal(timeCount, 3, "welcome, user and assistant rows each carry a timestamp cornered inside their bubble");
    assert.equal(await page.locator(".tutor-message.assistant").count(), 2, "the KS welcome stays above the conversation after sending");

    await page.getByRole("button", { name: "New chat" }).click();
    await until(() => harness.deletes.length === 1, "New chat never deleted the stored conversation");
    assert.deepEqual(harness.deletes[0], { lessonId: "lesson-empty", mode: "lecture" });
    await page.waitForFunction(() => !document.querySelector(".tutor-messages")?.textContent?.includes("Stale"));
    await page.waitForFunction(() => document.querySelector(".tutor-messages")?.textContent?.includes("Welcome from KS."));

    await page.locator(".tutor-composer textarea").fill("Start again");
    await page.locator(".tutor-composer button").click();
    await until(() => harness.postBodies.length === 2, "the follow-up request was never sent");
    assert.ok(String(harness.postBodies[1].conversationId).startsWith("tutor-new-"), "a new chat must not reuse the deleted conversation id");

    await mount("lesson-no-welcome");
    await page.waitForFunction(() => document.querySelector(".tutor-empty")?.textContent?.includes("Ask the tutor"));
    assert.equal(await page.locator(".tutor-message.assistant").count(), 0, "an empty KS welcome shows no bubble");
  } finally {
    harness.releaseHeaders();
    harness.releaseTail();
    await browser.close();
    await harness.close();
  }
});
