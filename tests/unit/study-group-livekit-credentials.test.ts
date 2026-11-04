import assert from "node:assert/strict";
import { test } from "node:test";
import { createLiveKitCredentialResolver, parseLiveKitCredentials } from "../../services/liveKitCredentials";
import type { LiveKitProjectRef } from "../../modules/group-study/liveKitProjectRegistry";

const project: LiveKitProjectRef = {
  id: "eu-primary",
  url: "wss://eu-primary.livekit.cloud",
  state: "active",
  weight: 1,
  credentialSecretId: "learning-guide/livekit/eu-primary"
};

test("LiveKit credential parser accepts the server secret shape without returning the raw source", () => {
  const credentials = parseLiveKitCredentials('{"apiKey":"api-key","apiSecret":"api-secret-at-least-32-characters"}');
  assert.deepEqual(credentials, { apiKey: "api-key", apiSecret: "api-secret-at-least-32-characters" });
});

test("LiveKit credential parser rejects incomplete and non-object Secrets Manager values", () => {
  for (const raw of ["", "[]", "{}", '{"apiKey":"only"}', '{"apiSecret":"only"}', "not-json"]) {
    assert.throws(() => parseLiveKitCredentials(raw));
  }
});

test("LiveKit credential resolver caches ordinary reads but a forced refresh coalesces and obtains the rotated secret", async () => {
  let reads = 0;
  let current = '{"apiKey":"old-key","apiSecret":"old-secret"}';
  const resolver = createLiveKitCredentialResolver({
    async getSecretValue() {
      reads += 1;
      await Promise.resolve();
      return current;
    }
  }, { now: () => new Date("2026-10-10T12:00:00.000Z"), cacheTtlMs: 60_000 });

  assert.equal((await resolver.resolve(project)).apiKey, "old-key");
  assert.equal((await resolver.resolve(project)).apiKey, "old-key");
  assert.equal(reads, 1);

  current = '{"apiKey":"new-key","apiSecret":"new-secret"}';
  const refreshed = await Promise.all([
    resolver.resolve(project, { forceRefresh: true }),
    resolver.resolve(project, { forceRefresh: true }),
    resolver.resolve(project, { forceRefresh: true })
  ]);
  assert.deepEqual(refreshed.map((value) => value.apiKey), ["new-key", "new-key", "new-key"]);
  assert.equal(reads, 2);
});

// UAT 2026-11-04: a Live Key replaced by hand is often written under LiveKit's
// own variable names. Those spellings are the same field; a conflicting pair
// is rejected, never guessed.
test("LiveKit credential parser reads LiveKit's own and snake_case field names, and rejects conflicting spellings", () => {
  const expected = { apiKey: "API-key", apiSecret: "secret-at-least-32-characters-long" };
  assert.deepEqual(parseLiveKitCredentials(JSON.stringify({ LIVEKIT_API_KEY: " API-key ", LIVEKIT_API_SECRET: "secret-at-least-32-characters-long\n" })), expected);
  assert.deepEqual(parseLiveKitCredentials(JSON.stringify({ api_key: "API-key", api_secret: "secret-at-least-32-characters-long" })), expected);
  assert.deepEqual(parseLiveKitCredentials(JSON.stringify({ apiKey: "API-key", LIVEKIT_API_KEY: "API-key", apiSecret: "secret-at-least-32-characters-long" })), expected);
  assert.throws(() => parseLiveKitCredentials(JSON.stringify({ apiKey: "API-new", LIVEKIT_API_KEY: "API-old", apiSecret: "secret-at-least-32-characters-long" })), /given twice/);
  assert.throws(() => parseLiveKitCredentials(JSON.stringify({ apiKey: "API-key", LIVEKIT_API_SECRET: "" })), /apiSecret is missing/);
  assert.throws(() => parseLiveKitCredentials(JSON.stringify({ LIVEKIT_URL: "wss://x.livekit.cloud", key: "API-key", secret: "s" })), /apiKey is missing/);
});

test("LiveKit credential resolver reports each rejected read as unreadable or invalid, redacted, and says whether the last good pair is kept", async () => {
  let current: string | undefined = undefined;
  let failing = false;
  let nowMs = Date.parse("2026-11-04T05:00:00.000Z");
  const rejections: Array<{ projectId: string; reason: string; keptLastGood: boolean }> = [];
  const resolver = createLiveKitCredentialResolver({
    async getSecretValue() {
      if (failing) throw new Error("AccessDeniedException: not authorized to read secret");
      return current;
    }
  }, { now: () => new Date(nowMs), cacheTtlMs: 60_000, onRejected: (rejection) => { rejections.push(rejection); } });

  // Nothing readable yet (missing / empty secret): fails, no pair to keep.
  await assert.rejects(() => resolver.resolve(project));
  // Read but not a key pair (e.g. a plain "key:secret" string): fails too.
  current = "API-key:secret-value";
  await assert.rejects(() => resolver.resolve(project, { forceRefresh: true }));
  assert.deepEqual(rejections, [
    { projectId: "eu-primary", reason: "unreadable", keptLastGood: false },
    { projectId: "eu-primary", reason: "invalid", keptLastGood: false }
  ]);

  current = '{"apiKey":"good-key","apiSecret":"good-secret-at-least-32-characters"}';
  assert.equal((await resolver.resolve(project, { forceRefresh: true })).apiKey, "good-key");

  // A later bad version or a refused read keeps the good pair and says so.
  current = '{"key":"new-key","secret":"new-secret"}';
  nowMs += 61_000;
  assert.equal((await resolver.resolve(project)).apiKey, "good-key");
  failing = true;
  assert.equal((await resolver.resolve(project, { forceRefresh: true })).apiKey, "good-key");
  assert.deepEqual(rejections.slice(2), [
    { projectId: "eu-primary", reason: "invalid", keptLastGood: true },
    { projectId: "eu-primary", reason: "unreadable", keptLastGood: true }
  ]);
  const logged = JSON.stringify(rejections);
  for (const leaked of ["good-secret", "new-secret", "secret-value", "AccessDenied", "learning-guide/livekit"]) assert.equal(logged.includes(leaked), false);
});

test("a throwing rejection reporter never changes which key pair is used", async () => {
  let current = '{"apiKey":"good-key","apiSecret":"good-secret-at-least-32-characters"}';
  const resolver = createLiveKitCredentialResolver({ async getSecretValue() { return current; } }, {
    now: () => new Date("2026-11-04T05:00:00.000Z"),
    onRejected: () => { throw new Error("log sink down"); }
  });
  assert.equal((await resolver.resolve(project)).apiKey, "good-key");
  current = "not-json";
  assert.equal((await resolver.resolve(project, { forceRefresh: true })).apiKey, "good-key");
});
