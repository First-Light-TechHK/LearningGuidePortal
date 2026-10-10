import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyLiveKitIncident } from "../../modules/group-study/liveKitIncident";

test("a join failure requests exactly one verified replacement token", () => {
  assert.deepEqual(classifyLiveKitIncident({ source: "disconnect", reason: "JOIN_FAILURE" }), {
    code: "join_failed",
    severity: "error",
    action: "reissue_verified_token",
    terminal: false
  });
});

test("a room deletion is terminal and never requests a replacement token", () => {
  assert.deepEqual(classifyLiveKitIncident({ source: "disconnect", reason: "ROOM_DELETED" }), {
    code: "room_ended",
    severity: "info",
    action: "end_session",
    terminal: true
  });
});

test("a duplicate identity is actionable but not misclassified as a network retry", () => {
  assert.deepEqual(classifyLiveKitIncident({ source: "disconnect", reason: "DUPLICATE_IDENTITY" }), {
    code: "duplicate_identity",
    severity: "warning",
    action: "show_duplicate_identity",
    terminal: true
  });
});

test("lost media quality prompts reconnect status without minting another token", () => {
  assert.deepEqual(classifyLiveKitIncident({ source: "connection_quality", quality: "Lost" }), {
    code: "network_lost",
    severity: "warning",
    action: "sdk_reconnect",
    terminal: false
  });
});

test("provider rate limits fail over only while creating a new room", () => {
  assert.deepEqual(classifyLiveKitIncident({ source: "gateway", code: "rate_limited", phase: "new_room" }), {
    code: "provider_rate_limited",
    severity: "warning",
    action: "try_standby_for_new_room",
    terminal: false
  });
  assert.deepEqual(classifyLiveKitIncident({ source: "gateway", code: "rate_limited", phase: "existing_room" }), {
    code: "provider_rate_limited",
    severity: "warning",
    action: "show_unavailable",
    terminal: false
  });
});
