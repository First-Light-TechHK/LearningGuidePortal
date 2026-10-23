import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import {
  getTutorAvailability,
  getTutorWelcome,
  KsTutorError,
  streamTutorText,
} from "../../services/ksTutorClient";

const originalFetch = globalThis.fetch;
const originalBaseUrl = process.env.KS_TUTOR_BASE_URL;
const originalApiKey = process.env.KS_TUTOR_API_KEY;
const originalTimeout = process.env.KS_TUTOR_TIMEOUT_MS;

before(() => {
  process.env.KS_TUTOR_BASE_URL = "http://ks.test";
  process.env.KS_TUTOR_API_KEY = "service-token";
  process.env.KS_TUTOR_TIMEOUT_MS = "5000";
});

after(() => {
  globalThis.fetch = originalFetch;
  restore("KS_TUTOR_BASE_URL", originalBaseUrl);
  restore("KS_TUTOR_API_KEY", originalApiKey);
  restore("KS_TUTOR_TIMEOUT_MS", originalTimeout);
});

function restore(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function sseResponse(frames: string[], chunkSize = 7) {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(frames.join(""));
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (let offset = 0; offset < bytes.length; offset += chunkSize) {
          controller.enqueue(bytes.slice(offset, offset + chunkSize));
        }
        controller.close();
      },
    }),
    { status: 200, headers: { "Content-Type": "text/event-stream" } },
  );
}

async function collect(gen: AsyncGenerator<string>) {
  let text = "";
  for await (const delta of gen) text += delta;
  return text;
}

test("getTutorAvailability 只认 KS 的 available 字段", async () => {
  globalThis.fetch = (async () =>
    jsonResponse({
      success: true,
      data: [
        { externalId: "epicureanism", online: true, available: true },
        { externalId: "stoicism", online: true, available: false },
        { externalId: "calculus", online: false, available: false },
      ],
    })) as typeof fetch;

  assert.deepEqual(await getTutorAvailability("epicureanism"), {
    online: true,
    reachable: true,
  });
  assert.deepEqual(await getTutorAvailability("stoicism"), {
    online: false,
    reachable: true,
  });
  assert.deepEqual(await getTutorAvailability("missing"), {
    online: false,
    reachable: true,
  });
});

test("getTutorAvailability 在 KS 不可达时按 offline 处理", async () => {
  globalThis.fetch = (async () => {
    throw new Error("connect ECONNREFUSED");
  }) as typeof fetch;

  assert.deepEqual(await getTutorAvailability("epicureanism"), {
    online: false,
    reachable: false,
  });
});

test("getTutorWelcome 读取并规范化 KS 两种模式的欢迎语", async () => {
  let requestedUrl = "";
  let requestedKey = "";
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    requestedUrl = String(url);
    requestedKey = String((init?.headers as Record<string, string> | undefined)?.["X-API-Key"] || "");
    return jsonResponse({ success: true, data: { lecture: "Welcome (L)", socratic: "Welcome (S)" } });
  }) as typeof fetch;

  assert.deepEqual(await getTutorWelcome("epicureanism", "zh-CN"), {
    lecture: "Welcome (L)",
    socratic: "Welcome (S)",
  });
  assert.ok(requestedUrl.endsWith("/api/user/ai-tutors/epicureanism/welcome?locale=zh-CN"));
  assert.equal(requestedKey, "service-token");
});

test("getTutorWelcome 在 KS 不可达或返回非字符串时回退为空字符串", async () => {
  globalThis.fetch = (async () => new Response("down", { status: 503 })) as typeof fetch;
  assert.deepEqual(await getTutorWelcome("epicureanism", "en-GB"), { lecture: "", socratic: "" });

  globalThis.fetch = (async () => jsonResponse({ success: true, data: { lecture: 1, socratic: null } })) as typeof fetch;
  assert.deepEqual(await getTutorWelcome("epicureanism", "en-GB"), { lecture: "", socratic: "" });

  globalThis.fetch = (async () => {
    throw new Error("connect ECONNREFUSED");
  }) as typeof fetch;
  assert.deepEqual(await getTutorWelcome("epicureanism", "en-GB"), { lecture: "", socratic: "" });
});

test("streamTutorText 解析被任意切分的 SSE 帧并拼接纯文本", async () => {
  let requestBody: Record<string, unknown> = {};
  const frames = [
    'data: {"delta":"Hel"}\n\n',
    'data: {"delta":"lo"}\n\n',
    'data: {"done":true}\n\n',
  ];
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return sseResponse(frames, 5);
  }) as typeof fetch;

  const text = await collect(
    streamTutorText({
      externalCourseId: "epicureanism",
      message: "What is pleasure?",
      mode: "socratic",
      locale: "en-GB",
      history: [{ role: "user", content: "Earlier" }],
    }),
  );

  assert.equal(text, "Hello");
  assert.equal(requestBody.externalCourseId, "epicureanism");
  assert.equal(requestBody.mode, "SOCRATIC");
  assert.equal(requestBody.locale, "en-GB");
  assert.deepEqual(requestBody.history, [{ role: "user", content: "Earlier" }]);
});

test("streamTutorText 遇到 error 帧抛出 KsTutorError", async () => {
  globalThis.fetch = (async () =>
    sseResponse(['data: {"error":"该课程 AI 导师未开放"}\n\n'])) as typeof fetch;

  await assert.rejects(
    collect(
      streamTutorText({
        externalCourseId: "epicureanism",
        message: "Hello",
        mode: "lecture",
        locale: "en-GB",
        history: [],
      }),
    ),
    (error: unknown) =>
      error instanceof KsTutorError && error.code === "KS_TUTOR_STREAM_ERROR",
  );
});

test("streamTutorText 未配置 KS 地址时拒绝调用（本地关闭 AUTH 时允许空令牌）", async () => {
  delete process.env.KS_TUTOR_BASE_URL;
  delete process.env.KS_TUTOR_API_KEY;
  try {
    await assert.rejects(
      collect(
        streamTutorText({
          externalCourseId: "epicureanism",
          message: "Hello",
          mode: "lecture",
          locale: "en-GB",
          history: [],
        }),
      ),
      (error: unknown) =>
        error instanceof KsTutorError && error.status === 503,
    );
  } finally {
    process.env.KS_TUTOR_BASE_URL = "http://ks.test";
    process.env.KS_TUTOR_API_KEY = "service-token";
  }
});
