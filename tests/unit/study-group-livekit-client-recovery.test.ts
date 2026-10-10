import assert from "node:assert/strict";
import { test } from "node:test";
import { transitionLiveKitClient } from "../../modules/group-study/liveKitClientRecovery";

test("the first join failure asks for one verified recovery token", () => {
  assert.deepEqual(transitionLiveKitClient({ type: "disconnect", reason: "JOIN_FAILURE", recoveryUsed: false }), {
    type: "recover_token",
    incident: { code: "join_failed", severity: "error", action: "reissue_verified_token", terminal: false }
  });
});

test("a second join failure stops rather than entering a token loop", () => {
  assert.deepEqual(transitionLiveKitClient({ type: "disconnect", reason: "JOIN_FAILURE", recoveryUsed: true }), {
    type: "unavailable",
    incident: { code: "join_failed", severity: "error", action: "reissue_verified_token", terminal: false }
  });
});

test("room removal, duplicate identity, and participant removal are terminal with their distinct actions", () => {
  assert.deepEqual(transitionLiveKitClient({ type: "disconnect", reason: "ROOM_DELETED", recoveryUsed: false }).type, "terminal");
  assert.deepEqual(transitionLiveKitClient({ type: "disconnect", reason: "DUPLICATE_IDENTITY", recoveryUsed: false }).incident?.action, "show_duplicate_identity");
  assert.deepEqual(transitionLiveKitClient({ type: "disconnect", reason: "PARTICIPANT_REMOVED", recoveryUsed: false }).incident?.action, "show_removed");
});

test("Lost quality reconnects through the SDK while Good and Poor are ignored", () => {
  assert.deepEqual(transitionLiveKitClient({ type: "connection_quality", quality: "Lost" }), {
    type: "sdk_reconnecting",
    incident: { code: "network_lost", severity: "warning", action: "sdk_reconnect", terminal: false }
  });
  assert.deepEqual(transitionLiveKitClient({ type: "connection_quality", quality: "Good" }), { type: "ignore", incident: null });
  assert.deepEqual(transitionLiveKitClient({ type: "connection_quality", quality: "Poor" }), { type: "ignore", incident: null });
});

test("an unknown final disconnect becomes unavailable instead of silently recovering", () => {
  assert.deepEqual(transitionLiveKitClient({ type: "disconnect", reason: "SERVER_SHUTDOWN", recoveryUsed: false }), {
    type: "unavailable",
    incident: { code: "provider_unreachable", severity: "warning", action: "show_unavailable", terminal: false }
  });
});

test("a successful SDK reconnect clears the incident state", () => {
  assert.deepEqual(transitionLiveKitClient({ type: "reconnected" }), { type: "connected", incident: null });
});
