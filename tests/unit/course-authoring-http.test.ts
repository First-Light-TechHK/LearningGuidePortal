import assert from "node:assert/strict";
import { test } from "node:test";
import { AUTHORING_BODY_MAX_BYTES, authoringBody, authoringFailure, authoringSuccess } from "../../services/courseAuthoringHttp";

const request = (body: BodyInit, headers?: HeadersInit) => new Request("http://localhost/api/backoffice/courses", { method: "POST", body, headers });
const oversized = (error: unknown) => authoringFailure(error).status === 413;

test("authoring bodies enforce bytes rather than Unicode character count", async () => {
  const json = JSON.stringify({ text: "漢".repeat(700_000) });
  assert.ok(json.length < AUTHORING_BODY_MAX_BYTES);
  await assert.rejects(authoringBody(request(json)), oversized);
  const exact = JSON.stringify({ text: "x".repeat(AUTHORING_BODY_MAX_BYTES - 11) });
  assert.equal(new TextEncoder().encode(exact).length, AUTHORING_BODY_MAX_BYTES);
  assert.equal((await authoringBody<{ text: string }>(request(exact))).text.length, AUTHORING_BODY_MAX_BYTES - 11);
  await assert.rejects(authoringBody(request(exact + " ")), oversized);
});

test("oversized streams are cancelled without reading the rest of the request", async () => {
  let pulls = 0, cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) { pulls++; controller.enqueue(new Uint8Array(300_000)); if (pulls === 100) controller.close(); },
    cancel() { cancelled = true; },
  });
  const streamed = new Request("http://localhost/api/backoffice/courses", { method: "POST", body: stream, duplex: "half" } as RequestInit & { duplex: "half" });
  await assert.rejects(authoringBody(streamed), oversized);
  assert.equal(cancelled, true);
  assert.ok(pulls < 10, "The remaining stream must not be buffered");
});

test("declared oversized bodies, malformed JSON and malformed UTF-8 are rejected", async () => {
  await assert.rejects(authoringBody(request("{}", { "content-length": String(AUTHORING_BODY_MAX_BYTES + 1) })), oversized);
  for (const body of ["[]", "null", "{bad", new Uint8Array([123, 255, 125])]) {
    await assert.rejects(authoringBody(request(body)), error => authoringFailure(error).status === 400);
  }
});

test("authoring success and failure responses cannot be shared or cached", async () => {
  for (const response of [authoringSuccess({ course: { id: "course" } }), authoringFailure(new SyntaxError())]) {
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(response.headers.get("vary"), "Cookie");
    assert.equal(typeof (await response.json()).requestId, "string");
  }
});
