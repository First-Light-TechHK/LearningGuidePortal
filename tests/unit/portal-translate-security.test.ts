import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { defaultPortalContent } from "../../lib/portalContent";
import { translatePortalContent } from "../../services/portalTranslate";

const originalFetch = globalThis.fetch;
const originalKey = process.env.OPENROUTER_API_KEY;
beforeEach(() => { process.env.OPENROUTER_API_KEY = "test-translation-key"; });
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = originalKey;
});

function source() {
  const content = structuredClone(defaultPortalContent);
  delete content.translation;
  return content;
}

function payload() {
  return { banners: defaultPortalContent.banners["zh-CN"].map(({ eyebrow, title, text, cta }) => ({ eyebrow, title, text, cta })), categories: ["Chinese", "European", "Science"] };
}

function completion(value: unknown) {
  return { choices: [{ message: { content: JSON.stringify(value) } }] };
}

test("translation consumes delayed provider bytes before aborting the request", async () => {
  let completed = false, prematureAbort = false, calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls++;
    assert.equal(init?.headers && (init.headers as Record<string, string>).Authorization, "Bearer test-translation-key");
    const bytes = Buffer.from(JSON.stringify(completion(payload())));
    return new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.subarray(0, 10));
        const timer = setTimeout(() => {
          completed = true;
          controller.enqueue(bytes.subarray(10));
          controller.close();
        }, 10);
        init?.signal?.addEventListener("abort", () => {
          if (!completed) { prematureAbort = true; clearTimeout(timer); controller.error(new DOMException("Aborted before body consumed", "AbortError")); }
        });
      },
    }));
  };
  const input = source(), snapshot = structuredClone(input);
  const translated = await translatePortalContent(input, "en-GB");
  assert.equal(completed, true);
  assert.equal(prematureAbort, false);
  assert.equal(translated.skipped, false);
  assert.deepEqual(translated.content.categories.map(category => category.labels["zh-CN"]), payload().categories);
  assert.deepEqual(input, snapshot);
  assert.equal((await translatePortalContent(translated.content, "en-GB")).skipped, true);
  assert.equal(calls, 1);
});

test("malformed model shapes fail without marking a translation current", async () => {
  const valid = payload();
  for (const bad of [null, [], "text", {}, { ...valid, categories: "XYZ" }, { ...valid, categories: { 0: "a", 1: "b", 2: "c", length: 3 } }, { ...valid, categories: ["one", {}, "three"] }, { ...valid, categories: ["one", " ", "three"] }, { ...valid, categories: ["x".repeat(81), "two", "three"] }, { ...valid, categories: ["one"] }, { ...valid, banners: { ...valid.banners, length: 3 } }, { ...valid, banners: valid.banners.slice(0, 2) }, { ...valid, banners: [null, ...valid.banners.slice(1)] }, { ...valid, banners: [{ ...valid.banners[0], title: 123 }, ...valid.banners.slice(1)] }]) {
    globalThis.fetch = async () => Response.json(completion(bad));
    const input = source(), snapshot = structuredClone(input);
    await assert.rejects(translatePortalContent(input, "en-GB"), /Translation/);
    assert.deepEqual(input, snapshot);
    assert.equal(input.translation, undefined);
  }
});

test("valid fenced JSON succeeds, but invalid provider envelopes fail closed", async () => {
  globalThis.fetch = async () => Response.json({ choices: [{ message: { content: "```json\n" + JSON.stringify(payload()) + "\n```" } }] });
  assert.equal((await translatePortalContent(source(), "en-GB")).skipped, false);
  for (const invalid of [null, {}, { choices: {} }, { choices: [] }, { choices: [{ message: { content: {} } }] }, { choices: [{ message: { content: "x".repeat(32_001) } }] }]) {
    globalThis.fetch = async () => Response.json(invalid);
    await assert.rejects(translatePortalContent(source(), "en-GB"), /invalid response/);
  }
});

test("bounded provider body is cancelled and raw provider errors are not exposed", async () => {
  let cancelled = false, calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(128 * 1024 + 1)); },
      cancel() { cancelled = true; },
    }));
  };
  await assert.rejects(translatePortalContent(source(), "en-GB"), /too large/);
  assert.equal(cancelled, true);
  assert.equal(calls, 1);
  globalThis.fetch = async () => new Response("private provider diagnostic", { status: 401 });
  await assert.rejects(translatePortalContent(source(), "en-GB"), { message: "Translation failed (401)." });
});

test("transient HTTP and body failures retry, with the previous request closed", async () => {
  let calls = 0, previousSignal: AbortSignal | null | undefined;
  globalThis.fetch = async (_url, init) => {
    if (previousSignal) assert.equal(previousSignal.aborted, true);
    previousSignal = init?.signal;
    return ++calls === 1 ? new Response("temporarily unavailable", { status: 503 }) : Response.json(completion(payload()));
  };
  await translatePortalContent(source(), "en-GB");
  assert.equal(calls, 2);
  calls = 0;
  globalThis.fetch = async () => {
    if (++calls === 1) return new Response(new ReadableStream({ start(controller) { controller.error(new TypeError("terminated")); } }));
    return Response.json(completion(payload()));
  };
  await translatePortalContent(source(), "en-GB");
  assert.equal(calls, 2);
});

test("invalid source content is rejected before any provider request", async () => {
  globalThis.fetch = async () => { assert.fail("Provider must not be called"); };
  for (const content of [null, {}, { ...source(), categories: "XYZ" }, { ...source(), banners: { "en-GB": [], "zh-CN": [] } }, { ...source(), categories: source().categories.map(category => ({ ...category, id: "Science" })) }]) {
    await assert.rejects(translatePortalContent(content as typeof defaultPortalContent, "en-GB"));
  }
});
