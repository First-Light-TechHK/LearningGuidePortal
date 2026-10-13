import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { fetchOpenRouter } from "../../services/openRouterClient";

// These tests pin the abort-timing contract of fetchOnce against a real HTTP
// path. A synthetic Response mock cannot catch a regression here: a mocked
// Response is not wired to the AbortController, so an early abort() leaves it
// fully readable — which is exactly how the production bug (every OpenRouter
// call failing with AbortError before the caller could read the body)
// stayed invisible to the rest of the suite. fetchOnce posts to a hardcoded
// OpenRouter URL, so instead of mocking fetch this wrapper only redirects that
// origin to a real node:http server on 127.0.0.1: the request, its AbortSignal
// and the response stream all stay real.

async function startJsonServer(handler: (req: IncomingMessage, res: ServerResponse) => void) {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return { server, port };
}

function redirectOpenRouterFetch(port: number) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
    return realFetch(url.replace("https://openrouter.ai", `http://127.0.0.1:${port}`), init);
  }) as typeof fetch;
  return () => {
    globalThis.fetch = realFetch;
  };
}

function stopServer(server: Server) {
  server.closeAllConnections();
  return new Promise<void>((resolve) => server.close(() => resolve()));
}

test("a real HTTP 200 response body is readable after fetchOpenRouter returns", async () => {
  const payload = { id: "chatcmpl-1", choices: [{ index: 0, message: { role: "assistant", content: "hello" } }] };
  const { server, port } = await startJsonServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(payload));
  });
  const restore = redirectOpenRouterFetch(port);
  try {
    const response = await fetchOpenRouter(
      "test-key",
      { model: "test/model-a", messages: [{ role: "user", content: "hi" }] },
      { timeoutMs: 5000, attempts: 1 }
    );
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /application\/json/);
    assert.deepEqual(await response.json(), payload);
  } finally {
    restore();
    await stopServer(server);
  }
});

test("a timeout still interrupts a request that is in flight", async () => {
  let sawAbort = false;
  let releaseAbort: () => void = () => {};
  const aborted = new Promise<void>((resolve) => {
    releaseAbort = resolve;
  });
  const { server, port } = await startJsonServer((req, res) => {
    req.on("close", () => {
      if (!res.writableEnded) {
        sawAbort = true;
        releaseAbort();
      }
    });
    // Never respond: the request stays in flight until the timeout aborts it.
  });
  const restore = redirectOpenRouterFetch(port);
  try {
    const started = Date.now();
    await assert.rejects(
      fetchOpenRouter("test-key", { model: "test/model-b", messages: [] }, { timeoutMs: 300, attempts: 1 }),
      (error: unknown) => {
        const candidate = error as Error & { code?: unknown };
        assert.ok(candidate instanceof Error);
        assert.ok(
          candidate.name === "AbortError" || candidate.code === "ETIMEDOUT" || /timed out|aborted/i.test(candidate.message),
          `expected a timeout or abort error, got ${candidate.name}: ${candidate.message}`
        );
        return true;
      }
    );
    assert.ok(Date.now() - started < 3000, "the rejection must come from the timeout, not from the server");
    await Promise.race([
      aborted,
      new Promise((_, reject) => setTimeout(() => reject(new Error("the server never observed the aborted request")), 2000))
    ]);
    assert.equal(sawAbort, true, "the in-flight request must be interrupted, not left open");
  } finally {
    restore();
    await stopServer(server);
  }
});

test("the 400 reasoning fallback retries without reasoning and reads the retried body", async () => {
  const bodies: string[] = [];
  const { server, port } = await startJsonServer((req, res) => {
    if (req.method !== "POST") {
      res.writeHead(405).end();
      return;
    }
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => {
      raw += chunk;
    });
    req.on("end", () => {
      bodies.push(raw);
      if (bodies.length === 1) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: "reasoning is not supported for this model", code: 400 } }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: "chatcmpl-2", choices: [{ index: 0, message: { role: "assistant", content: "retried" } }] }));
    });
  });
  const restore = redirectOpenRouterFetch(port);
  try {
    const response = await fetchOpenRouter(
      "test-key",
      { model: "test/model-c", messages: [{ role: "user", content: "hi" }] },
      { timeoutMs: 5000, attempts: 1 }
    );
    assert.equal(bodies.length, 2, "the provider must be called twice: original, then the reasoning-stripped retry");
    const first = JSON.parse(bodies[0]) as Record<string, unknown>;
    const second = JSON.parse(bodies[1]) as Record<string, unknown>;
    assert.deepEqual(first.reasoning, { effort: "none", exclude: true });
    assert.equal("reasoning" in second, false);
    assert.equal(response.status, 200);
    const body = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    assert.equal(body.choices?.[0]?.message?.content, "retried");
  } finally {
    restore();
    await stopServer(server);
  }
});
