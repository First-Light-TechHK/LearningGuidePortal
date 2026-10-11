import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { test } from "node:test";
import { callRoute, isolate } from "../io/harness";

// Route contract tests for POST /api/livekit/webhook (design §1/§3/§5):
// verify the provider signature first, then receipt; the file store fails
// closed with webhook_unavailable, and the fake gateway's verifier rejects
// every vector with typed unverified.

const LOCAL_PROJECT = {
  id: "local-test",
  url: "wss://livekit.example.test",
  state: "active",
  credentialSecretId: "local-test"
};
const LOCAL_API_KEY = "lk-key";
const LOCAL_API_SECRET = "lk-secret-at-least-32-characters";

let webhookPost: ((request: Request) => Promise<Response>) | undefined;

async function webhookRoute() {
  webhookPost ??= (await import("../../app/api/livekit/webhook/route")).POST;
  return webhookPost;
}

// Each test owns its isolate: the Study Group runtime caches the service and
// gateway per store directory, so a fresh tmpdir is what makes a changed
// LIVEKIT_FAKE_GATEWAY actually take effect. isolate() also restores the
// environment snapshot and keeps everything on the local file store.
async function withWebhookEnv<T>(options: { fakeGateway: boolean }, run: () => Promise<T>): Promise<T> {
  const { restore } = await isolate("lg-study-group-webhook-route-");
  try {
    delete process.env.LIVEKIT_API_KEY;
    delete process.env.LIVEKIT_API_SECRET;
    delete process.env.LIVEKIT_URL;
    delete process.env.STUDY_GROUP_STORE;
    process.env.LIVEKIT_PROJECTS_JSON = JSON.stringify([LOCAL_PROJECT]);
    process.env.LIVEKIT_LOCAL_CREDENTIALS_JSON = JSON.stringify({
      [LOCAL_PROJECT.credentialSecretId]: { apiKey: LOCAL_API_KEY, apiSecret: LOCAL_API_SECRET }
    });
    process.env.STUDY_GROUP_TOKEN_LOG_KEY = Buffer.alloc(32, 9).toString("base64");
    if (options.fakeGateway) process.env.LIVEKIT_FAKE_GATEWAY = "1";
    else delete process.env.LIVEKIT_FAKE_GATEWAY;
    return await run();
  } finally {
    await restore();
  }
}

function b64url(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

// Mirrors the provider's signing and the gateway test vectors: compact HS256
// JWT carrying `iss` = project apiKey, a required `exp`, and the standard-base64
// SHA-256 of the exact raw body. `exp` is validated against the real clock, so
// it is based on Date.now(), never a fixed instant.
function sign(body: string, apiKey: string, apiSecret: string) {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const sha256 = createHash("sha256").update(body, "utf8").digest("base64");
  const payload = b64url(JSON.stringify({ iss: apiKey, exp: Math.floor(Date.now() / 1000) + 60, sha256 }));
  const signature = createHmac("sha256", apiSecret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

function participantLeftBody() {
  return JSON.stringify({
    event: "participant_left",
    id: "EV_route_webhook_1",
    createdAt: String(Date.now() * 1000),
    room: { name: "s-session-1", sid: "RM_1" },
    participant: { identity: "u-7", sid: "PA_1" }
  });
}

function webhookRequest(body: string, options: { authHeader?: string } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (options.authHeader !== undefined) headers.authorization = options.authHeader;
  return new Request("http://localhost/api/livekit/webhook", { method: "POST", headers, body });
}

test("POST /api/livekit/webhook without an Authorization header is 400 invalid_signature on the real gateway", async () => {
  await withWebhookEnv({ fakeGateway: false }, async () => {
    const response = await callRoute(await webhookRoute(), webhookRequest(participantLeftBody()));
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { ok: false, code: "invalid_signature" });
  });
});

test("the DEV fake gateway rejects even a correctly signed event with 400 invalid_signature", async () => {
  await withWebhookEnv({ fakeGateway: true }, async () => {
    const body = participantLeftBody();
    const response = await callRoute(
      await webhookRoute(),
      webhookRequest(body, { authHeader: sign(body, LOCAL_API_KEY, LOCAL_API_SECRET) })
    );
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { ok: false, code: "invalid_signature" });
  });
});

test("a validly signed LiveKit event still fails closed on the file store: 503 webhook_unavailable", async () => {
  await withWebhookEnv({ fakeGateway: false }, async () => {
    const body = participantLeftBody();
    const response = await callRoute(
      await webhookRoute(),
      webhookRequest(body, { authHeader: sign(body, LOCAL_API_KEY, LOCAL_API_SECRET) })
    );
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { ok: false, code: "webhook_unavailable" });
  });
});

test("POST /api/livekit/webhook with a garbage Authorization header is 400 invalid_signature, not 500", async () => {
  await withWebhookEnv({ fakeGateway: false }, async () => {
    const response = await callRoute(await webhookRoute(), webhookRequest(participantLeftBody(), { authHeader: "not-a-jwt" }));
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { ok: false, code: "invalid_signature" });
  });
});
