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
