import assert from "node:assert/strict";
import { test } from "node:test";
import { parseLiveKitCredentials } from "../../services/liveKitCredentials";

test("LiveKit credential parser accepts the server secret shape without returning the raw source", () => {
  const credentials = parseLiveKitCredentials('{"apiKey":"api-key","apiSecret":"api-secret-at-least-32-characters"}');
  assert.deepEqual(credentials, { apiKey: "api-key", apiSecret: "api-secret-at-least-32-characters" });
});

test("LiveKit credential parser rejects incomplete and non-object Secrets Manager values", () => {
  for (const raw of ["", "[]", "{}", '{"apiKey":"only"}', '{"apiSecret":"only"}', "not-json"]) {
    assert.throws(() => parseLiveKitCredentials(raw));
  }
});
