import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { build } from "esbuild";
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tutorErrorKey, tutorErrorMessage } from "../../components/portal/tutorChatError";
import { getMessages } from "../../lib/i18n/messages";

/** REQ-0140: a failed AI Tutor request never shows the API's JSON body to the learner. */

test("maps every AI Tutor failure to a fixed line, by code first and then by status", () => {
  const cases: [number | null, string, string][] = [
    [503, JSON.stringify({ ok: false, code: "AI_TUTOR_UNAVAILABLE", error: "AI Tutor is currently unavailable." }), "unavailable"],
    [403, JSON.stringify({ ok: false, code: "AI_TUTOR_OFFLINE", error: "AI Tutor is not available for this course." }), "offline"],
    [403, JSON.stringify({ ok: false, error: "Course access is required." }), "noAccess"],
    [401, JSON.stringify({ ok: false, error: "Sign in is required." }), "signIn"],
    [404, JSON.stringify({ ok: false, error: "Course not found." }), "notFound"],
    [400, JSON.stringify({ ok: false, error: "Enter a message of up to 4,000 characters." }), "tooLong"],
    [409, JSON.stringify({ ok: false, code: "KS_TUTOR_IN_PROGRESS", error: "busy" }), "busy"],
    [429, JSON.stringify({ ok: false, code: "KS_TUTOR_RATE_LIMITED", error: "slow down" }), "rateLimited"],
    [503, JSON.stringify({ ok: false, code: "KS_TUTOR_NOT_CONFIGURED", error: "AI Tutor service is not configured." }), "unavailable"],
    [502, "upstream exploded at node 7", "generic"],
    [500, "", "generic"],
    [null, "", "generic"],
  ];
  for (const [status, body, key] of cases) assert.equal(tutorErrorKey(status, body), key, `${status} ${body}`);
});

test("every line exists in both languages and carries no raw API text", () => {
  for (const locale of ["en-GB", "zh-CN"] as const) {
    const lines = getMessages(locale).learning.tutorErrors;
    assert.deepEqual(Object.keys(lines).sort(), ["busy", "generic", "noAccess", "notFound", "offline", "rateLimited", "signIn", "tooLong", "unavailable"]);
    for (const line of Object.values(lines)) {
      assert.ok(line.trim().length > 0);
      assert.doesNotMatch(line, /[{}"]|AI_TUTOR_|KS_TUTOR_/);
    }
    assert.notEqual(tutorErrorMessage(locale, 503, JSON.stringify({ code: "AI_TUTOR_UNAVAILABLE" })), tutorErrorMessage(locale, null, ""));
  }
  assert.equal(tutorErrorMessage("zh-CN", 503, JSON.stringify({ ok: false, code: "AI_TUTOR_UNAVAILABLE", error: "x" })), "AI Tutor 暂时无法使用，请稍后再试。");
});

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..", "..");
const STYLES_CSS = readFileSync(join(PROJECT_ROOT, "app", "styles.css"), "utf-8");
const copy = { tutor: "AI Tutor", lecture: "Lecture", socratic: "Socratic", send: "Send", askTutor: "Ask the tutor", you: "You", newChat: "New chat", closeTutor: "Close AI Tutor", askTutorPlaceholder: "Ask about this lesson..." } as const;

test("the chat shows the localised line, not the JSON body, when the tutor answers 503", async () => {
  const body = JSON.stringify({ ok: false, code: "AI_TUTOR_UNAVAILABLE", error: "AI Tutor is currently unavailable." });
  const server = createServer((request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    if (url.pathname === "/api/ai-tutor" && request.method === "GET") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ conversation: { id: "c1", messages: [] }, welcome: "Ask away." }));
      return;
    }
    if (url.pathname === "/api/ai-tutor" && request.method === "POST") {
      request.resume();
      request.on("end", () => { response.writeHead(503, { "Content-Type": "application/json" }); response.end(body); });
      return;
    }
    response.writeHead(200, { "Content-Type": "text/html" });
    response.end(`<!doctype html><html><head><meta charset="utf-8"><style>${STYLES_CSS}</style></head><body><div id="root"></div></body></html>`);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const bundle = await build({
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
  const browser = await chromium.launch({ headless: true });
  try {
    for (const locale of ["en-GB", "zh-CN"] as const) {
      const page = await browser.newPage();
      await page.goto(origin);
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      await page.evaluate((props) => { (window as unknown as { mount: (value: unknown) => void }).mount(props); }, { locale, courseId: "course", lessonId: "lesson", copy });
      await page.waitForFunction(() => document.querySelector(".tutor-messages")?.textContent?.includes("Ask away."));
      await page.locator(".tutor-composer textarea").fill("What is a cell?");
      await page.locator(".tutor-composer textarea").press("Enter");
      const alert = page.getByRole("alert");
      await alert.waitFor();
      const text = (await alert.textContent()) || "";
      assert.equal(text, getMessages(locale).learning.tutorErrors.unavailable);
      assert.doesNotMatch(text, /[{}]|AI_TUTOR_|"ok"/);
      await page.close();
    }
  } finally {
    await browser.close();
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
  }
});
